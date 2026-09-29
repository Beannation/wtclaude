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

// ── QA-0928-54: the three not-ours classes, pinned ───────────────────────────

import { priceTurn, turnCostBasis } from './cost.js';

const TOK = { input_tokens: 1_000_000, output_tokens: 100_000 };

test('priceTurn: a family-fallback model is not priceable (and says which family it guessed)', () => {
  const p = priceTurn('claude-opus-6', 'standard', TOK);
  assert.equal(p.priceable, false);
  assert.match(p.reason, /^family-fallback:/);
});

test('priceTurn: a partner-platform id is not priceable at first-party rates', () => {
  const p = priceTurn('vertex_ai/claude-sonnet-5', 'standard', TOK);
  assert.equal(p.priceable, false);
  assert.equal(p.reason, 'partner-platform:vertex_ai');
});

test('priceTurn: an unknown model is not priceable', () => {
  const p = priceTurn('claude-zeta-9', 'standard', TOK);
  assert.deepEqual([p.priceable, p.reason], [false, 'unresolved-model']);
});

test('turnCostBasis: anchor → billing-grade; priceable → estimated; not-ours with tokens → excluded at $0', () => {
  assert.deepEqual(turnCostBasis({ model: 'claude-zeta-9', ...TOK, cost_usd: 1.5 }), { usd: 1.5, basis: 'billing-grade', reason: null });
  const est = turnCostBasis({ model: 'claude-fable-5-1', ...TOK });
  assert.equal(est.basis, 'estimated');
  assert.ok(est.usd > 0);
  assert.deepEqual(turnCostBasis({ model: 'claude-opus-6', ...TOK }), { usd: 0, basis: 'excluded', reason: 'family-fallback:opus-5-5' });
  assert.equal(turnCostBasis({ model: 'claude-zeta-9', input_tokens: 0 }).basis, 'estimated', 'no tokens → nothing to exclude');
});

// QA-0928-52 (reader half): collectors before 0.3.2 stored a payload with no
// cost block as cost_usd 0 with cumulative_cost_usd null. That 0 is not a
// figure Claude Code reported, so such a row reads as unanchored. A real $0
// anchor (cumulative_cost_usd a number) and a row with no cumulative key at all
// stay billing-grade.
const { hasCostAnchor } = await import('./cost.js');

test('QA-0928-52: a legacy cost_usd 0 with cumulative_cost_usd null is unanchored, not a billing-grade $0', () => {
  const legacy = { model: 'claude-fable-5-1', ...TOK, cost_usd: 0, cumulative_cost_usd: null };
  assert.equal(hasCostAnchor(legacy), false);
  const b = turnCostBasis(legacy);
  assert.equal(b.basis, 'estimated');
  assert.ok(b.usd > 0, 'priced from its tokens, like any unanchored turn');
  assert.equal(computeTurnCost(legacy), b.usd);
  assert.equal(turnCostBasis({ ...legacy, model: 'claude-opus-6' }).basis, 'excluded', 'and excluded when the model cannot be priced');
  for (const anchored of [
    { model: 'claude-opus-5-5', ...TOK, cost_usd: 0, cumulative_cost_usd: 12.5 },
    { model: 'claude-opus-5-5', ...TOK, cost_usd: 0 },
    { model: 'claude-opus-5-5', ...TOK, cost_usd: 1.25, cumulative_cost_usd: null },
  ]) {
    assert.equal(hasCostAnchor(anchored), true, JSON.stringify(anchored));
    assert.equal(turnCostBasis(anchored).basis, 'billing-grade');
    assert.equal(computeTurnCost(anchored), anchored.cost_usd);
  }
});
