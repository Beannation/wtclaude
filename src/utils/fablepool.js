// Shared Fable-5 accounting.
//
// REWRITTEN 2026-08-24 for the plan-conditional mechanic. This module used to
// implement a "Fable cliff": a date after which every Fable turn was treated as
// credits-billed. Since 2026-07-20 Fable 5 is permanent and PLAN-CONDITIONAL —
// on Max, Team Premium and Enterprise Premium it is included, drawing up to 50%
// of the weekly usage limit and producing no bill at all; on Pro and Team
// Standard it bills usage credits from the first token. A date cannot answer the
// question any more; only the user's plan can.
//
// Cost basis (PART-1 capture, June 9): the statusline reports a NON-ZERO notional
// cost for Fable turns computed at the real $10/$50 rates — so the per-turn
// `cost_usd` anchor already bakes in cache reads at $1 AND Fable's thinking
// tokens. computeTurnCost() prefers that anchor; tokens × rates is only the
// fallback for anchor-less records, and it UNDERSTATES thinking-heavy turns
// (thinking bills in cost but never appears in the context_window output counter).
//
// IMPORTANT reading of that notional figure: on an INCLUDED plan it is not a
// charge and never becomes one. It is the list-rate equivalent of the usage —
// useful for understanding what the allowance is worth, and nothing more.

import { computeTurnCost } from './cost.js';
import { normalizeModel } from './pricing.js';
import { getFableBilling, getFableHistoricalBoundary, getFablePermanentSince } from './config.js';

// A turn is Fable only while the recorded model id is Fable. The collector
// stamps each record with the snapshot's current model, so an Opus-4.8
// content-fallback mid-session naturally attributes post-flip deltas to Opus
// (research §C3) — we must never cost Opus tokens at Fable rates.
export function isFableTurn(turn) {
  const key = normalizeModel(turn && turn.model);
  return !!key && key.startsWith('fable');
}

// Per-day Fable spend over a set of turns, for a simple (non-predictive)
// run-rate. Sums per-turn deltas — never raw cumulative tokens, which are
// context-window-based and non-monotonic (counter resets on /compact etc.).
export function fableDailyRunRate(turns) {
  const perDay = {};
  let anchoredTurns = 0, estimatedTurns = 0, fableTurns = 0;
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  for (const t of turns) {
    if (!isFableTurn(t)) continue;
    fableTurns++;
    if (typeof t.cost_usd === 'number') anchoredTurns++;
    else estimatedTurns++;
    tokens.input += t.input_tokens || 0;
    tokens.output += t.output_tokens || 0;
    tokens.cacheRead += t.cache_read_tokens || 0;
    tokens.cacheWrite += t.cache_write_tokens || 0;
    const d = t.ts.slice(0, 10);
    perDay[d] = (perDay[d] || 0) + computeTurnCost(t);
  }
  const days = Object.keys(perDay).length;
  const sum = Object.values(perDay).reduce((a, b) => a + b, 0);
  return {
    perDay, days, sum,
    avgPerDay: days > 0 ? sum / days : 0,
    anchoredTurns, estimatedTurns, fableTurns, tokens,
  };
}

// How a single Fable turn was billed, given the user's plan.
//
// Records from before the 2026-07-20 permanence change were produced under the
// previous mechanic (included through 2026-07-19, then usage credits), so they
// are read on the old rule regardless of the plan configured today. Records from
// 2026-07-20 onward follow the plan.
//
// Returns one of: 'included_weekly' | 'usage_credits' | 'included_historical'
//                 | 'org_conditional' | 'unknown'
export function fableTurnBilling(turn, planKey) {
  const day = String((turn && turn.ts) || '').slice(0, 10);
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
// Returns { byBilling: {…: {usd, turns}}, planKey, planKnown, total }.
export function fableAttribution(turns, planKey = null) {
  const byBilling = {};
  let total = 0, fableTurns = 0;
  for (const t of turns) {
    if (!isFableTurn(t)) continue;
    fableTurns++;
    const kind = fableTurnBilling(t, planKey);
    const usd = computeTurnCost(t);
    if (!byBilling[kind]) byBilling[kind] = { usd: 0, turns: 0 };
    byBilling[kind].usd += usd;
    byBilling[kind].turns += 1;
    total += usd;
  }
  return { byBilling, planKey, planKnown: !!planKey, total, fableTurns };
}
