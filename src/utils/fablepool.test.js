import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fableDailyRunRate, isFableTurn } from './fablepool.js';

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
