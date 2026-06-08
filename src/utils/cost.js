import { getLatestPricing, getRates } from './pricing.js';

// SECONDARY cost calculation (token x rate). Per build-spec §1 non-negotiable #1,
// the billing-grade HEADLINE cost is the payload's cost.total_cost_usd, captured
// by the collector as `cost_usd`. This calc exists only to (a) verify that anchor
// and (b) power `whatif` counterfactuals. It is never the headline number.
//
// Honors per-turn speed_tier ('standard' | 'fast'); fast mode uses the Opus
// fast_mode rates. Returns 0 (never throws) if the model can't be resolved —
// the anchor still carries the real cost.
export function expectedCost(model, speedTier, tokens) {
  const rates = getRates(model, speedTier || 'standard');
  if (!rates) return 0;
  const cache = getLatestPricing().cache;
  const t = tokens || {};
  return (
    (t.input_tokens || 0) / 1_000_000 * rates.input +
    (t.output_tokens || 0) / 1_000_000 * rates.output +
    (t.cache_read_tokens || 0) / 1_000_000 * rates.input * cache.read_multiplier +
    (t.cache_write_tokens || 0) / 1_000_000 * rates.input * cache.write_multiplier
  );
}

// Back-compat: cost for a stored turn record. Prefers the billing-grade anchor
// (`cost_usd`) when present; otherwise falls back to the secondary calc so old
// (pre-anchor) records still summarize.
export function computeTurnCost(turn) {
  if (typeof turn.cost_usd === 'number') return turn.cost_usd;
  return expectedCost(turn.model, turn.speed_tier, turn);
}

export function formatCost(usd) {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(count) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return `${count}`;
}
