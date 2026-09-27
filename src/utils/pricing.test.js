import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeModel, parseModelId, getModelEntry, getRates, getLatestPricing, cacheWriteMultiplier, cacheReadMultiplier } from './pricing.js';
import { expectedCost, priceTurn } from './cost.js';

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

// MON-SONNET5-071 — Sonnet 5 became the DEFAULT model in Claude Code at v2.1.197
// (it stayed so on Pro / Team Standard until v2.1.280, when Opus 5.5 took over).
// A missing entry would mis-label a common session type and spam the collector
// breadcrumb.

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

test('A1: fast mode is Opus 5.5, Opus 5 and Opus 4.8 ONLY — 4.7 and 4.6 must not inherit it', () => {
  for (const id of ['claude-opus-5', 'claude-opus-4-8']) {
    const fast = getRates(id, 'fast', '2026-08-24');
    assert.deepEqual([fast.input, fast.output], [10, 50], `${id} fast mode`);
  }
  // Opus 5.5 is CHEAPER in fast mode than Opus 5 — $8/$40 (pricing page §Fast
  // mode, read 2026-09-27) — so it cannot share Opus 5's block.
  const f55 = getRates('claude-opus-5-5', 'fast', '2026-09-27');
  assert.deepEqual([f55.input, f55.output], [8, 40], 'claude-opus-5-5 fast mode');
  const withFast = Object.entries(getLatestPricing().models).filter(([, m]) => m.fast_mode).map(([k]) => k).sort();
  assert.deepEqual(withFast, ['opus-4-8', 'opus-5', 'opus-5-5'], 'the set of models with a fast_mode block changed');
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

test('A1: whatif family resolution picks opus-5-5, not opus-5, opus-4-8 or a retired opus', () => {
  // Mirrors currentModelKey() in cli/whatif.js and compare-models: newest key by
  // sort order. With retired entries now in the sheet, a naive "first match"
  // would have selected opus-4 at $15/$75. 'opus-5-5' sorts after 'opus-5'.
  const newestOpus = Object.keys(getLatestPricing().models).filter(k => k.startsWith('opus')).sort().pop();
  assert.equal(newestOpus, 'opus-5-5');
});

test('A3: an unknown opus resolves to the NEWEST opus, flagged, never to a retired one', () => {
  const r = getModelEntry('claude-opus-9-20270101');
  assert.ok(r, 'a future opus should still resolve so it never prices at $0');
  assert.equal(r.key, 'opus-5-5', 'family fallback must pick the newest opus, not the first in the object');
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
  // The live table publishes cache prices per model. Cache WRITES are exactly
  // 1.25x / 2x of base input for every row, which is why we hold a multiplier
  // rather than a second hand-maintained price column. Cache READS are 0.1x for
  // every row EXCEPT Fable 5.1 and Mythos 5.1, which are 0.025x — so the read
  // column is asserted against the model's own resolved multiplier, not the
  // sheet-wide default.
  //
  // UPDATED 2026-09-07: this list previously hard-coded seven model ids and
  // multiplied every one by the GLOBAL cache.read_multiplier. That is why
  // landing the per-model override did not break it — none of the seven
  // override anything. An explicit list cannot guard a field it never reaches,
  // so the whole-sheet sweep below is now the real guard and this table is the
  // hand-checked spot-check against the published figures.
  const expect = [
    // [id,               5m write, 1h write, cache hit]
    ['claude-fable-5-1',    12.50,     20,      0.25],   // 0.025x — the new row
    ['claude-mythos-5-1',   12.50,     20,      0.25],   // 0.025x
    ['claude-fable-5',      12.50,     20,      1.00],   // 0.1x, same base rate
    ['claude-mythos-5',     12.50,     20,      1.00],   // 0.1x
    ['claude-opus-5-5',      5.00,      8,      0.20],   // 0.05x — the 2026-09-27 row
    ['claude-opus-5',        6.25,     10,      0.50],   // 0.1x, same family
    ['claude-sonnet-5',      2.50,      4,      0.20],
    ['claude-sonnet-4-6',    3.75,      6,      0.30],
    ['claude-haiku-4-5',     1.25,      2,      0.10],
    ['claude-opus-4-1',     18.75,     30,      1.50],
    ['claude-haiku-3-5',     1.00,   1.60,      0.08],
  ];
  const cache = getLatestPricing().cache;
  for (const [id, w5m, w1h, hit] of expect) {
    const rates = getRates(id, 'standard', '2026-09-27');
    const base = rates.input;
    assert.ok(Math.abs(base * cache.write_multiplier_5m - w5m) < 1e-9, `${id} 5m cache write`);
    assert.ok(Math.abs(base * cache.write_multiplier_1h - w1h) < 1e-9, `${id} 1h cache write`);
    assert.ok(Math.abs(base * rates.cache_read_multiplier - hit) < 1e-9, `${id} cache hit`);
    assert.ok(Math.abs(base * cacheReadMultiplier(id) - hit) < 1e-9, `${id} cache hit via cacheReadMultiplier()`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// PER-MODEL CACHE-READ MULTIPLIER (2026-09-07). Anthropic pricing footnote 1:
// "Cache hits and refreshes on Claude Fable 5.1 and Claude Mythos 5.1 are priced
// at 0.025x the base input price. All other models use the standard 0.1x
// multiplier."
//
// This is the single largest silent-accuracy risk in the 0.3.1 release: Fable 5
// and Fable 5.1 have identical $10/$50 base rates and differ ONLY here, so a
// global multiplier prices one of them wrong by 4x with nothing to notice.
// ───────────────────────────────────────────────────────────────────────────

test('every model in the sheet resolves the cache-read multiplier the sheet declares', () => {
  // The whole-sheet sweep. Unlike the explicit table above, this reaches every
  // row, so a future model that overrides the multiplier cannot be added to the
  // sheet without its override being honoured by the resolver.
  const sheet = getLatestPricing();
  const globalMult = sheet.cache.read_multiplier;
  for (const [key, entry] of Object.entries(sheet.models)) {
    const declared = entry.cache?.read_multiplier ?? globalMult;
    assert.equal(cacheReadMultiplier(`claude-${key}`), declared,
      `${key}: resolver returned the wrong cache-read multiplier`);
    assert.equal(getRates(`claude-${key}`, 'standard', '2026-09-07').cache_read_multiplier, declared,
      `${key}: getRates carried the wrong cache-read multiplier`);
    // And the resolved multiplier must actually reach the cost calc.
    const usd = expectedCost(`claude-${key}`, 'standard', { cache_read_tokens: 1_000_000 });
    assert.ok(Math.abs(usd - entry.input * declared) < 1e-9,
      `${key}: expectedCost did not apply the resolved cache-read multiplier`);
  }
});

test('fable-5-1 cache reads cost $0.25/MTok, not the $1 the global multiplier would give', () => {
  const usd = expectedCost('claude-fable-5-1', 'standard', { cache_read_tokens: 1_000_000 });
  assert.ok(Math.abs(usd - 0.25) < 1e-9, `expected $0.25/MTok, got $${usd}`);
  // The wrong answer, named explicitly so the failure message is unambiguous.
  assert.ok(Math.abs(usd - 1.00) > 1e-9, 'fable-5-1 is being priced at the global 0.1x — 4x too high');
  assert.equal(cacheReadMultiplier('claude-fable-5-1'), 0.025);
  // And through the live payload shapes, not just the bare id.
  for (const id of ['claude-fable-5-1[1m]', 'claude-fable-5-1-20260901']) {
    assert.ok(Math.abs(expectedCost(id, 'standard', { cache_read_tokens: 1_000_000 }) - 0.25) < 1e-9, id);
  }
});

test('DIVERGENCE: identical tokens cost 4x more cache-read on fable-5 than fable-5-1', () => {
  // The two rows are otherwise identical ($10 in / $50 out), so this ratio is
  // purely the cache-read multiplier and nothing else can move it.
  const tokens = { cache_read_tokens: 12_500_000 };
  const five = expectedCost('claude-fable-5', 'standard', tokens);
  const fiveOne = expectedCost('claude-fable-5-1', 'standard', tokens);
  assert.ok(Math.abs(five - 12.50) < 1e-9, `fable-5 should be $12.50, got $${five}`);
  assert.ok(Math.abs(fiveOne - 3.125) < 1e-9, `fable-5-1 should be $3.125, got $${fiveOne}`);
  assert.ok(Math.abs(five / fiveOne - 4) < 1e-9, `expected exactly 4x, got ${five / fiveOne}x`);

  // Base rates really are identical — so nothing but the cache multiplier can
  // account for the gap. Uncached input and output must net exactly zero.
  const plain = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
  assert.equal(
    expectedCost('claude-fable-5', 'standard', plain),
    expectedCost('claude-fable-5-1', 'standard', plain),
    'fable-5 and fable-5-1 must have identical non-cache pricing');
});

test('mythos-5-1 overrides but mythos-5 does not — the footnote names only the 5.1 pair', () => {
  assert.equal(cacheReadMultiplier('claude-mythos-5-1'), 0.025);
  assert.equal(cacheReadMultiplier('claude-mythos-5'), 0.10);
  assert.equal(cacheReadMultiplier('claude-fable-5'), 0.10);
});

test('the global multiplier stays 0.1 and still applies to every non-overriding model', () => {
  // The override must not have been implemented by moving the default.
  const sheet = getLatestPricing();
  assert.equal(sheet.cache.read_multiplier, 0.10);
  const overriding = Object.entries(sheet.models)
    .filter(([, m]) => m.cache?.read_multiplier !== undefined).map(([k]) => k).sort();
  // THREE multipliers since 2026-09-27: 0.1 default, 0.05 Opus 5.5, 0.025 Fable
  // 5.1 / Mythos 5.1 (pricing page §Prompt caching). This assertion failed the
  // moment the 2026-09-27 sheet landed, which is the guard doing its job — it was
  // extended with opus-5-5 at its own value, not loosened.
  assert.deepEqual(overriding, ['fable-5-1', 'mythos-5-1', 'opus-5-5'],
    'the set of models overriding the cache-read multiplier changed — verify against the pricing table before accepting');
  const values = Object.fromEntries(Object.entries(sheet.models)
    .filter(([, m]) => m.cache?.read_multiplier !== undefined).map(([k, m]) => [k, m.cache.read_multiplier]));
  assert.deepEqual(values, { 'fable-5-1': 0.025, 'mythos-5-1': 0.025, 'opus-5-5': 0.05 });
});

test('an unresolvable model falls back to the global multiplier rather than throwing', () => {
  // Such a turn is already flagged unpriceable by priceTurn(), so this value
  // never reaches a presented figure on its own — but it must not crash.
  assert.equal(cacheReadMultiplier('claude-fable-99'), 0.10);
  assert.equal(cacheReadMultiplier(null), 0.10);
  assert.equal(cacheReadMultiplier(''), 0.10);
});

// A2: parseModelId must not mangle the `-1` in `fable-5-1`. The date-suffix
// strip is `-\d{8}$` — eight digits — so it should leave a single trailing digit
// alone. That is true until it isn't, so it is pinned here rather than assumed.
test('A2: claude-fable-5-1 survives every live id shape without losing its -1', () => {
  const cases = [
    ['claude-fable-5-1',                   null,        'fable-5-1', true],
    ['claude-fable-5-1[1m]',               null,        'fable-5-1', true],
    ['vertex_ai/claude-fable-5-1',         'vertex_ai', 'fable-5-1', false],
    ['anthropic.claude-fable-5-1-20260901','bedrock',   'fable-5-1', false],
    ['bedrock/anthropic.claude-fable-5-1', 'bedrock',   'fable-5-1', false],
    ['claude-fable-5-1-20260901',          null,        'fable-5-1', true],
    ['claude-mythos-5-1',                  null,        'mythos-5-1', true],
  ];
  for (const [id, provider, key, priceable] of cases) {
    const parsed = parseModelId(id);
    assert.equal(parsed.key, key, `parseModelId("${id}").key`);
    assert.equal(parsed.provider, provider, `parseModelId("${id}").provider`);
    const resolved = getModelEntry(id);
    assert.ok(resolved, `${id} must resolve — an unresolved default Fable model prices at nothing`);
    assert.equal(resolved.key, key);
    assert.equal(resolved.fallback, false, `${id} must resolve exactly, never by family fallback`);
    assert.equal(resolved.priceable, priceable, `${id} priceable`);
    // The override must survive every shape, including the partner-served ones.
    assert.equal(cacheReadMultiplier(id), 0.025, `${id} lost its 0.025x cache multiplier`);
  }
});

test('A2: an unrecognised fable id stays null — no fable family fallback, ever', () => {
  // A fable fallback would silently price the NEXT Fable at whichever Fable
  // happened to sort last, and the two live Fables differ 4x on cache reads.
  // Returning null keeps the turn flagged instead of quietly mis-pricing it.
  for (const id of ['claude-fable-99', 'claude-fable-6', 'claude-fable-5-2', 'claude-mythos-6']) {
    assert.equal(getModelEntry(id), null, `${id} must not resolve`);
    assert.equal(getRates(id), null, `${id} must not price`);
    const priced = priceTurn(id, 'standard', { cache_read_tokens: 1_000_000 });
    assert.equal(priced.priceable, false, `${id} must be flagged unpriceable`);
    assert.equal(priced.reason, 'unresolved-model');
  }
});

// ───────────────────────────────────────────────────────────────────────────
// B2 / B6 / F12 — facts verified against Anthropic primaries on 2026-09-07.
// These pin the SHEET's encoding of them so a later edit cannot quietly
// contradict a fact somebody actually went and read.
// ───────────────────────────────────────────────────────────────────────────

test('B2: the Team seat split stays encoded — the pricing page collapses it, the Help Center does not', () => {
  // claude.com/pricing's models table shows ONE Team column reading "No" for
  // Fable. Help Center 15424964 states the split explicitly: included on
  // "premium seats on Team plans", usage credits on "Team standard seats".
  // The sheet must keep both, and the plan prices prove the seat types exist.
  const p = getLatestPricing();
  assert.ok(p.fable.included_plans.includes('team_premium'), 'Team Premium must stay in included_plans');
  assert.ok(p.fable.credits_plans.includes('team_standard'), 'Team Standard must stay in credits_plans');
  assert.equal(p.plans.team_standard.price_monthly_annual_billing, 20);
  assert.equal(p.plans.team_premium.price_monthly_annual_billing, 100);
});

test('F12: promotional credits are FABLE 5 ONLY and the sheet says so', () => {
  // Help Center 15424964: the credit "applied to the Fable 5 change only, and
  // there's no equivalent credit for Fable 5.1." Scoping this wrong would show
  // a Fable 5.1 user a countdown to an expiry they have nothing riding on.
  const f = getLatestPricing().fable;
  assert.deepEqual(f.promo_credit_scope, ['fable-5']);
  assert.ok(!f.promo_credit_scope.includes('fable-5-1'), 'Fable 5.1 was never part of the promotion');
  // Dates verified same-day against Help Center 15862783 (2026-09-07), and
  // re-read after the date by the PMO (2026-09-27): still that date, now PASSED.
  assert.equal(f.promo_credit_expiry, '2026-09-17');
  assert.equal(f.promo_credit_claiming_closed, '2026-08-02');
  assert.equal(f.promo_credit_expiry_verified, '2026-09-07');
  assert.equal(f.promo_credit_expires_at, '2026-09-17T23:59:00-07:00', '11:59 PM PT is PDT (UTC-7) in September');
  assert.equal(f.promo_credit_status, 'expired');
  assert.equal(f.promo_credit_status_verified, '2026-09-27');
  // And the 50%-inclusion promotion's end date, which is a DIFFERENT mechanic.
  assert.equal(f.historical_boundary_date, '2026-07-19');
});

test('F12: the credit-expiry date is verified, and jurisdiction scope stays hedged', () => {
  const c = getLatestPricing().credits;
  assert.equal(c.expire, true);
  assert.equal(c.expiry_begins, '2026-09-10');
  assert.equal(c.expiry_window_months, 6);
  assert.equal(c.jurisdiction_scoped, true);
  assert.equal(c.expiry_begins_verified, '2026-09-07');
  // Sep 10 has passed: the expiry is in effect, wording unchanged (re-read by
  // slugged URL 2026-09-27).
  assert.equal(c.expiry_in_effect, true);
  assert.equal(c.expiry_begins_reverified, '2026-09-27');
});

test('B6 CLOSED: max_20x $200 is VERIFIED, with the primary that states it', () => {
  // Carried unverified for three releases. Help Center 11049741 — fetched by its
  // SLUGGED url, title "What is the Max plan?", read 2026-09-27 — states "Max
  // 20x: $200 per month". The 2026-09-07 miss was most likely the bare-URL trap:
  // /articles/<id> can serve a different or partial article.
  const plans = getLatestPricing().plans;
  assert.equal(plans.max_20x.price_monthly, 200);
  assert.equal(plans.max_20x.price_monthly_verified, true);
  assert.equal(plans.max_20x.price_monthly_verified_date, '2026-09-27');
  assert.equal(plans.max_20x.price_monthly_source,
    'https://support.claude.com/en/articles/11049741-what-is-the-max-plan',
    'cite the SLUGGED url — the bare numeric one is the trap that hid this fact');
  assert.ok(plans.max_20x.price_monthly_note.includes('Max 20x: $200 per month'));
  assert.ok(!plans.max_20x.price_monthly_note.includes('NOT VERIFIED'));
  assert.equal(plans.max_5x.price_monthly, 100);
  assert.equal(plans.max_5x.price_monthly_verified, true);
});

// ───────────────────────────────────────────────────────────────────────────
// BUILD-017 (2026-09-27) — Claude Opus 5.5.
//
// Claude Code 2.1.280 made Opus 5.5 the default model on every paid plan. Its
// rates differ from Opus 5's on EVERY axis — $4/$20 vs $5/$25, and a 0.05x cache
// read ($0.20) vs 0.1x ($0.50) — so the opus family fallback that caught it in
// the 2026-09-07 sheet mis-priced every one of its turns. All figures below are
// from the pricing page read 2026-09-27; "derived" marks the one the page does
// not print.
// ───────────────────────────────────────────────────────────────────────────

const near = (a, b) => Math.abs(a - b) < 1e-9;

test('A1 (2026-09-27): all 18 live pricing-table rows resolve exactly, cache columns included', () => {
  // [payload-shaped id, input, 5m write, 1h write, cache hit, output]
  const TABLE = [
    ['claude-fable-5-1',             10, 12.50, 20,   0.25, 50],
    ['claude-mythos-5-1',            10, 12.50, 20,   0.25, 50],
    ['claude-fable-5',               10, 12.50, 20,   1.00, 50],
    ['claude-mythos-5',              10, 12.50, 20,   1.00, 50],
    ['claude-opus-5-5',               4,  5.00,  8,   0.20, 20],
    ['claude-opus-5',                 5,  6.25, 10,   0.50, 25],
    ['claude-opus-4-8',               5,  6.25, 10,   0.50, 25],
    ['claude-opus-4-7',               5,  6.25, 10,   0.50, 25],
    ['claude-opus-4-6',               5,  6.25, 10,   0.50, 25],
    ['claude-opus-4-5-20251101',      5,  6.25, 10,   0.50, 25],
    ['claude-opus-4-1-20250805',     15, 18.75, 30,   1.50, 75],
    ['claude-opus-4-20250514',       15, 18.75, 30,   1.50, 75],
    ['claude-sonnet-5',               2,  2.50,  4,   0.20, 10],
    ['claude-sonnet-4-6',             3,  3.75,  6,   0.30, 15],
    ['claude-sonnet-4-5-20250929',    3,  3.75,  6,   0.30, 15],
    ['claude-sonnet-4-20250514',      3,  3.75,  6,   0.30, 15],
    ['claude-haiku-4-5-20251001',     1,  1.25,  2,   0.10,  5],
    ['claude-haiku-3-5-20241022',   0.8,  1.00, 1.6,  0.08,  4],
  ];
  assert.equal(TABLE.length, 18);
  assert.equal(Object.keys(getLatestPricing().models).length, 18, 'the sheet must carry exactly the live table');
  assert.equal(getLatestPricing().source.table_rows, 18);
  for (const [id, input, w5, w1, hit, output] of TABLE) {
    const r = getRates(id, 'standard', '2026-09-27');
    assert.ok(r, `${id} must resolve`);
    assert.equal(r.fallback, false, `${id} must not resolve by family fallback`);
    assert.deepEqual([r.input, r.output], [input, output], `${id} base rates`);
    const t = tok => expectedCost(id, 'standard', tok, '2026-09-27');
    assert.ok(near(t({ cache_write_tokens: 1_000_000, cache_ttl: '5m' }), w5), `${id} 5m write`);
    assert.ok(near(t({ cache_write_tokens: 1_000_000, cache_ttl: '1h' }), w1), `${id} 1h write`);
    assert.ok(near(t({ cache_read_tokens: 1_000_000 }), hit), `${id} cache hit`);
  }
});

test('A1 ACCEPTANCE: 1M cache-read tokens — $0.20 opus-5-5, $0.50 opus-5, $0.25 fable-5-1, $1.00 fable-5, $0.20 sonnet-5', () => {
  const read = id => expectedCost(id, 'standard', { cache_read_tokens: 1_000_000 }, '2026-09-27');
  assert.ok(near(read('claude-opus-5-5'), 0.20), `opus-5-5 $${read('claude-opus-5-5')}`);
  assert.ok(near(read('claude-opus-5'), 0.50), `opus-5 $${read('claude-opus-5')}`);
  assert.ok(near(read('claude-fable-5-1'), 0.25), `fable-5-1 $${read('claude-fable-5-1')}`);
  assert.ok(near(read('claude-fable-5'), 1.00), `fable-5 $${read('claude-fable-5')}`);
  assert.ok(near(read('claude-sonnet-5'), 0.20), `sonnet-5 $${read('claude-sonnet-5')}`);
});

test('A1 ACCEPTANCE: opus-5-5 is $4 in / $20 out per 1M (against $5 / $25 on opus-5)', () => {
  const cost = (id, tok) => expectedCost(id, 'standard', tok, '2026-09-27');
  assert.ok(near(cost('claude-opus-5-5', { input_tokens: 1_000_000 }), 4));
  assert.ok(near(cost('claude-opus-5-5', { output_tokens: 1_000_000 }), 20));
  assert.ok(near(cost('claude-opus-5', { input_tokens: 1_000_000 }), 5));
  assert.ok(near(cost('claude-opus-5', { output_tokens: 1_000_000 }), 25));
});

test('A1 ACCEPTANCE: opus-5-5 cache writes are $5 (5-minute) / $8 (1-hour) — the global 1.25x / 2x', () => {
  const w = ttl => expectedCost('claude-opus-5-5', 'standard', { cache_write_tokens: 1_000_000, cache_ttl: ttl }, '2026-09-27');
  assert.ok(near(w('5m'), 5), `5m $${w('5m')}`);
  assert.ok(near(w('1h'), 8), `1h $${w('1h')}`);
  // No TTL evidence => the 1-hour default.
  assert.ok(near(w(undefined), 8));
});

test('A1 ACCEPTANCE: a fast opus-5-5 turn is $8 in, $40 out, and cache reads $0.40 (derived)', () => {
  // "Prompt caching multipliers apply on top of fast mode pricing" (pricing page
  // §Fast mode). The page prints $8/$40 but NOT the fast cache-read figure; it is
  // derived by that stated rule: 0.05 x $8 = $0.40/MTok.
  const fast = tok => priceTurn('claude-opus-5-5', 'fast', tok, '2026-09-27');
  assert.ok(near(fast({ input_tokens: 1_000_000 }).usd, 8));
  assert.ok(near(fast({ output_tokens: 1_000_000 }).usd, 40));
  const cr = fast({ cache_read_tokens: 1_000_000 });
  assert.ok(near(cr.usd, 0.40), `fast cache read $${cr.usd}, expected $0.40`);
  assert.equal(cr.priceable, true);
  // Wrong answers, named: the standard-rate read ($0.20), the global 0.1x on the
  // fast rate ($0.80), and Opus 5's fast read ($1.00).
  for (const wrong of [0.20, 0.80, 1.00]) assert.ok(!near(cr.usd, wrong), `fast cache read must not be $${wrong}`);
  assert.ok(near(priceTurn('claude-opus-5', 'fast', { cache_read_tokens: 1_000_000 }, '2026-09-27').usd, 1.00),
    'Opus 5 fast cache read stays 0.1 x $10');
});

test('DIVERGENCE: identical tokens cost 2.5x more cache-read on opus-5 than opus-5-5', () => {
  const tokens = { cache_read_tokens: 12_500_000 };
  const five = expectedCost('claude-opus-5', 'standard', tokens, '2026-09-27');
  const fiveFive = expectedCost('claude-opus-5-5', 'standard', tokens, '2026-09-27');
  assert.ok(near(five, 6.25), `opus-5 should be $6.25, got $${five}`);
  assert.ok(near(fiveFive, 2.50), `opus-5-5 should be $2.50, got $${fiveFive}`);
  assert.ok(near(five / fiveFive, 2.5), `expected exactly 2.5x, got ${five / fiveFive}x`);
  // Unlike the Fable pair, the base rates differ too — 20% on input and output.
  const plain = { input_tokens: 1_000_000, output_tokens: 1_000_000 };
  assert.ok(near(expectedCost('claude-opus-5', 'standard', plain) / expectedCost('claude-opus-5-5', 'standard', plain), 30 / 24));
});

test('opus-5-5 and sonnet-5 share a $0.20 cache read — so input and output are asserted too', () => {
  // A mapping error between these two ids would pass any cache-only test.
  const o = getRates('claude-opus-5-5', 'standard', '2026-09-27');
  const s = getRates('claude-sonnet-5', 'standard', '2026-09-27');
  assert.ok(near(o.input * o.cache_read_multiplier, s.input * s.cache_read_multiplier), 'shared $0.20 cache read');
  assert.deepEqual([o.key, o.input, o.output, o.cache_read_multiplier], ['opus-5-5', 4, 20, 0.05]);
  assert.deepEqual([s.key, s.input, s.output, s.cache_read_multiplier], ['sonnet-5', 2, 10, 0.1]);
});

test('A2: claude-opus-5-5 resolves exactly through every live id shape — pinned by running parseModelId', () => {
  const cases = [
    // [id,                                    provider,    priceable]
    ['claude-opus-5-5',                          null,        true],
    ['claude-opus-5-5[1m]',                      null,        true],
    ['claude-opus-5-5-20260922',                 null,        true],
    ['claude-opus-5-5-20260922[1m]',             null,        true],
    ['vertex_ai/claude-opus-5-5',                'vertex_ai', false],
    ['bedrock/anthropic.claude-opus-5-5',        'bedrock',   false],
    ['bedrock/anthropic.claude-opus-5-5-20260922', 'bedrock', false],
    ['anthropic.claude-opus-5-5',                'bedrock',   false],
  ];
  for (const [id, provider, priceable] of cases) {
    const parsed = parseModelId(id);
    assert.equal(parsed.key, 'opus-5-5', `parseModelId("${id}").key — the -5 must survive the date strip`);
    assert.equal(parsed.provider, provider, `parseModelId("${id}").provider`);
    const r = getModelEntry(id);
    assert.equal(r.key, 'opus-5-5', `${id} resolved to ${r.key}`);
    assert.equal(r.fallback, false, `${id} must resolve exactly, never by the opus family fallback`);
    assert.equal(r.priceable, priceable, `${id} priceable`);
    assert.equal(cacheReadMultiplier(id), 0.05, `${id} lost its 0.05x cache multiplier`);
  }
  // And the shape that USED to miss (the 2026-09-07 sheet) now does not fall back.
  assert.notEqual(getModelEntry('claude-opus-5-5').key, 'opus-5');
});

test('mythos-5-1 carries its deprecations-table retirement floor (2027-09-01) — the "no row" note is gone', () => {
  const m = getLatestPricing().models['mythos-5-1'];
  assert.equal(m.retirement_not_before, '2027-09-01');
  assert.ok(!/not listed on the model-deprecations/i.test(m.note), 'the old "no row" note must not survive');
  assert.equal(getLatestPricing().models['opus-5-5'].retirement_not_before, '2027-09-22');
  assert.equal(getLatestPricing().models['opus-5'].retirement_not_before, '2027-07-24', 'Opus 5 stays Active');
});

test('opus-5 stays fully priced and is described as history, not as the default — and never as retired', () => {
  const m = getLatestPricing().models['opus-5'];
  assert.deepEqual([m.input, m.output, m.fast_mode.input, m.fast_mode.output], [5, 25, 10, 50]);
  assert.ok(!m.retired, 'Opus 5 is Active on the Claude API');
  assert.match(m.note, /from v2\.1\.219 until v2\.1\.280/);
  assert.ok(!/deprecated|retired\b(?! entries)/i.test(m.note.replace(/nothing we publish may call Opus 5 deprecated or retired/i, '')),
    'the note may only mention deprecation to forbid it');
});
