// TZ first: the reader buckets by LOCAL date, so the window-edge tests below are
// only deterministic with a fixed zone.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCoworkTurns, readCowork } from './cowork-reader.js';

// Write a fixture audit.jsonl (the real Cowork transcript shape) and point the
// WTCLAUDE_COWORK_AUDIT override at it — the same test seam the reader documents.
function withFixture(objs, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-cowork-'));
  const path = join(dir, 'audit.jsonl');
  writeFileSync(path, objs.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const prev = process.env.WTCLAUDE_COWORK_AUDIT;
  process.env.WTCLAUDE_COWORK_AUDIT = path;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.WTCLAUDE_COWORK_AUDIT;
    else process.env.WTCLAUDE_COWORK_AUDIT = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

// An `assistant` line in the Cowork transcript shape (message.model + message.usage).
const asst = (id, model, usage, ts = '2026-07-01T10:00:00.000Z', reqId = null) => ({
  type: 'assistant',
  request_id: reqId,
  _audit_timestamp: ts,
  message: { id, model, role: 'assistant', usage },
});

test('parses the Cowork transcript audit.jsonl into reprice-ready turns', () => {
  const turns = withFixture(
    [
      { type: 'user', message: { role: 'user' }, _audit_timestamp: '2026-07-01T10:00:00.000Z' },
      { type: 'system', subtype: 'init' },
      { type: 'rate_limit_event', rate_limit_info: {} },
      asst('msg_a', 'claude-sonnet-4-6', {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 200,
      }),
    ],
    () => readCoworkTurns(),
  );
  assert.equal(turns.length, 1); // non-assistant lines ignored
  assert.deepEqual(turns[0], {
    model: 'claude-sonnet-4-6',
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 1000,
    cache_write_tokens: 200,
  });
});

test('counts each response once across its repeated lines (keyed by message.id)', () => {
  const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const turns = withFixture(
    [asst('msg_dup', 'claude-opus-4-8', u), asst('msg_dup', 'claude-opus-4-8', u, undefined, 'req_2'), asst('msg_dup', 'claude-opus-4-8', u), asst('msg_other', 'claude-opus-4-8', u)],
    () => readCoworkTurns(),
  );
  assert.equal(turns.length, 2); // msg_dup counted once (even with a second request id) + msg_other
});

test('honors the date filter via _audit_timestamp', () => {
  const u = { input_tokens: 1, output_tokens: 1 };
  const turns = withFixture(
    [asst('m1', 'claude-sonnet-5', u, '2026-05-01T00:00:00.000Z'), asst('m2', 'claude-sonnet-5', u, '2026-07-01T00:00:00.000Z')],
    () => readCoworkTurns({ start: '2026-06-15', end: '2026-07-02' }),
  );
  assert.equal(turns.length, 1); // only the in-window response
  assert.equal(turns[0].model, 'claude-sonnet-5');
});

test('missing override path degrades to [] (never a fabricated zero)', () => {
  const prev = process.env.WTCLAUDE_COWORK_AUDIT;
  process.env.WTCLAUDE_COWORK_AUDIT = '/nonexistent-wtc-cowork-xyz.jsonl';
  try {
    assert.deepEqual(readCoworkTurns(), []);
    assert.equal(readCowork().files_found, 0);
  } finally {
    if (prev === undefined) delete process.env.WTCLAUDE_COWORK_AUDIT;
    else process.env.WTCLAUDE_COWORK_AUDIT = prev;
  }
});

test('`<synthetic>` placeholders and zero-usage lines are not turns (release review, 2026-09-27)', () => {
  // Real Cowork logs carry `<synthetic>` assistant lines with all-zero usage.
  // Kept, they surfaced in compare-models as "excluded, unpriceable" turns with
  // an upgrade hint no upgrade can satisfy.
  const turns = withFixture(
    [
      asst('msg_real', 'claude-opus-5-5', { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 300, cache_creation_input_tokens: 0 }),
      asst('msg_syn', '<synthetic>', { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      asst('msg_zero', 'claude-opus-5-5', { input_tokens: 0, output_tokens: 0 }),
    ],
    () => readCoworkTurns(),
  );
  assert.equal(turns.length, 1);
  assert.equal(turns[0].model, 'claude-opus-5-5');
});

// ───────────────────────────────────────────────────────────────────────────
// BUILD-018 (QA-0928-23 / 82 / 83 / 84, canon E-7). audit.jsonl assistant lines
// echo the message_start usage snapshot (output 0.5–2% of the truth) and never
// see subagent requests; the final usage lives in each run's own transcripts.
// A fake HOME holds a fake sessions tree so the real discovery path is tested.
// ───────────────────────────────────────────────────────────────────────────

const HOME = mkdtempSync(join(tmpdir(), 'wtc-cowork-home-'));
const SESS = join(HOME, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
const W = { start: '2026-09-01', end: '2026-09-28' };

const rec = (id, usage, { stop = null, ts = '2026-09-20T10:00:00.000Z', model = 'claude-opus-5', audit = true } = {}) => ({
  type: 'assistant', ...(audit ? { _audit_timestamp: ts } : { timestamp: ts, requestId: 'req_' + id }),
  message: { id, model, role: 'assistant', stop_reason: stop, usage },
});
const startSnap = (i, cr = 1000) => ({ input_tokens: i, output_tokens: 1, cache_read_input_tokens: cr, cache_creation_input_tokens: 50 });
const fin = (i, o, cr = 1000) => ({ input_tokens: i, output_tokens: o, cache_read_input_tokens: cr, cache_creation_input_tokens: 50 });
let n = 0;
function run({ runDir = `local_${String(++n).padStart(8, '0')}-0000-0000-0000-000000000000`, audit = [], transcripts = {}, mtime } = {}) {
  const dir = join(SESS, 'acct', 'org', runDir);
  mkdirSync(dir, { recursive: true });
  const w = (p, objs) => {
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, objs.map(o => JSON.stringify(o)).join('\n') + '\n');
    if (mtime) utimesSync(p, mtime, mtime);
  };
  w(join(dir, 'audit.jsonl'), audit);
  for (const [rel, objs] of Object.entries(transcripts)) w(join(dir, '.claude', 'projects', 'p', rel), objs);
  return dir;
}
// Each test gets a fresh tree under the fake HOME, with the override unset.
function fresh(fn) {
  rmSync(SESS, { recursive: true, force: true });
  const prevHome = process.env.HOME, prevOv = process.env.WTCLAUDE_COWORK_AUDIT;
  process.env.HOME = HOME;
  delete process.env.WTCLAUDE_COWORK_AUDIT;
  try { return fn(); } finally {
    process.env.HOME = prevHome;
    if (prevOv !== undefined) process.env.WTCLAUDE_COWORK_AUDIT = prevOv;
  }
}

test('E-7: a start snapshot plus the final record for one request yields the FINAL usage', () => fresh(() => {
  run({
    audit: [rec('m1', startSnap(3)), rec('m1', startSnap(3)),
      // A result line carries a cost field; the reader must never use it (E-7).
      { type: 'result', total_cost_usd: 999, modelUsage: { 'claude-opus-5': { costUSD: 999, inputTokens: 1e9 } } }],
    transcripts: { 's.jsonl': [rec('m1', startSnap(3), { audit: false }), rec('m1', fin(3, 812), { stop: 'tool_use', audit: false })] },
  });
  const r = readCowork(W);
  assert.equal(r.turns.length, 1, 'one request, however many lines echo it');
  assert.equal(r.turns[0].output_tokens, 812);
  assert.equal(r.turns[0].input_tokens, 3);
  assert.equal(r.partial_count, 0);
}));

test('the final record wins regardless of order and file (parent + subagent copies)', () => fresh(() => {
  run({
    audit: [rec('m2', startSnap(2))],
    transcripts: {
      's.jsonl': [rec('m2', fin(2, 400), { stop: 'end_turn', audit: false })],
      's/subagents/a.jsonl': [rec('m2', startSnap(2), { audit: false })],
    },
  });
  const t = readCoworkTurns(W);
  assert.equal(t.length, 1);
  assert.equal(t[0].output_tokens, 400);
}));

test('a subagent request that exists only in a run transcript is counted', () => fresh(() => {
  run({
    audit: [rec('m-parent', fin(5, 50), { stop: 'end_turn' })],
    transcripts: { 's/subagents/agent-1.jsonl': [rec('m-sub', fin(7, 70), { stop: 'end_turn', audit: false, model: 'claude-sonnet-5' })] },
  });
  const t = readCoworkTurns(W);
  assert.deepEqual(t.map(x => x.output_tokens).sort((a, b) => a - b), [50, 70]);
}));

test('an all-zero record never replaces a non-zero one, even with stop_reason set', () => fresh(() => {
  run({
    audit: [rec('m9', fin(4, 90))],
    transcripts: { 's.jsonl': [rec('m9', { input_tokens: 0, output_tokens: 0 }, { stop: 'end_turn', audit: false })] },
  });
  const t = readCoworkTurns(W);
  assert.equal(t.length, 1);
  assert.equal(t[0].output_tokens, 90);
}));

test('an interrupted request (no final record anywhere) still counts, flagged partial', () => fresh(() => {
  run({ audit: [rec('m3', startSnap(5))], transcripts: { 's.jsonl': [rec('m3', fin(5, 40), { audit: false })] } });
  const r = readCowork(W);
  assert.equal(r.turns.length, 1);
  assert.equal(r.turns[0].output_tokens, 40, 'the largest streamed snapshot');
  assert.equal(r.partial_count, 1);
}));

test('a file whose mtime predates the window is skipped unread', () => fresh(() => {
  const old = new Date('2026-08-01T00:00:00Z');
  // An in-window-dated record inside a stale file cannot happen on real data
  // (a record never postdates its file's last write), so counting nothing here
  // proves the file was never opened.
  const dir = run({ audit: [rec('m4', fin(1, 10), { stop: 'end_turn' })], mtime: old });
  const r = readCowork(W);
  assert.equal(r.turns.length, 0);
  assert.equal(r.files_read, 0);
  assert.equal(r.files_found, 1, 'the log was found, just not read');
  assert.equal(r.older_than_window, true, 'a stale log proves Cowork use before the window');
  assert.equal(readCoworkTurns(undefined).length, 1, 'no window -> no prefilter');
  // And unreadable proves unopened: with the window, a chmod 000 file costs nothing.
  chmodSync(join(dir, 'audit.jsonl'), 0o000);
  try { assert.equal(readCowork(W).turns.length, 0); } finally { chmodSync(join(dir, 'audit.jsonl'), 0o644); }
}));

test('a fresh file still filters its older records by timestamp (mtime is the LAST write)', () => fresh(() => {
  run({ audit: [rec('m5', fin(1, 10), { stop: 'end_turn', ts: '2026-07-01T10:00:00.000Z' }), rec('m6', fin(1, 20), { stop: 'end_turn', ts: '2026-09-20T10:00:00.000Z' })] });
  const r = readCowork(W);
  assert.equal(r.turns.length, 1);
  assert.equal(r.turns[0].output_tokens, 20);
  assert.equal(r.older_than_window, true);
}));

test('post-merge <hex8>/ run dirs are read the same way', () => fresh(() => {
  run({ runDir: 'a1b2c3d4', audit: [rec('m7', startSnap(1))], transcripts: { 's.jsonl': [rec('m7', fin(1, 77), { stop: 'end_turn', audit: false })] } });
  assert.equal(readCoworkTurns(W)[0].output_tokens, 77);
}));

test('the walk stops at a run dir — nothing inside a run is taken for another run\'s log', () => fresh(() => {
  const dir = run({ audit: [rec('m10', fin(1, 11), { stop: 'end_turn' })] });
  mkdirSync(join(dir, 'outputs', 'deep'), { recursive: true });
  writeFileSync(join(dir, 'outputs', 'deep', 'audit.jsonl'), JSON.stringify(rec('m11', fin(1, 12), { stop: 'end_turn' })) + '\n');
  const r = readCowork(W);
  assert.equal(r.files_found, 1);
  assert.deepEqual(r.turns.map(t => t.output_tokens), [11]);
}));

test('LOCAL-date window, both edges (TZ=America/New_York)', () => fresh(() => {
  run({
    audit: [
      rec('e1', fin(1, 1), { stop: 'end_turn', ts: '2026-09-01T02:00:00.000Z' }),  // 22:00 EDT Aug 31 -> outside
      rec('e2', fin(1, 2), { stop: 'end_turn', ts: '2026-09-01T04:30:00.000Z' }),  // 00:30 EDT Sep 1  -> inside
      rec('e3', fin(1, 3), { stop: 'end_turn', ts: '2026-09-29T01:00:00.000Z' }),  // 21:00 EDT Sep 28 -> inside
      rec('e4', fin(1, 4), { stop: 'end_turn', ts: '2026-09-29T04:30:00.000Z' }),  // 00:30 EDT Sep 29 -> outside
    ],
  });
  const r = readCowork(W);
  assert.deepEqual(r.turns.map(t => t.output_tokens).sort(), [2, 3]);
  assert.equal(r.first_date, '2026-09-01');
}));

test('logs found but nothing in the window: files_found says so (QA-0928-84)', () => fresh(() => {
  run({ audit: [rec('m12', fin(1, 5), { stop: 'end_turn', ts: '2026-09-10T10:00:00.000Z' })] });
  const r = readCowork({ start: '2026-09-27', end: '2026-09-28' });
  assert.deepEqual(r.turns, []);
  assert.equal(r.files_found, 1);
  const none = fresh(() => readCowork(W));
  assert.equal(none.files_found, 0);
}));

test.after(() => rmSync(HOME, { recursive: true, force: true }));
