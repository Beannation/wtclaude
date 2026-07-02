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

// MON-SONNET5-071 — Sonnet 5 is the new DEFAULT model in Claude Code (v2.1.197),
// so most fresh sessions now report `claude-sonnet-5`. A missing entry would
// mis-label the most common session type and spam the collector breadcrumb.

test('normalizeModel reduces the live Sonnet 5 id (incl. [1m]) to the pricing key', () => {
  assert.equal(normalizeModel('claude-sonnet-5[1m]'), 'sonnet-5');
  assert.equal(normalizeModel('claude-sonnet-5'), 'sonnet-5');
});

test('sonnet-5 resolves exactly (no unknown-model fallthrough), including the [1m] alias', () => {
  const resolved = getModelEntry('claude-sonnet-5[1m]');
  assert.ok(resolved, 'sonnet-5 must resolve — it is the new default; whatif/compare depend on it');
  assert.equal(resolved.key, 'sonnet-5');
  assert.equal(resolved.fallback, false);
});

test('an unknown sonnet variant returns null — never a silent mis-cost fallback', () => {
  // Only opus-* uses a family fallback. A future/typo sonnet id must NOT inherit
  // sonnet-5 rates silently (cost stays anchored on the payload regardless).
  assert.equal(getModelEntry('claude-sonnet-9'), null);
});

test('Sonnet 5 bills the $2/$10 introductory rate before the Aug-31 step-up', () => {
  const rates = getRates('claude-sonnet-5', 'standard', '2026-07-01');
  assert.equal(rates.input, 2);
  assert.equal(rates.output, 10);
});

test('Sonnet 5 steps up to $3/$15 on 2026-08-31 via the dated schedule', () => {
  const before = getRates('claude-sonnet-5', 'standard', '2026-08-30');
  assert.deepEqual([before.input, before.output], [2, 10], 'still intro the day before');
  const onDate = getRates('claude-sonnet-5', 'standard', '2026-08-31');
  assert.deepEqual([onDate.input, onDate.output], [3, 15], 'standard rate on the step-up date');
  const after = getRates('claude-sonnet-5', 'standard', '2026-12-01');
  assert.deepEqual([after.input, after.output], [3, 15], 'standard rate after');
});

test('Sonnet 5 cache-read is 90%-discounted off the effective input rate', () => {
  // Intro: $2 input -> $0.20 cache-read; post-step-up: $3 input -> $0.30.
  const intro = getRates('claude-sonnet-5', 'standard', '2026-07-01');
  assert.ok(Math.abs(intro.input * 0.10 - 0.20) < 1e-9);
  const std = getRates('claude-sonnet-5', 'standard', '2026-09-01');
  assert.ok(Math.abs(std.input * 0.10 - 0.30) < 1e-9);
});
