// Shared dual-pool accounting for `credits` / `forecast` / `readiness`.
// Splits spend by billing basis: the Agent-SDK dollar-credit pool, the fast-mode
// usage-credit pool, and ordinary subscription-limit usage. The dollars sum the
// per-turn cost anchor; WHICH pool a turn lands in is a label, and the fast-mode
// label is inferred on older Claude Code (see fastPayloadTurns below). These are
// NARROW Phase-0 figures — no plan-fit, no predictive layer (that's Phase 1
// Guardian).

import { turnCostBasis, formatCost } from './cost.js';
import { costBasisBadge } from './format.js';
import { localDateOf } from './time.js';

// A pool's cost basis, in the shape summarizeTurns() gives `today`, so the same
// helpers (costBasisBadge, excludedLines, costBasisJson) label it.
function emptyBasis() {
  return { cost: 0, anchored_cost: 0, estimated_cost: 0, anchored_turns: 0, estimated_turns: 0, excluded_turns: 0, excluded_models: {} };
}
function addTo(basis, t, b) {
  if (b.basis === 'excluded') {
    basis.excluded_turns++;
    const m = t.model || '(no model)';
    basis.excluded_models[m] = (basis.excluded_models[m] || 0) + 1;
    return;
  }
  basis.cost += b.usd;
  if (b.basis === 'billing-grade') { basis.anchored_cost += b.usd; basis.anchored_turns++; }
  else { basis.estimated_cost += b.usd; basis.estimated_turns++; }
}
const isAgentTurn = (t) => t.billing_basis === 'agent_sdk_credits' || t.usage_pool === 'agent_sdk';
const isFastTurn = (t) => t.billing_basis === 'fast_mode_usage_credits' || t.speed_tier === 'fast';

// ADDED 2026-09-28 (QA-0928-77): fast turns are split by how the fast-mode
// label was sourced — the payload's own field, or the legacy ratio inference —
// the same split summarizeTurns() makes, so `credits` can label inferred
// fast-mode spend the way `today` does instead of calling it billing-grade.
//
// FIXED 2026-09-28 (RC, QA-0928-54 in the pools): each turn is costed by
// turnCostBasis(), the rule `today` uses. The anchor is billing-grade; an
// unanchored turn on a priceable model is a labelled list-rate estimate; an
// unanchored turn on a model we cannot price (unresolved, partner platform,
// family fallback) adds nothing and is counted by model in the pool's
// `*Basis.excluded_*`, so the views name it under "Not priced". Before this,
// computeTurnCost() priced those turns at a guessed first-party rate and the
// views labelled the sum billing-grade. `agentTurns` / `fastTurns` count the
// priced turns; the excluded ones are in the basis.
export function poolSpend(turns) {
  let agent = 0, fast = 0, subscription = 0;
  let agentTurns = 0, fastTurns = 0, fastPayloadTurns = 0, fastInferredTurns = 0;
  const agentBasis = emptyBasis(), fastBasis = emptyBasis(), subscriptionBasis = emptyBasis();
  for (const t of turns) {
    const b = turnCostBasis(t);
    const priced = b.basis !== 'excluded';
    if (isAgentTurn(t)) {
      addTo(agentBasis, t, b);
      if (priced) { agent += b.usd; agentTurns++; }
    } else if (isFastTurn(t)) {
      addTo(fastBasis, t, b);
      if (priced) {
        fast += b.usd; fastTurns++;
        if (t.speed_tier_source === 'payload') fastPayloadTurns++;
        else fastInferredTurns++;
      }
    } else {
      addTo(subscriptionBasis, t, b);
      if (priced) subscription += b.usd;
    }
  }
  return {
    agent, fast, subscription, total: agent + fast + subscription,
    agentTurns, fastTurns, fastPayloadTurns, fastInferredTurns,
    agentBasis, fastBasis, subscriptionBasis,
  };
}

// Per-day agent-pool spend, for a simple (non-predictive) run-rate. Returns
// { perDay: {date: usd}, days, avgPerDay, sum, agentTurns, basis }.
//
// FIXED 2026-09-28 (QA-0928-73): avgPerDay divided by the days WITH agent
// spend, so spend on 2 days of a 7-day look-back read 3.5x the window
// average. It now divides by `coveredDays` — the days the look-back's
// data covers (utils/window.js) — and is null without one. Days are LOCAL.
//
// FIXED 2026-09-28 (RC): only priced turns (billing-grade or estimated) add to
// perDay and `sum`, so nothing guessed is projected ×30. `agentTurns` counts
// every agent-pool turn; `basis` says how much of `sum` is anchored and names
// the excluded turns. A day with excluded turns only is not a day with spend.
export function agentDailyRunRate(turns, { coveredDays = null } = {}) {
  const perDay = {};
  const basis = emptyBasis();
  let agentTurns = 0;
  for (const t of turns) {
    if (!isAgentTurn(t)) continue;
    agentTurns++;
    const b = turnCostBasis(t);
    addTo(basis, t, b);
    if (b.basis === 'excluded') continue;
    const d = localDateOf(t.ts);
    perDay[d] = (perDay[d] || 0) + b.usd;
  }
  const days = Object.keys(perDay).length;
  const sum = Object.values(perDay).reduce((a, b) => a + b, 0);
  return { perDay, days, avgPerDay: coveredDays > 0 ? sum / coveredDays : null, sum, agentTurns, basis };
}

// The fast-mode spend label, in the words `today` uses (format.js): billing-grade
// only when every fast turn's label came from the payload.
export function fastModeLabel(spend) {
  if (spend.fastPayloadTurns > 0 && spend.fastInferredTurns === 0) return { tilde: false, label: 'billing-grade' };
  if (spend.fastPayloadTurns > 0) return { tilde: true, label: 'partly inferred' };
  return { tilde: true, label: 'inferred' };
}

// The fast-mode pool's spend line (credits): billing-grade only when every
// priced fast turn is anchored AND its fast-mode label came from the payload;
// otherwise "~" with whichever qualifiers apply — the cost basis ("estimated",
// "N% billing-grade, rest estimated") and the label source ("inferred").
export function fastPoolText(spend) {
  const n = `${spend.fastTurns} fast turn${spend.fastTurns === 1 ? '' : 's'}`;
  const cb = costBasisBadge(spend.fastBasis || { anchored_turns: spend.fastTurns });
  const f = fastModeLabel(spend);
  if (cb.label === 'billing-grade' && f.label === 'billing-grade') return `${formatCost(spend.fast)} (billing-grade, ${n})`;
  const parts = [cb.label !== 'billing-grade' ? cb.label : null, f.label !== 'billing-grade' ? f.label : null].filter(Boolean);
  return `~${formatCost(spend.fast)} · ${parts.join(' · ')} (${n})`;
}

// OAuth extra_usage object (build-spec M7) if something has written it to
// config. NOTHING writes it today (sync does not fetch it — the BUILD-028
// credits blocker), so this is null for every user until a writer ships.
// Treated as an aggregate (not fast-isolated) with a staleness label.
export function getExtraUsage(config) {
  const eu = config && config.extra_usage;
  if (!eu || typeof eu !== 'object') return null;
  return {
    is_enabled: !!eu.is_enabled,
    used_credits: typeof eu.used_credits === 'number' ? eu.used_credits : null,
    monthly_limit: typeof eu.monthly_limit === 'number' ? eu.monthly_limit : null,
    currency: eu.currency || 'USD',
    as_of: config.extra_usage_updated_at || eu.as_of || null,
  };
}
