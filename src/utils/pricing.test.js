import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel, getModelEntry, getRates } from './pricing.js';
import { expectedCost } from './cost.js';

// FABLE-001 PART 2 — rate resolution for the live-captured Fable id.
// The June-9 capture recorded the literal payload string `claude-fable-5[1m]`.

test('normalizeModel reduces the live Fable id to the pricing key', () => {
  assert.equal(normalizeModel('claude-fable-5[1m]'), 'fable-5');
  assert.equal(normalizeModel('claude-fable-5'), 'fable-5');
});

test('fable-5 resolves to the announced $10/$50 rates without fallback', () => {
  const resolved = getModelEntry('claude-fable-5[1m]');
  assert.ok(resolved, 'fable-5 must resolve (whatif/forecast depend on it)');
  assert.equal(resolved.key, 'fable-5');
  assert.equal(resolved.fallback, false);
  const rates = getRates('claude-fable-5[1m]');
  assert.equal(rates.input, 10);
  assert.equal(rates.output, 50);
});

test('an unknown fable variant never falls back to Opus pricing', () => {
  // Only opus-* ids may use the family fallback — Fable must never inherit
  // Opus rates (it would understate 2x).
  assert.equal(getModelEntry('claude-fable-99'), null);
});

test('expectedCost prices cached Fable input at $1/MTok (the 90% discount)', () => {
  const got = expectedCost('claude-fable-5[1m]', 'standard', { cache_read_tokens: 1_000_000 });
  assert.ok(Math.abs(got - 1.0) < 1e-9, `cache read must be $1/MTok, got ${got}`);
});
