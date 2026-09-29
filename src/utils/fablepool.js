// Shared Fable accounting — FAMILY-scoped, not Fable-5-scoped.
//
// EXTENDED 2026-09-07 for Fable 5.1, which has been Claude Code's default Fable
// model since v2.1.257 (2026-09-01). Everything here keys off the Fable FAMILY,
// because the plan mechanic is family-scoped: claude.com/pricing states the plan
// rows generically as "Fable", so a Fable 5.1 turn on Max attributes exactly the
// way a Fable 5 turn does. The two models differ in PRICE (cache reads are
// $0.25/MTok on 5.1 against $1/MTok on 5) but not in how they are billed to a
// plan, and the price difference is already handled upstream by the rate sheet
// and the anchored cost — nothing in this module needs to know about it.
//
// REWRITTEN 2026-08-24 for the plan-conditional mechanic. This module used to
// implement a "Fable cliff": a date after which every Fable turn was treated as
// credits-billed. Since 2026-07-20 Fable is permanent and PLAN-CONDITIONAL —
// on Max, Team Premium and Enterprise Premium it is included, drawing up to 50%
// of the weekly usage limit and producing no bill at all; on Pro and Team
// Standard it bills usage credits from the first token. A date cannot answer the
// question any more; only the user's plan can.
//
// Cost basis (PART-1 capture, June 9): the statusline reports a NON-ZERO notional
// cost for Fable turns computed at the real $10/$50 rates — so the per-turn
// `cost_usd` anchor already bakes in cache reads at $1 AND Fable's thinking
// tokens. turnCostBasis() prefers that anchor; tokens × rates is only the
// fallback for anchor-less records, and it UNDERSTATES thinking-heavy turns
// (thinking bills in cost but never appears in the context_window output counter).
// An anchor-less turn on a Fable id the rate sheet cannot resolve, or served by
// a partner platform, gets no figure at all (QA-0928-54): it is counted as
// excluded and named, never priced at a guessed rate.
//
// IMPORTANT reading of that notional figure: on an INCLUDED plan it is not a
// charge and never becomes one. It is the list-rate equivalent of the usage —
// useful for understanding what the allowance is worth, and nothing more.

import { turnCostBasis } from './cost.js';
import { normalizeModel, parseModelId } from './pricing.js';
import { getFableBilling, getFableHistoricalBoundary, getFablePermanentSince } from './config.js';
import { localDateOf } from './time.js';

// A turn is Fable while the recorded model id is any Fable model. The collector
// stamps each record with the snapshot's current model, so an Opus-4.8
// content-fallback mid-session naturally attributes post-flip deltas to Opus
// (research §C3) — we must never cost Opus tokens at Fable rates.
//
// The `startsWith('fable')` test is family-wide by design, so `fable-5-1` counts
// toward the pool exactly as `fable-5` does, and so will the next Fable. Pinned
// by test rather than assumed — see fablepool.test.js. Note this is deliberately
// BROADER than the rate sheet's resolution: an unrecognised Fable id counts
// toward the pool (it is Fable usage, and the plan mechanic is family-wide) even
// though it will not resolve to a rate. Its cost still comes from the anchor.
export function isFableTurn(turn) {
  const key = normalizeModel(turn && turn.model);
  return !!key && key.startsWith('fable');
}

// The partner platform serving a turn (vertex_ai, bedrock, …), or null for a
// first-party id. Such a turn is billed by that platform, never by the Claude
// plan (QA-0928-78).
export function fablePartnerProvider(turn) {
  return parseModelId(turn && turn.model).provider;
}

// Per-day Fable spend over a set of turns, for a simple (non-predictive)
// run-rate. Sums per-turn deltas — never raw cumulative tokens, which are
// context-window-based and non-monotonic (counter resets on /compact etc.).
//
// FIXED 2026-09-28 (BUILD-018):
//  • QA-0928-73: avgPerDay used to divide by the days WITH Fable use, so five
//    busy June days set the per-day rate for a 120-day look-back. It now divides
//    by `coveredDays` — the days the look-back's data covers (see
//    utils/window.js) — and is null when the caller gives no basis.
//  • QA-0928-168: days are LOCAL calendar days, like every other day bucket.
//  • QA-0928-78: partner-platform turns are counted (`partnerTurns`) but left
//    out of the plan run-rate — their platform bills them, not the plan.
//  • RC (QA-0928-54): each turn is costed by turnCostBasis(). An unanchored
//    turn on an id we cannot price is `excluded` (counted in excludedTurns /
//    excludedModels, adding nothing), not an `estimated` one; the partner
//    turns that carry no anchor are counted there too, so the view names them.
export function fableDailyRunRate(turns, { coveredDays = null } = {}) {
  const perDay = {};
  let anchoredTurns = 0, estimatedTurns = 0, excludedTurns = 0, fableTurns = 0, partnerTurns = 0;
  const excludedModels = {};
  const exclude = (t) => { excludedTurns++; const m = t.model || '(no model)'; excludedModels[m] = (excludedModels[m] || 0) + 1; };
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  // Which Fable models the window actually contains, and how many turns each.
  // A window can hold both fable-5 and fable-5-1 turns, and they carry different
  // cache-read rates, so no surface may print a single hard-coded cached rate.
  const models = {};
  for (const t of turns) {
    if (!isFableTurn(t)) continue;
    const b = turnCostBasis(t);
    if (fablePartnerProvider(t)) {
      partnerTurns++;
      if (b.basis === 'excluded') exclude(t);
      continue;
    }
    fableTurns++;
    const key = normalizeModel(t.model);
    if (key) models[key] = (models[key] || 0) + 1;
    if (b.basis === 'billing-grade') anchoredTurns++;
    else if (b.basis === 'estimated') estimatedTurns++;
    else exclude(t);
    tokens.input += t.input_tokens || 0;
    tokens.output += t.output_tokens || 0;
    tokens.cacheRead += t.cache_read_tokens || 0;
    tokens.cacheWrite += t.cache_write_tokens || 0;
    if (b.basis === 'excluded') continue;
    const d = localDateOf(t.ts);
    perDay[d] = (perDay[d] || 0) + b.usd;
  }
  const days = Object.keys(perDay).length;
  const sum = Object.values(perDay).reduce((a, b) => a + b, 0);
  return {
    perDay, days, sum,
    avgPerDay: coveredDays > 0 ? sum / coveredDays : null,
    anchoredTurns, estimatedTurns, excludedTurns, excludedModels, fableTurns, partnerTurns, tokens, models,
  };
}

// How a single Fable turn was billed, given the user's plan.
//
// Records from before the 2026-07-20 permanence change were produced under the
// previous mechanic (included through 2026-07-19, then usage credits), so they
// are read on the old rule regardless of the plan configured today. Records from
// 2026-07-20 onward follow the plan.
//
// A partner-platform turn is 'partner_platform' whatever the plan or date: the
// platform bills it (QA-0928-78). The date is the turn's LOCAL date, the day
// `today` shows it on (QA-0928-168).
//
// Returns one of: 'included_weekly' | 'usage_credits' | 'included_historical'
//                 | 'org_conditional' | 'partner_platform' | 'unknown'
export function fableTurnBilling(turn, planKey) {
  if (fablePartnerProvider(turn)) return 'partner_platform';
  const day = turn && turn.ts ? localDateOf(turn.ts) : '';
  const boundary = getFableHistoricalBoundary();
  const permanentSince = getFablePermanentSince();

  if (day && day < permanentSince) {
    // Old mechanic. On or before the boundary date Fable was included for
    // everyone; after it, it billed usage credits for everyone.
    return day <= boundary ? 'included_historical' : 'usage_credits';
  }
  return getFableBilling(planKey);
}

// Split Fable turns by how they billed. `planKey` may be null — in that case the
// post-2026-07-20 turns land in `unknown`, and the caller is expected to present
// BOTH readings rather than pick one.
//
// Returns { byBilling: {…: {usd, turns, anchored_turns, excluded_turns}},
// planKey, planKnown, total }. `usd` sums the priced turns only (RC,
// QA-0928-54): a turn we cannot price adds nothing and is counted in
// `excluded_turns`, so a partner row with no anchored turn has no dollar
// figure to show — never a first-party guess.
export function fableAttribution(turns, planKey = null) {
  const byBilling = {};
  let total = 0, fableTurns = 0;
  for (const t of turns) {
    if (!isFableTurn(t)) continue;
    fableTurns++;
    const kind = fableTurnBilling(t, planKey);
    const b = turnCostBasis(t);
    const usd = b.basis === 'excluded' ? 0 : b.usd;
    if (!byBilling[kind]) {
      byBilling[kind] = { usd: 0, turns: 0, anchored_turns: 0, excluded_turns: 0 };
      if (kind === 'partner_platform') byBilling[kind].providers = {};
    }
    byBilling[kind].usd += usd;
    byBilling[kind].turns += 1;
    if (b.basis === 'billing-grade') byBilling[kind].anchored_turns += 1;
    if (b.basis === 'excluded') byBilling[kind].excluded_turns += 1;
    if (kind === 'partner_platform') {
      const p = fablePartnerProvider(t);
      byBilling[kind].providers[p] = (byBilling[kind].providers[p] || 0) + 1;
    }
    total += usd;
  }
  return { byBilling, planKey, planKnown: !!planKey, total, fableTurns };
}
