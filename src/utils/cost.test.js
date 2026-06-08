import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedCost, computeTurnCost } from './cost.js';
import { getLatestPricing, getRates } from './pricing.js';

const cache = getLatestPricing().cache;

test('expectedCost: standard Opus input/output at sheet rates', () => {
  const rates = getRates('opus-4-8', 'standard');
  const got = expectedCost('opus-4-8', 'standard', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
  assert.ok(Math.abs(got - (rates.input + rates.output)) < 1e-9);
});

test('expectedCost: fast mode uses the higher fast_mode rates', () => {
  const std = expectedCost('opus-4-8', 'standard', { output_tokens: 1_000_000 });
  const fast = expectedCost('opus-4-8', 'fast', { output_tokens: 1_000_000 });
  assert.ok(fast > std, 'fast-mode output should cost more than standard');
});

test('expectedCost: cache read/write apply the configured multipliers', () => {
  const rates = getRates('opus-4-8', 'standard');
  const got = expectedCost('opus-4-8', 'standard', { cache_read_tokens: 1_000_000, cache_write_tokens: 1_000_000 });
  const want = rates.input * cache.read_multiplier + rates.input * cache.write_multiplier;
  assert.ok(Math.abs(got - want) < 1e-9);
});

test('expectedCost: unknown model returns 0, never throws', () => {
  assert.equal(expectedCost('not-a-real-model', 'standard', { input_tokens: 1000 }), 0);
});

test('computeTurnCost: prefers the billing-grade cost_usd anchor over the calc', () => {
  const turn = { model: 'opus-4-8', speed_tier: 'standard', input_tokens: 1_000_000, output_tokens: 1_000_000, cost_usd: 0.42 };
  assert.equal(computeTurnCost(turn), 0.42);
});

test('computeTurnCost: falls back to the calc when no anchor is present', () => {
  const turn = { model: 'opus-4-8', speed_tier: 'standard', input_tokens: 1_000_000, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
  assert.equal(computeTurnCost(turn), getRates('opus-4-8', 'standard').input);
});
