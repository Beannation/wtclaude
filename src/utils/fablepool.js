// Shared Fable-5 accounting for the post-June-22 "Fable cliff" forecast.
// Kept SEPARATE from agentpool.js on purpose: interactive Fable bills the
// usage-credits wallet after the cliff, the Agent-SDK pool is a different
// wallet — two forecasts, two countdowns, never commingled.
//
// Cost basis (PART-1 capture, June 9): during the free window the statusline
// reports a NON-ZERO notional cost for Fable turns computed at the real
// $10/$50 rates — so the per-turn `cost_usd` anchor already bakes in cache
// reads at $1 AND Fable's thinking tokens. computeTurnCost() prefers that
// anchor; tokens × rates is only the fallback for anchor-less records, and it
// UNDERSTATES thinking-heavy turns (thinking bills in cost but never appears
// in the context_window output counter).

import { computeTurnCost } from './cost.js';
import { normalizeModel } from './pricing.js';

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
// Returns { perDay, days, avgPerDay, sum, anchoredTurns, estimatedTurns,
//           fableTurns, tokens }.
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
