import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel, parseModelId, getModelEntry, getRates, getLatestPricing, cacheWriteMultiplier } from './pricing.js';
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

// REGRESSION GUARD (2026-08-24). These three tests used to assert the OPPOSITE:
// they pinned a scheduled step-up to $3/$15 that Anthropic cancelled on
// 2026-08-10 ("The previously scheduled increase to $3/$15 per million
// input/output tokens on September 1, 2026 will not occur" — platform pricing
// docs, read 2026-08-24). Because the old sheet encoded the step-up as a dated
// schedule, it would have fired by itself on 2026-08-31 in every installed copy.
// They now assert the step-up NEVER fires, on both sides of every date that
// mattered. Do not "fix" these back.
test('Sonnet 5 is $2/$10 — the cancelled step-up never fires, on any date', () => {
  for (const day of ['2026-07-01', '2026-08-30', '2026-08-31', '2026-09-01', '2027-06-01']) {
    const r = getRates('claude-sonnet-5', 'standard', day);
    assert.deepEqual([r.input, r.output], [2, 10], `sonnet-5 must stay $2/$10 on ${day}`);
  }
});

test('the shipped sheet carries no scheduled rate change for any model', () => {
  // The step-up shipped as a `scheduled` array and detonated on a date. Nothing
  // in the live sheet may carry one without an accompanying dated test.
  const models = getLatestPricing().models;
  const scheduled = Object.entries(models).filter(([, m]) => Array.isArray(m.scheduled));
  assert.deepEqual(scheduled.map(([k]) => k), [], 'unexpected scheduled rate change in the live sheet');
});

test('Sonnet 5 cache-read is 10% of the $2 input rate, before and after Aug-31', () => {
  for (const day of ['2026-07-01', '2026-09-01']) {
    const r = getRates('claude-sonnet-5', 'standard', day);
    assert.ok(Math.abs(r.input * 0.10 - 0.20) < 1e-9, `cache-read must be $0.20 on ${day}`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// A1 ACCEPTANCE — every row of the live Anthropic platform pricing table
// resolves to that table's exact rates with fallback: false.
//
// Transcribed from platform.claude.com/docs/en/about-claude/pricing, read
// 2026-08-24. The live table has FIFTEEN rows (the plan's acceptance criterion
// said sixteen — Claude Mythos Preview appears in the tokenizer and
// long-context notes but is not a pricing row). If Anthropic adds a row, this
// test is where it gets added, and the rate sheet fails loudly until it is.
// ───────────────────────────────────────────────────────────────────────────
const LIVE_PRICING_TABLE = [
  // [payload-shaped model id,                  input, output]
  ['claude-fable-5-20260609',                     10,    50],
  ['claude-mythos-5',                             10,    50],
  ['claude-opus-5-20260724',                       5,    25],
  ['claude-opus-4-8-20260528',                     5,    25],
  ['claude-opus-4-7-20260416',                     5,    25],
  ['claude-opus-4-6-20260205',                     5,    25],
  ['claude-opus-4-5-20251124',                     5,    25],
  ['claude-opus-4-1-20250805',                    15,    75],
  ['claude-opus-4-20250514',                      15,    75],
  ['claude-sonnet-5',                              2,    10],
  ['claude-sonnet-4-6-20260217',                   3,    15],
  ['claude-sonnet-4-5-20250929',                   3,    15],
  ['claude-sonnet-4-20250514',                     3,    15],
  ['claude-haiku-4-5-20251015',                    1,     5],
  ['claude-haiku-3-5-20241022',                  0.80,    4],
];

test('A1: all 15 live pricing-table rows resolve exactly, with no family fallback', () => {
  assert.equal(LIVE_PRICING_TABLE.length, 15, 'the transcribed table must stay in sync with the live one');
  for (const [id, input, output] of LIVE_PRICING_TABLE) {
    const resolved = getModelEntry(id);
    assert.ok(resolved, `${id} must resolve to a pricing entry`);
    assert.equal(resolved.fallback, false, `${id} must not resolve by family fallback`);
    const rates = getRates(id, 'standard', '2026-08-24');
    assert.deepEqual([rates.input, rates.output], [input, output], `${id} rates`);
  }
});

test('A1: the [1m] long-context suffix resolves to the same entry at the same rates', () => {
  for (const id of ['claude-opus-5[1m]', 'claude-opus-4-8[1m]', 'claude-fable-5[1m]']) {
    const r = getRates(id, 'standard', '2026-08-24');
    assert.ok(r, `${id} must resolve`);
    assert.equal(r.fallback, false, `${id} must resolve exactly, not by family fallback`);
  }
  // Claude 4.6+ include the full 1M window at standard rates — no premium.
  assert.equal(getRates('claude-opus-5[1m]').input, getRates('claude-opus-5').input);
});

test('A1: fast mode is Opus 5 and Opus 4.8 ONLY — 4.7 and 4.6 must not inherit it', () => {
  for (const id of ['claude-opus-5', 'claude-opus-4-8']) {
    const fast = getRates(id, 'fast', '2026-08-24');
    assert.deepEqual([fast.input, fast.output], [10, 50], `${id} fast mode`);
  }
  // Opus 4.7 errors on speed:"fast" and Opus 4.6 runs at standard rates. Neither
  // may pick up $10/$50 — which is exactly what happened while they were aliases
  // of opus-4-8 and inherited its fast_mode block.
  for (const id of ['claude-opus-4-7', 'claude-opus-4-6', 'claude-opus-4-5', 'claude-opus-4-1']) {
    const fast = getRates(id, 'fast', '2026-08-24');
    assert.deepEqual([fast.input, fast.output], [getRates(id, 'standard').input, getRates(id, 'standard').output],
      `${id} must fall back to standard rates when stamped fast, never $10/$50`);
    assert.notDeepEqual([fast.input, fast.output], [10, 50], `${id} must not price at fast-mode rates`);
  }
});

test('A1: retired models keep their real historical rates instead of being mis-priced', () => {
  // Before this sheet: opus-4-1 and opus-4 hit the opus-* family fallback and
  // priced at $5/$25 against a true $15/$75 (a 3x under-estimate on history),
  // and sonnet-4 / haiku-3-5 resolved to null and cost $0.
  assert.deepEqual(
    [getRates('claude-opus-4-1', 'standard').input, getRates('claude-opus-4-1', 'standard').output], [15, 75]);
  assert.ok(getModelEntry('claude-sonnet-4').entry.retired, 'sonnet-4 must be a real entry, marked retired');
  assert.ok(expectedCost('claude-haiku-3-5', 'standard', { input_tokens: 1_000_000 }) > 0,
    'a retired model must never price at $0');
});

test('A1: whatif family resolution picks opus-5, not opus-4-8 or a retired opus', () => {
  // Mirrors currentModelKey() in cli/whatif.js and compare-models: newest key by
  // sort order. With retired entries now in the sheet, a naive "first match"
  // would have selected opus-4 at $15/$75.
  const newestOpus = Object.keys(getLatestPricing().models).filter(k => k.startsWith('opus')).sort().pop();
  assert.equal(newestOpus, 'opus-5');
});

test('A3: an unknown opus resolves to the NEWEST opus, flagged, never to a retired one', () => {
  const r = getModelEntry('claude-opus-9-20270101');
  assert.ok(r, 'a future opus should still resolve so it never prices at $0');
  assert.equal(r.key, 'opus-5', 'family fallback must pick the newest opus, not the first in the object');
  assert.equal(r.fallback, true, 'and it must be flagged as a fallback');
  assert.equal(r.priceable, false, 'a guessed rate must never feed a counterfactual');
});

test('A3: provider-prefixed ids (v2.1.223) resolve the model but are flagged unpriceable', () => {
  // Claude Code 2.1.223 introduced canonical-ID resolution and provider-prefixed
  // shapes. These name a real Anthropic model, so pricing at $0 would be wrong —
  // but they are served by a partner platform that publishes its own pricing
  // (Bedrock and Google Cloud regional endpoints carry a 10% premium over
  // global), so our first-party rate is indicative only and must be flagged.
  const v = getModelEntry('vertex_ai/claude-sonnet-5');
  assert.equal(v.key, 'sonnet-5');
  assert.equal(v.provider, 'vertex_ai');
  assert.equal(v.priceable, false, 'a partner-served turn must not feed a counterfactual');

  const b = getModelEntry('bedrock/anthropic.claude-opus-5-20260724');
  assert.equal(b.key, 'opus-5');
  assert.equal(b.provider, 'bedrock');
  assert.equal(b.priceable, false);

  // Bare Bedrock vendor namespace, no slash.
  assert.equal(parseModelId('anthropic.claude-haiku-4-5').key, 'haiku-4-5');

  // And it must NOT price at $0 — that was the silent failure mode.
  assert.ok(expectedCost('vertex_ai/claude-sonnet-5', 'standard', { input_tokens: 1_000_000 }) > 0);
});

test('A4: cache write multipliers are the documented 1.25x (5m) / 2x (1h), not 0.25x', () => {
  const cache = getLatestPricing().cache;
  assert.equal(cache.read_multiplier, 0.10);
  assert.equal(cache.write_multiplier_5m, 1.25);
  assert.equal(cache.write_multiplier_1h, 2.00);
  assert.equal(cacheWriteMultiplier('5m'), 1.25);
  assert.equal(cacheWriteMultiplier('1h'), 2.00);
  // Default with no TTL evidence = the 1-hour rate: the costs doc states
  // subscription cache lifetime is 1 hour, and fitting 24 clean local sessions
  // against their billing-grade anchors implies 2.10 (median).
  assert.equal(cacheWriteMultiplier(undefined), 2.00);
});

test('A4: per-model cache prices match the live table exactly', () => {
  // The live table publishes cache prices per model. They are exactly 1.25x /
  // 2x / 0.1x of base input for every row, which is why we hold multipliers
  // rather than a second hand-maintained price column — but the equality is
  // asserted here so a drift in either direction fails loudly.
  const expect = [
    // [id,               5m write, 1h write, cache hit]
    ['claude-fable-5',      12.50,     20,      1.00],
    ['claude-opus-5',        6.25,     10,      0.50],
    ['claude-sonnet-5',      2.50,      4,      0.20],
    ['claude-sonnet-4-6',    3.75,      6,      0.30],
    ['claude-haiku-4-5',     1.25,      2,      0.10],
    ['claude-opus-4-1',     18.75,     30,      1.50],
    ['claude-haiku-3-5',     1.00,   1.60,      0.08],
  ];
  const cache = getLatestPricing().cache;
  for (const [id, w5m, w1h, hit] of expect) {
    const base = getRates(id, 'standard', '2026-08-24').input;
    assert.ok(Math.abs(base * cache.write_multiplier_5m - w5m) < 1e-9, `${id} 5m cache write`);
    assert.ok(Math.abs(base * cache.write_multiplier_1h - w1h) < 1e-9, `${id} 1h cache write`);
    assert.ok(Math.abs(base * cache.read_multiplier - hit) < 1e-9, `${id} cache hit`);
  }
});
