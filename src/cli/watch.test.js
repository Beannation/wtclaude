import { test } from 'node:test';
import assert from 'node:assert/strict';

// Injected clock throughout: nothing here depends on when the suite runs.
process.env.TZ = 'America/New_York';
const { renderFrame, timeToLimit } = await import('./watch.js');

const NOW = Date.UTC(2026, 8, 28, 14, 1, 0); // 10:01 EDT, inside the 10:00–15:00 UTC bucket
const H = 3_600_000, M = 60_000;
const iso = (ms) => new Date(ms).toISOString();
const sec = (ms) => Math.floor(ms / 1000);
const turn = (msAgo, extra = {}) => ({ ts: iso(NOW - msAgo), model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 1, ...extra });

// The QA snapshot shape: the window resets in 1h 9m (so it began 3h 51m ago);
// usage rose 1% → 17%; a lagging concurrent session then reported 16%.
const R5 = sec(NOW + 69 * M), R7 = sec(NOW + (6 * 24 + 9) * H + 30 * M);
const WINDOW = [
  turn(3 * H, { rate_limit_5h_pct: 1, rate_limit_5h_resets_at: R5, rate_limit_7d_pct: 40, rate_limit_7d_resets_at: R7 }),
  turn(3 * M + 28_000, { rate_limit_5h_pct: 16, rate_limit_5h_resets_at: R5, rate_limit_7d_pct: 41, rate_limit_7d_resets_at: R7 }),
  turn(3 * M, { rate_limit_5h_pct: 17, rate_limit_5h_resets_at: R5, rate_limit_7d_pct: 41, rate_limit_7d_resets_at: R7 }),
  turn(2 * M, { rate_limit_5h_pct: 16, rate_limit_5h_resets_at: R5 }),
];

// ── QA-0928-60: time to limit ────────────────────────────────────────────────

test('timeToLimit: a lagging session does not read as "not rising"; the window average says it will not reach the limit', () => {
  const t = timeToLimit(WINDOW, NOW);
  assert.equal(t.note, "won't reach the limit before it resets in 1h 9m");
});

test('timeToLimit: two points 28 s apart do not set the rate — the window average does', () => {
  const t = timeToLimit(WINDOW.slice(1, 3), NOW);
  assert.equal(t.note, "won't reach the limit before it resets in 1h 9m");
});

test('timeToLimit: a burn that will hit the limit gives the time from now', () => {
  // 80% used 3 h into the window (reset in 2 h): 26.7%/h → the last 20% in 45 min.
  const t = timeToLimit([turn(0, { rate_limit_5h_pct: 80, rate_limit_5h_resets_at: sec(NOW + 2 * H) })], NOW);
  assert.equal(Math.round(t.msToLimit / M), 45);
});

test('timeToLimit: limit reached, window already reset, too early, and no data each say so', () => {
  assert.equal(timeToLimit([turn(0, { rate_limit_5h_pct: 100, rate_limit_5h_resets_at: sec(NOW + 2 * H) })], NOW).note, 'limit reached — resets in 2h 0m');
  assert.equal(timeToLimit([turn(40 * M, { rate_limit_5h_pct: 50, rate_limit_5h_resets_at: sec(NOW - 30 * M) })], NOW).note, 'the 5-hour window reset 30m ago — no snapshot since');
  assert.equal(timeToLimit([turn(0, { rate_limit_5h_pct: 3, rate_limit_5h_resets_at: sec(NOW + 5 * H - 5 * M) })], NOW).note, 'too early in this window to estimate');
  assert.equal(timeToLimit([turn(0)], NOW), null);
});

test('timeToLimit / renderFrame: a snapshot whose resets_at cannot be read says the reset time is unknown, not that there is no snapshot', () => {
  const rows = [turn(2 * H, { rate_limit_5h_pct: 10, rate_limit_5h_resets_at: 'garbage' }), turn(0, { rate_limit_5h_pct: 30, rate_limit_5h_resets_at: 'garbage' })];
  assert.equal(timeToLimit(rows, NOW).note, "reset time unknown in your last snapshot — can't estimate");
  const out = renderFrame(rows, NOW);
  assert.match(out, /Time to 5h limit: reset time unknown in your last snapshot — can't estimate/);
  assert.doesNotMatch(out, /needs a rate-limit snapshot/);
});

// ── QA-0928-61 / 155 / 156 / 55 / 62: the frame ──────────────────────────────

test('renderFrame: labelled costs, the UTC block named for what it is, one countdown format, the running max %', () => {
  const out = renderFrame(WINDOW, NOW);
  assert.match(out, /Today: +\$4\.00 {2}\(billing-grade\)/);
  assert.match(out, /UTC 5h block: +\$0\.00 · 14:00–19:00 UTC/, 'epoch-aligned: 14:01Z falls in 14:00–19:00');
  assert.match(out, /fixed 5-hour UTC bucket.*not your limit window/);
  assert.match(out, /5-hour limit .* 17%\s+resets in 1h 9m/);
  assert.match(out, /7-day limit .* 41%\s+resets in 6d 9h/);
  assert.match(out, /Time to 5h limit: won't reach the limit before it resets in 1h 9m/);
  assert.doesNotMatch(out, /not rising|resets in now|resets in unknown|\d{3}h/);
});

test('renderFrame: a missing 7-day reading shows —, never 0%; a stale snapshot never shows "resets in now"', () => {
  const out = renderFrame([turn(M, { rate_limit_5h_pct: 16, rate_limit_5h_resets_at: R5 })], NOW);
  assert.match(out, /7-day limit .* —\s+reset time unknown/);
  const stale = renderFrame([turn(72 * H, { rate_limit_5h_pct: 60, rate_limit_5h_resets_at: sec(NOW - 70 * H), rate_limit_7d_pct: 31, rate_limit_7d_resets_at: sec(NOW - H) })], NOW);
  assert.match(stale, /5-hour limit .* —\s+window has reset since your last snapshot \(3d 0h ago\)/);
  assert.doesNotMatch(stale, /60%|31%|now/);
});

test('renderFrame: ISO and millisecond resets_at never render NaN', () => {
  const out = renderFrame([turn(5 * M, { rate_limit_5h_pct: 22, rate_limit_5h_resets_at: iso(NOW + 2 * H), rate_limit_7d_pct: 30, rate_limit_7d_resets_at: NOW + 3 * 24 * H })], NOW);
  assert.doesNotMatch(out, /NaN/);
  assert.match(out, /resets in 2h 0m/);
  assert.match(out, /resets in 3d 0h/);
});

test('renderFrame: a mixed block whose dollars are all anchor or all estimate says so, never 100% / 0%', () => {
  const zeroTok = { input_tokens: 0, output_tokens: 0 };
  const a = renderFrame([turn(0, { cost_usd: 5 }), turn(0, { cost_usd: undefined, ...zeroTok })], NOW);
  assert.match(a, /Today: +\$5\.00 {2}\(billing-grade\)/);
  assert.match(a, /UTC 5h block: +\$5\.00 {2}\(billing-grade\)/);
  const e = renderFrame([turn(0, { cost_usd: 0 }), turn(0, { cost_usd: undefined, model: 'claude-fable-5-1', input_tokens: 100_000 })], NOW);
  assert.match(e, /Today: +\$[\d.]+ {2}\(estimated\)/);
  for (const out of [a, e]) assert.doesNotMatch(out, /(100|0)% billing-grade/);
});

test('renderFrame: a mixed UTC block carries its badge', () => {
  const out = renderFrame([turn(0, { cost_usd: 2 }), turn(0, { cost_usd: undefined, model: 'claude-fable-5-1', input_tokens: 100_000 })], NOW);
  assert.match(out, /UTC 5h block: +\$[\d.]+ {2}\(\d+% billing-grade, rest estimated\) · 14:00–19:00 UTC/);
});
