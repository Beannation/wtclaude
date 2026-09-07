import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fableDailyRunRate, isFableTurn, fableAttribution, fableTurnBilling } from './fablepool.js';

const fableTurn = (over = {}) => ({
  ts: '2026-06-09T12:00:00.000Z', model: 'claude-fable-5[1m]',
  input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
  speed_tier: 'standard', ...over,
});

test('isFableTurn matches the live payload id, not Opus', () => {
  assert.equal(isFableTurn(fableTurn()), true);
  assert.equal(isFableTurn({ model: 'claude-opus-4-8[1m]' }), false);
});

test('forecast anchors on the per-turn notional cost when present', () => {
  const rr = fableDailyRunRate([
    fableTurn({ cost_usd: 0.2276 }),
    fableTurn({ cost_usd: 0.137 }),
  ]);
  assert.equal(rr.fableTurns, 2);
  assert.equal(rr.anchoredTurns, 2);
  assert.equal(rr.estimatedTurns, 0);
  assert.ok(Math.abs(rr.sum - 0.3646) < 1e-9);
});

test('run-rate averages across days with Fable data', () => {
  const rr = fableDailyRunRate([
    fableTurn({ cost_usd: 0.2, ts: '2026-06-08T12:00:00.000Z' }),
    fableTurn({ cost_usd: 0.4, ts: '2026-06-09T12:00:00.000Z' }),
  ]);
  assert.equal(rr.days, 2);
  assert.ok(Math.abs(rr.avgPerDay - 0.3) < 1e-9);
});

test('a mixed Fable/Opus fallback session attributes per recorded model (§C3)', () => {
  // After a content fallback the session continues on Opus and the collector
  // stamps post-flip deltas with the Opus id — those must never be costed as
  // Fable (and vice versa).
  const rr = fableDailyRunRate([
    fableTurn({ cost_usd: 0.1 }),
    { ts: '2026-06-09T12:01:00.000Z', model: 'claude-opus-4-8[1m]', cost_usd: 0.05,
      input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
  ]);
  assert.equal(rr.fableTurns, 1);
  assert.ok(Math.abs(rr.sum - 0.1) < 1e-9, 'post-flip Opus delta excluded from the Fable stream');
});

test('anchor-less turns fall back to cache-aware token math (cached input $1, not $10)', () => {
  const rr = fableDailyRunRate([
    fableTurn({ input_tokens: 1_000_000, cache_read_tokens: 1_000_000, output_tokens: 100_000 }),
  ]);
  assert.equal(rr.estimatedTurns, 1);
  // $10 input + $1 cache read + $5 output (0.1M × $50) = $16. Costing the
  // cached MTok at the $10 base rate instead would read $25 — the ~10x
  // overstatement the honesty flag guards against.
  assert.ok(Math.abs(rr.sum - 16) < 1e-9, `want $16, got ${rr.sum}`);
});

// ───────────────────────────────────────────────────────────────────────────
// A2 ACCEPTANCE — Fable is plan-conditional, not a date cliff.
//
// Fixture spans 2026-07-15 to 2026-07-25, straddling the 2026-07-20 permanence
// change, so it exercises both the historical rule and the plan rule.
// ───────────────────────────────────────────────────────────────────────────
const span = ['2026-07-15', '2026-07-18', '2026-07-19', '2026-07-21', '2026-07-25']
  .map(d => ({ ts: `${d}T12:00:00.000Z`, model: 'claude-fable-5[1m]', cost_usd: 1,
               input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 }));

test('A2: an included-plan user shows weekly-limit attribution after Jul-20, never a credits wallet', () => {
  const a = fableAttribution(span, 'max_20x');
  assert.equal(a.planKnown, true);
  assert.equal(a.byBilling.included_weekly.turns, 2, 'the Jul-21 and Jul-25 turns are included usage');
  assert.equal(a.byBilling.usage_credits, undefined, 'an included plan must produce NO credits attribution');
  // The pre-permanence turns read on the old rule, not on today's plan.
  assert.equal(a.byBilling.included_historical.turns, 3, 'Jul-15/18/19 were included under the old mechanic');
});

test('A2: a Pro user shows usage credits after Jul-20', () => {
  const a = fableAttribution(span, 'pro');
  assert.equal(a.byBilling.usage_credits.turns, 2, 'the Jul-21 and Jul-25 turns bill credits on Pro');
  assert.equal(a.byBilling.included_weekly, undefined);
  assert.equal(a.byBilling.included_historical.turns, 3);
});

test('A2: Team Premium is included, Team Standard bills credits', () => {
  assert.equal(fableTurnBilling({ ts: '2026-08-24T00:00:00Z' }, 'team_premium'), 'included_weekly');
  assert.equal(fableTurnBilling({ ts: '2026-08-24T00:00:00Z' }, 'team_standard'), 'usage_credits');
  assert.equal(fableTurnBilling({ ts: '2026-08-24T00:00:00Z' }, 'enterprise_standard'), 'org_conditional');
});

test('A2: with no plan configured we say "unknown" — we never guess a charge', () => {
  const a = fableAttribution(span, null);
  assert.equal(a.planKnown, false);
  assert.equal(a.byBilling.unknown.turns, 2, 'post-permanence turns are unresolved without a plan');
  assert.equal(a.byBilling.usage_credits, undefined, 'guessing credits would fabricate a bill');
  assert.equal(a.byBilling.included_weekly, undefined, 'guessing included would hide a real one');
});

test('A2: the old date-based mechanic still reads correctly for historical records', () => {
  // Before 2026-07-20 the rule was date-based for everyone: included through
  // 2026-07-19, usage credits from 2026-07-20. A record from 2026-07-19 is
  // included regardless of the plan configured today.
  assert.equal(fableTurnBilling({ ts: '2026-07-19T23:00:00Z' }, 'pro'), 'included_historical');
  assert.equal(fableTurnBilling({ ts: '2026-07-19T23:00:00Z' }, 'max_20x'), 'included_historical');
});

// ───────────────────────────────────────────────────────────────────────────
// A5 (2026-09-07) — Fable 5.1 in the pool. `isFableTurn` is
// `key.startsWith('fable')`, so 5.1 SHOULD already count. The kickoff's own
// instruction was to verify that with a test rather than trust the read, and
// to check that a 5.1 turn attributes exactly the way a Fable 5 turn does —
// the plan mechanic is family-scoped, so it must.
// ───────────────────────────────────────────────────────────────────────────

test('A5: a Fable 5.1 turn counts toward the Fable pool, in every live id shape', () => {
  const shapes = [
    'claude-fable-5-1',
    'claude-fable-5-1[1m]',
    'claude-fable-5-1-20260901',
    'vertex_ai/claude-fable-5-1',
    'bedrock/anthropic.claude-fable-5-1',
    'claude-mythos-5-1',
  ];
  for (const model of shapes) {
    assert.equal(isFableTurn({ model }), model.includes('fable'), `isFableTurn("${model}")`);
  }
  // And the negative cases, so the family test is not simply "always true".
  for (const model of ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', null, undefined, '']) {
    assert.equal(isFableTurn({ model }), false, `isFableTurn("${model}") must be false`);
  }
});

test('A5: a Fable 5.1 turn attributes identically to a Fable 5 turn on every plan', () => {
  // The plan mechanic is family-scoped (claude.com/pricing states the plan rows
  // generically as "Fable"), so the ONLY thing that may differ between a 5 and a
  // 5.1 turn is the price — never the billing attribution.
  const ts = '2026-09-05T10:00:00.000Z';
  for (const plan of ['max_5x', 'max_20x', 'team_premium', 'pro', 'team_standard', 'enterprise_standard', null]) {
    const five = fableTurnBilling({ model: 'claude-fable-5', ts }, plan);
    const fiveOne = fableTurnBilling({ model: 'claude-fable-5-1', ts }, plan);
    assert.equal(fiveOne, five, `plan ${plan}: fable-5-1 attributed as "${fiveOne}", fable-5 as "${five}"`);
  }
});

test('A5: fableAttribution and the run-rate both pick up Fable 5.1 turns', () => {
  const turns = [
    { model: 'claude-fable-5-1', ts: '2026-09-05T10:00:00.000Z', cost_usd: 2 },
    { model: 'claude-fable-5',   ts: '2026-09-05T11:00:00.000Z', cost_usd: 3 },
    { model: 'claude-opus-5',    ts: '2026-09-05T12:00:00.000Z', cost_usd: 99 },
  ];
  const rr = fableDailyRunRate(turns);
  assert.equal(rr.fableTurns, 2, 'both Fable turns counted, the Opus turn excluded');
  assert.equal(rr.sum, 5, 'Opus spend must not leak into the Fable pool');
  // The window's model breakdown, so no surface has to hard-code a rate.
  assert.deepEqual(rr.models, { 'fable-5-1': 1, 'fable-5': 1 });

  const attr = fableAttribution(turns, 'max_5x');
  assert.equal(attr.fableTurns, 2);
  assert.equal(attr.byBilling.included_weekly.turns, 2,
    'on Max, BOTH Fable models are included — the mechanic is family-scoped');
  assert.equal(attr.byBilling.included_weekly.usd, 5);
});

test('A5: an unrecognised Fable id still counts toward the pool, by design', () => {
  // Deliberately broader than the rate sheet: the pool asks "was this Fable
  // usage", which is a family question, while pricing asks "what did it cost",
  // which is a model question. A future `claude-fable-6` must not silently
  // vanish from the user's Fable accounting just because we have no rate for it
  // yet — its cost comes from the anchor regardless.
  const rr = fableDailyRunRate([{ model: 'claude-fable-6', ts: '2026-09-05T10:00:00.000Z', cost_usd: 7 }]);
  assert.equal(rr.fableTurns, 1);
  assert.equal(rr.sum, 7);
  assert.deepEqual(rr.models, { 'fable-6': 1 }, 'the unknown model is recorded by name');
});


test('F12: promo credits do not apply to a Fable-5.1-only window', async () => {
  const { getFablePromoCredits } = await import('./config.js');
  const promo = getFablePromoCredits();
  assert.deepEqual(promo.scope, ['fable-5']);
  assert.equal(promo.appliesTo(['fable-5-1']), false, 'Fable 5.1 was never part of the promotion');
  assert.equal(promo.appliesTo(['fable-5']), true);
  assert.equal(promo.appliesTo(['fable-5-1', 'fable-5']), true, 'a mixed window still has Fable 5 credits');
  // No models at all => show it. A user with no Fable turns this window may
  // still hold claimed credits, and hiding the expiry is the worse error.
  assert.equal(promo.appliesTo([]), true);
  assert.equal(promo.appliesTo(undefined), true);
});
