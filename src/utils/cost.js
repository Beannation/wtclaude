import { getModelPricing, getLatestPricing } from './pricing.js';

export function computeTurnCost(turn) {
  const modelPricing = getModelPricing(turn.model);
  const cachePricing = getLatestPricing().cache;

  const inputCost = (turn.input_tokens / 1_000_000) * modelPricing.input;
  const outputCost = (turn.output_tokens / 1_000_000) * modelPricing.output;
  const cacheReadCost = (turn.cache_read_tokens / 1_000_000) * modelPricing.input * cachePricing.read_multiplier;
  const cacheWriteCost = (turn.cache_write_tokens / 1_000_000) * modelPricing.input * cachePricing.write_multiplier;

  return inputCost + outputCost + cacheReadCost + cacheWriteCost;
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
