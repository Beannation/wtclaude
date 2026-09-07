import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeComparison, repriceSurface, COMPARE_MODELS, CAVEATS } from './compute.js';

// One turn = exactly 1M input + 1M output tokens, no cache, so re-pricing at a
// model's $in/$out rate is trivially checkable by hand.
function turn(model) {
  return { model, input_tokens: 1_000_000, output_tokens: 1_000_000, cache_read_tokens: 0, cache_write_tokens: 0 };
}
function findModel(surface, key) { return surface.models.find(m => m.key === key); }

test('3-model re-pricing reconciles to a hand-calc (1M in + 1M out)', () => {
  // Sonnet 5 = $2/$10, Opus 5 = $5/$25, Fable 5.1 = $10/$50 (live pricing table,
  // read 2026-09-07). Opus 5 replaced Opus 4.8 in the comparison set and Fable
  // 5.1 replaced Fable 5; Fable 5 and 5.1 share $10/$50 base rates, so this
  // no-cache hand-calc is unchanged by the swap. The two diverge only on cached
  // input — pinned separately below.
  const s = repriceSurface([turn('sonnet-5')], { today: '2026-07-15', days: 30 });
  assert.equal(round(findModel(s, 'sonnet-5').window_usd), 12);   // 2 + 10
  assert.equal(round(findModel(s, 'opus-5').window_usd), 30);     // 5 + 25
  assert.equal(round(findModel(s, 'fable-5-1').window_usd), 60);  // 10 + 50
});

test('a no-op switch (re-pricing a model you already run) nets ~$0', () => {
  const s = repriceSurface([turn('sonnet-5'), turn('sonnet-5')], { today: '2026-07-15', days: 30 });
  const sonnet = findModel(s, 'sonnet-5');
  assert.equal(round(sonnet.delta_vs_baseline_usd), 0);
  assert.equal(sonnet.delta_pct, 0);
  // The baseline equals the all-Sonnet re-price because every turn already ran Sonnet.
  assert.equal(round(s.baseline_window_usd), round(sonnet.window_usd));
});

// REGRESSION GUARD (2026-08-24): this used to assert the Sonnet-5 step-up fired
// here too ($18 = 3 + 15). Anthropic cancelled it; compare-models must price
// Sonnet 5 at $2/$10 on every date. 1M input + 1M output = 2 + 10 = $12.
test('compare-models never applies the cancelled Sonnet-5 step-up', () => {
  for (const today of ['2026-08-30', '2026-08-31', '2026-09-01', '2027-01-01']) {
    const s = repriceSurface([turn('sonnet-5')], { today, days: 30 });
    assert.equal(round(findModel(s, 'sonnet-5').window_usd), 12, `sonnet-5 window on ${today}`);
  }
});

test('per-surface split renders: Code billing-grade, Cowork estimate, Chat excluded', () => {
  const cmp = computeComparison({
    codeTurns: [turn('opus-4-8')],
    coworkTurns: [],
    today: '2026-07-15',
    days: 30,
  });
  assert.equal(cmp.surfaces.code.grade, 'billing-grade');
  assert.equal(cmp.surfaces.code.present, true);
  assert.equal(cmp.surfaces.cowork.grade, 'estimate');
  assert.equal(cmp.surfaces.cowork.present, false); // no cowork data => not fabricated
  assert.equal(cmp.surfaces.chat.grade, 'excluded');
  assert.equal(cmp.surfaces.chat.present, false);
  // Each present surface carries all three models.
  assert.equal(cmp.surfaces.code.models.length, 3);
  assert.deepEqual(cmp.models.map(m => m.key), ['opus-5', 'sonnet-5', 'fable-5-1']);
});

test('the total inherits the estimate (lowest) label and stays present with Code data', () => {
  const cmp = computeComparison({ codeTurns: [turn('opus-4-8')], today: '2026-07-15', days: 30 });
  assert.equal(cmp.total.grade, 'estimate');
  assert.equal(cmp.total.present, true);
});

test('Cowork turns, when present, re-price as a labeled estimate surface', () => {
  const cmp = computeComparison({
    codeTurns: [turn('opus-4-8')],
    coworkTurns: [turn('sonnet-5')],
    today: '2026-07-15',
    days: 30,
  });
  assert.equal(cmp.surfaces.cowork.present, true);
  assert.equal(cmp.surfaces.cowork.grade, 'estimate');
  assert.equal(round(findModel(cmp.surfaces.cowork, 'sonnet-5').window_usd), 12);
});

test('monthly projection scales the window to 30 days', () => {
  // 15-day window, one 1M+1M Sonnet turn: window $12 -> monthly $24.
  const s = repriceSurface([turn('sonnet-5')], { today: '2026-07-15', days: 15 });
  assert.equal(round(findModel(s, 'sonnet-5').monthly_usd), 24);
});

test('caveats are honest: no first/only, Fable framed as allowance not free, quality disclaimed', () => {
  assert.ok(CAVEATS.length >= 3);
  const blob = CAVEATS.join(' ').toLowerCase();
  assert.ok(!/\bfirst\b|\bonly\b/.test(blob), 'no first/only');
  assert.ok(!/\bfree\b/.test(blob), 'Fable never described as free');
  // CORRECTED 2026-09-07. This line used to assert the caveat contained
  // "july 19" — i.e. the test was PINNING a countdown that had been false since
  // 2026-07-20, so the wrong copy could never be caught by the suite. It now
  // asserts the plan-conditional mechanic AND that no month-date countdown has
  // come back.
  assert.ok(blob.includes('50%'), 'Fable allowance mechanic stated');
  assert.ok(blob.includes('plan-conditional'), 'Fable framed as plan-conditional, not date-bounded');
  assert.ok(
    !/\b(through|until)\s+~?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(blob),
    'no date countdown on Fable inclusion — it is plan-conditional, not date-bounded');
  assert.ok(blob.includes('not the same task') , 'tokenizer/recorded-usage caveat present');
  assert.ok(blob.includes('quality'), 'cost-not-quality caveat present');
});

function round(n) { return Math.round(n * 1e6) / 1e6; }

test('compare-models excludes partner-platform turns from both sides and counts them', () => {
  // Same rule as `whatif`: a Bedrock- or Vertex-served turn is a real Anthropic
  // model, but those platforms publish their own rates, so pricing it at our
  // first-party rate and presenting it as our estimate is not something we can
  // stand behind. Letting it through at $0 removed real spend from the baseline.
  const s = repriceSurface(
    [turn('sonnet-5'), turn('vertex_ai/claude-sonnet-5')],
    { today: '2026-08-24', days: 30 });
  assert.equal(s.turn_count, 1, 'only the priceable turn is compared');
  assert.equal(s.unpriced_turn_count, 1);
  assert.deepEqual(s.unpriced_models, ['vertex_ai/claude-sonnet-5']);
  assert.equal(round(s.baseline_window_usd), 12, 'baseline is the one priceable turn, not two');
});

// ───────────────────────────────────────────────────────────────────────────
// B1 (2026-09-07). Tracing a `claude-fable-5-1` turn through shipped 0.3.0
// showed the honest exclusion was invisible where it mattered: the comparison
// dropped the turn from both sides AND from the baseline, reported that only in
// `--json`, and printed a table that silently omitted the user's most expensive
// turn. The DATA carried it all along — these pin that it keeps doing so, and
// cli/compare-models.js now renders it.
// ───────────────────────────────────────────────────────────────────────────

test('B1: an unresolvable model is excluded from the baseline and reported, not hidden', () => {
  const s = repriceSurface(
    [turn('opus-5'), turn('claude-fable-9-9')],
    { today: '2026-09-07', days: 30 });
  assert.equal(s.turn_count, 1, 'only the priceable turn is compared');
  assert.equal(s.unpriced_turn_count, 1, 'the exclusion must be counted, never silent');
  assert.deepEqual(s.unpriced_models, ['claude-fable-9-9'], 'and the model named');
  // The baseline excludes it too — that is the honest choice (a $0 turn would
  // remove real spend from the baseline and make every switch look cheaper),
  // but it is exactly why the count has to be rendered to the user.
  assert.equal(round(s.baseline_window_usd), 30, 'baseline is the one priceable turn');
});

test('B1: a Fable 5.1 turn is now fully priceable — the 0.3.0 exclusion is closed', () => {
  const s = repriceSurface([turn('claude-fable-5-1')], { today: '2026-09-07', days: 30 });
  assert.equal(s.unpriced_turn_count, 0, 'fable-5-1 must no longer be excluded');
  assert.equal(s.turn_count, 1);
  assert.equal(round(findModel(s, 'fable-5-1').window_usd), 60);
  // And through the live payload shape the collector actually records.
  const live = repriceSurface([turn('claude-fable-5-1[1m]')], { today: '2026-09-07', days: 30 });
  assert.equal(live.unpriced_turn_count, 0);
});

test('B1: the comparison surfaces Fable 5.1 cheaper than Fable 5 on cache-heavy usage', () => {
  // Same turn, 8M cache reads and little else — the shape of an agentic session.
  // This is the arithmetic we are allowed to state: a cache read costs a quarter
  // on 5.1 of what it costs on 5. It is NOT a claim about anyone's savings.
  const cacheHeavy = {
    model: 'opus-5', input_tokens: 0, output_tokens: 0,
    cache_read_tokens: 8_000_000, cache_write_tokens: 0,
  };
  const s = repriceSurface([cacheHeavy], { today: '2026-09-07', days: 30 });
  const f51 = findModel(s, 'fable-5-1');
  assert.ok(f51, 'fable-5-1 is in the comparison set');
  // 8M cache reads x $10/MTok x 0.025 = $2.00 on Fable 5.1.
  assert.equal(round(f51.window_usd), 2);
});
