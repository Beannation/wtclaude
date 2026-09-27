import { getRates, cacheWriteMultiplier } from './pricing.js';

// SECONDARY cost calculation (token x rate). Per build-spec §1 non-negotiable #1,
// the billing-grade HEADLINE cost is the payload's cost.total_cost_usd, captured
// by the collector as `cost_usd`. This calc exists only to (a) verify that anchor
// and (b) power `whatif` counterfactuals. It is never the headline number.
//
// Honors per-turn speed_tier ('standard' | 'fast'); fast mode uses the model's
// fast_mode rates, which exist on Opus 5.5 ($8/$40), Opus 5 and Opus 4.8
// ($10/$50) only. Cache multipliers apply ON TOP of the fast rate (pricing page:
// "Prompt caching multipliers apply on top of fast mode pricing"), which is why
// the cache terms below multiply `rates.input` — the fast input on a fast turn.
// `cache_ttl` ('5m' | '1h') is honored when a record carries it; otherwise the
// rate sheet's default applies.
//
// CACHE WRITES (corrected 2026-08-24): Anthropic bills cache-write tokens as
// their own quantity at 1.25x (5-minute) or 2x (1-hour) of base input — not as a
// small premium on top of an input charge. The sheet previously used 0.25x,
// under-pricing every cache write 5-8x.
//
// CACHE READS: the read multiplier is PER-MODEL, taken off the resolved rates
// rather than the sheet-wide default. Three values as of 2026-09-27: 0.025x on
// Fable 5.1 / Mythos 5.1, 0.05x on Opus 5.5, 0.1x everywhere else. Fable 5 and
// Fable 5.1 have identical $10/$50 base rates and differ only here, so using the
// global multiplier on a Fable 5.1 turn over-prices its cache reads 4x (2x on an
// Opus 5.5 turn) — the single largest silent-accuracy risk in this calc, since
// cache reads dominate agentic sessions.
//
// Returns { usd, priceable, reason }. `priceable: false` means the number is NOT
// safe to present as our estimate for this turn — the model is unresolved, or is
// served by a partner platform whose rates we do not publish. The turn's real
// cost is unaffected: it comes from the payload anchor.
export function priceTurn(model, speedTier, tokens, today) {
  const rates = getRates(model, speedTier || 'standard', today);
  if (!rates) {
    return { usd: 0, priceable: false, reason: 'unresolved-model' };
  }
  const t = tokens || {};
  const writeMult = cacheWriteMultiplier(t.cache_ttl);
  // PER-MODEL cache-read multiplier. getRates() already resolved the entry, so
  // this is the resolved model's own multiplier, not the sheet-wide default:
  // 0.025x on Fable 5.1 / Mythos 5.1, 0.05x on Opus 5.5, 0.1x everywhere else.
  const readMult = rates.cache_read_multiplier;
  const usd =
    (t.input_tokens || 0) / 1_000_000 * rates.input +
    (t.output_tokens || 0) / 1_000_000 * rates.output +
    (t.cache_read_tokens || 0) / 1_000_000 * rates.input * readMult +
    (t.cache_write_tokens || 0) / 1_000_000 * rates.input * writeMult;

  if (rates.provider) return { usd, priceable: false, reason: `partner-platform:${rates.provider}` };
  if (rates.fallback) return { usd, priceable: false, reason: `family-fallback:${rates.key}` };
  return { usd, priceable: true, reason: null };
}

// True when a turn carries any tokens at all. A zero-token turn costs $0 on any
// rate, so an unrecognised model on it is not an exclusion worth reporting — one
// rule for compare-models and whatif, so their counts cannot disagree.
export function hasTokens(t) {
  return !!((t?.input_tokens || 0) || (t?.output_tokens || 0) || (t?.cache_read_tokens || 0) || (t?.cache_write_tokens || 0));
}

// Numeric shim. Returns 0 (never throws) if the model can't be resolved — the
// anchor still carries the real cost. Callers that need to know whether the
// number is presentable should use priceTurn() instead: a bare 0 here is exactly
// how an unknown model used to disappear silently from a counterfactual.
export function expectedCost(model, speedTier, tokens, today) {
  return priceTurn(model, speedTier, tokens, today).usd;
}

// Back-compat: cost for a stored turn record. Prefers the billing-grade anchor
// (`cost_usd`) when present; otherwise falls back to the secondary calc so old
// (pre-anchor) records still summarize.
export function computeTurnCost(turn) {
  if (typeof turn.cost_usd === 'number') return turn.cost_usd;
  return expectedCost(turn.model, turn.speed_tier, turn);
}

export function formatCost(usd) {
  // Sign before the $ (QA-0610-07): a negative diff is "-$10.69", not "$-10.6931".
  const sign = usd < 0 ? '-' : '';
  const v = Math.abs(usd);
  if (v < 0.01) return `${sign}$${v.toFixed(4)}`;
  if (v < 1) return `${sign}$${v.toFixed(3)}`;
  return `${sign}$${v.toFixed(2)}`;
}

export function formatTokens(count) {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return `${count}`;
}
