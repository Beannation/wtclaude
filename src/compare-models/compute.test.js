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
  // Sonnet 5 = $2/$10, Opus 5 = $5/$25, Fable 5 = $10/$50 (live pricing table,
  // read 2026-08-24). Opus 5 replaced Opus 4.8 in the comparison set; both are
  // $5/$25, so the hand-calc is unchanged.
  const s = repriceSurface([turn('sonnet-5')], { today: '2026-07-15', days: 30 });
  assert.equal(round(findModel(s, 'sonnet-5').window_usd), 12); // 2 + 10
  assert.equal(round(findModel(s, 'opus-5').window_usd), 30);   // 5 + 25
  assert.equal(round(findModel(s, 'fable-5').window_usd), 60);  // 10 + 50
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
  assert.deepEqual(cmp.models.map(m => m.key), ['opus-5', 'sonnet-5', 'fable-5']);
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
  assert.ok(blob.includes('50%') && blob.includes('july 19'), 'Fable allowance mechanic stated');
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
