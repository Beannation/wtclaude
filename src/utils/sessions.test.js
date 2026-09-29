import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// sessions.js resolves the data dir at import time, so point it at a scratch
// dir first and import dynamically. Synthetic ids only.
process.env.TZ = 'America/New_York';
const DIR = mkdtempSync(join(tmpdir(), 'wtc-sessions-'));
mkdirSync(join(DIR, 'sessions'), { recursive: true });
process.env.WTCLAUDE_DIR = DIR;
after(() => rmSync(DIR, { recursive: true, force: true }));

const { readSession, summarizeTurns, getUnreadableLines, parseSessionText } = await import('./sessions.js');

const turn = (n, extra = {}) => JSON.stringify({ turn: n, ts: `2026-09-28T13:0${n}:00.000Z`, model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: n, ...extra });

// ── QA-0928-14: one bad line must never take down a read ─────────────────────

test('readSession skips a truncated middle line and counts it', () => {
  writeFileSync(join(DIR, 'sessions', 'trunc-mid.ndjson'),
    [turn(1), '{"ts":"2026-09-28T15:00:00.000Z","input_tok', turn(2)].join('\n') + '\n');
  const turns = readSession('trunc-mid');
  assert.deepEqual(turns.map(t => t.turn), [1, 2]);
  const u = getUnreadableLines();
  assert.equal(u.lines, 1);
  assert.deepEqual(u.files, [{ session_id: 'trunc-mid', lines: 1 }]);
});

test('a trailing partial line (no newline yet) is treated as still being written: skipped, not counted', () => {
  writeFileSync(join(DIR, 'sessions', 'trunc-end.ndjson'), [turn(1), turn(2)].join('\n') + '\n{"ts":"2026-09-28T15:01:00.000Z","inp');
  assert.deepEqual(readSession('trunc-end').map(t => t.turn), [1, 2]);
  assert.equal(getUnreadableLines().files.some(f => f.session_id === 'trunc-end'), false);
});

test('non-object JSON lines are skipped and counted; re-reading a file does not double count', () => {
  writeFileSync(join(DIR, 'sessions', 'odd.ndjson'), [turn(1), '42', 'null', '[1,2]', turn(2)].join('\n') + '\n');
  readSession('odd');
  readSession('odd');
  const f = getUnreadableLines().files.find(x => x.session_id === 'odd');
  assert.equal(f.lines, 3);
});

test('parseSessionText: CRLF line endings and blank lines parse cleanly', () => {
  const { turns, bad } = parseSessionText(`${turn(1)}\r\n\r\n${turn(2)}\r\n`);
  assert.equal(turns.length, 2);
  assert.equal(bad, 0);
});

// ── QA-0928-154: a row missing the cache fields counts them as 0 ─────────────

test('summarizeTurns treats missing token fields as 0, never NaN', () => {
  const s = summarizeTurns([{ ts: '2026-09-20T14:00:00.000Z', model: 'claude-opus-5-5', input_tokens: 5000, output_tokens: 700, cost_usd: 0.5 }]);
  assert.equal(s.cache_read_tokens, 0);
  assert.equal(s.cache_write_tokens, 0);
  assert.equal(s.input_tokens, 5000);
  assert.equal(s.cost, 0.5);
});

// ── QA-0928-54: unanchored turns we cannot price are excluded and named ──────

const unanchored = (model) => ({ ts: '2026-09-28T13:10:00.000Z', model, speed_tier: 'standard', input_tokens: 1_000_000, output_tokens: 100_000, cache_read_tokens: 0, cache_write_tokens: 0 });

test('summarizeTurns excludes unanchored family-fallback, partner-platform and unknown-model turns from every $ total', () => {
  const s = summarizeTurns([
    { ...unanchored('claude-opus-5-5'), cost_usd: 59.02 },
    unanchored('claude-fable-5-1'),          // priceable → a labelled estimate
    unanchored('claude-opus-6'),             // family fallback → excluded
    unanchored('vertex_ai/claude-sonnet-5'), // partner platform → excluded
    unanchored('claude-zeta-9'),             // unknown → excluded
  ]);
  assert.equal(s.anchored_turns, 1);
  assert.equal(s.estimated_turns, 1);
  assert.equal(s.excluded_turns, 3);
  assert.deepEqual(s.excluded_models, { 'claude-opus-6': 1, 'vertex_ai/claude-sonnet-5': 1, 'claude-zeta-9': 1 });
  assert.ok(Math.abs(s.estimated_cost - 15) < 1e-9, `fable estimate only, got ${s.estimated_cost}`);
  assert.ok(Math.abs(s.cost - (59.02 + 15)) < 1e-9, `total must not carry a fallback/partner price, got ${s.cost}`);
  // Tokens and turns are still real measurements and stay counted.
  assert.equal(s.turn_count, 5);
  assert.equal(s.input_tokens, 5_000_000);
});

test('an anchored turn is never excluded, whatever its model', () => {
  const s = summarizeTurns([{ ...unanchored('claude-zeta-9'), cost_usd: 2 }]);
  assert.equal(s.excluded_turns, 0);
  assert.equal(s.cost, 2);
});

test('a zero-token unanchored turn on an unknown model is not an exclusion (it is $0 on any rate)', () => {
  const s = summarizeTurns([{ ts: '2026-09-28T13:10:00.000Z', model: 'claude-zeta-9', input_tokens: 0, output_tokens: 0 }]);
  assert.equal(s.excluded_turns, 0);
  assert.equal(s.cost, 0);
});

// ── QA-0928-61: the current rate-limit reading ───────────────────────────────

const { latestRateLimit, readSessionCached } = await import('./sessions.js');

const RESET = 1_790_000_000; // epoch seconds
test('latestRateLimit: the newest window, and the highest % any session reported for it (a lagging session cannot pull it down)', () => {
  const r = latestRateLimit([
    { ts: '2026-09-28T13:00:00.000Z', rate_limit_5h_pct: 90, rate_limit_5h_resets_at: RESET - 5 * 3600, rate_limit_7d_pct: 30, rate_limit_7d_resets_at: RESET + 86400 },
    { ts: '2026-09-28T13:40:00.000Z', rate_limit_5h_pct: 17, rate_limit_5h_resets_at: RESET, rate_limit_7d_pct: 41, rate_limit_7d_resets_at: RESET + 86400 },
    { ts: '2026-09-28T13:42:00.000Z', rate_limit_5h_pct: 16, rate_limit_5h_resets_at: RESET + 30, rate_limit_7d_pct: null, rate_limit_7d_resets_at: null },
    { ts: '2026-09-28T13:43:00.000Z', model: 'x' },
  ]);
  assert.equal(r.rate_limit_5h_pct, 17);
  assert.equal(r.rate_limit_5h_resets_at, RESET);
  assert.equal(r.rate_limit_7d_pct, 41);
  assert.equal(r.ts, '2026-09-28T13:42:00.000Z');
  assert.equal(latestRateLimit([{ ts: 'x', model: 'y' }]), null);
});

test('latestRateLimit: a null 7-day reading stays null (shown as —), never 0', () => {
  const r = latestRateLimit([{ ts: '2026-09-28T13:42:00.000Z', rate_limit_5h_pct: 16, rate_limit_5h_resets_at: RESET }]);
  assert.equal(r.rate_limit_7d_pct, null);
});

// ── QA-0928-161: watch re-reads only files that changed ──────────────────────

test('readSessionCached returns the cached parse until the file changes', async () => {
  const { appendFileSync } = await import('node:fs');
  writeFileSync(join(DIR, 'sessions', 'cached.ndjson'), turn(1) + '\n');
  const cache = new Map();
  const a = readSessionCached('cached', cache);
  assert.equal(readSessionCached('cached', cache), a, 'unchanged file → same parsed array');
  appendFileSync(join(DIR, 'sessions', 'cached.ndjson'), turn(2) + '\n');
  assert.deepEqual(readSessionCached('cached', cache).map(t => t.turn), [1, 2]);
});
