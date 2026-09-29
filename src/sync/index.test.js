import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Isolate against a throwaway data dir — paths.js reads WTCLAUDE_DIR at module
// load, so set it BEFORE the first (dynamic) import of the sync module. Also
// neutralize any background-sync spawn just in case.
const DIR = mkdtempSync(join(tmpdir(), 'wtclaude-sync-'));
process.env.WTCLAUDE_DIR = DIR;
process.env.WTCLAUDE_AUTOSYNC_CHILD = '1';
const CONFIG = join(DIR, 'config.json');
const SESSIONS = join(DIR, 'sessions');

const {
  getSupabaseConfig,
  syncToCloud,
  pruneLegacySecrets,
  pendingSyncCounts,
  HOSTED_SUPABASE_URL,
  HOSTED_PUBLISHABLE_KEY,
  MAX_CHUNK_TURNS,
  MAX_CHUNK_BYTES,
  SYNC_TURN_FIELDS,
  SYNC_ALSO_SENT,
  syncPreviewLines,
  saveConfig,
  getOrCreateAnonymousId,
  ConfigError,
  SYNC_SUMMARY_KEYS,
  jsonErrorLocation,
} = await import('./index.js');
const { computeTurnCost } = await import('../utils/cost.js');

// Synthetic anonymous ids (UUID-shaped: the CLI refuses anything else).
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function writeConfig(obj) { writeFileSync(CONFIG, JSON.stringify(obj, null, 2)); }
function readConfig() { return existsSync(CONFIG) ? JSON.parse(readFileSync(CONFIG, 'utf8')) : {}; }

beforeEach(() => {
  rmSync(CONFIG, { force: true });
  rmSync(SESSIONS, { recursive: true, force: true });
  rmSync(join(DIR, 'sync-state.json'), { force: true });
  rmSync(join(DIR, 'sync.lock'), { force: true });
});

after(() => rmSync(DIR, { recursive: true, force: true }));

// ── A1: hosted defaults shipped ──────────────────────────────────────────────

test('hosted defaults are present when config is empty', () => {
  const cfg = getSupabaseConfig();
  assert.equal(cfg.url, HOSTED_SUPABASE_URL);
  assert.equal(cfg.publishableKey, HOSTED_PUBLISHABLE_KEY);
  assert.equal(cfg.syncEnabled, false, 'shipping creds must NOT imply opt-in');
  assert.ok(HOSTED_SUPABASE_URL.startsWith('https://'), 'hosted URL is https');
});

test('the shipped key is a browser-safe PUBLISHABLE key, never a secret key', () => {
  // Ship-safety invariant: a secret/service key must never live in the CLI.
  assert.ok(HOSTED_PUBLISHABLE_KEY.startsWith('sb_publishable_'));
  assert.ok(!HOSTED_PUBLISHABLE_KEY.startsWith('sb_secret_'));
  assert.ok(!/service[_-]?role/i.test(HOSTED_PUBLISHABLE_KEY));
});

test('user config overrides the hosted defaults (advanced / self-host)', () => {
  writeConfig({ supabase_url: 'https://self.example.co', supabase_publishable_key: 'sb_publishable_self' });
  const cfg = getSupabaseConfig();
  assert.equal(cfg.url, 'https://self.example.co');
  assert.equal(cfg.publishableKey, 'sb_publishable_self');
});

test('the legacy supabase_anon_key name still maps to publishableKey', () => {
  writeConfig({ supabase_anon_key: 'sb_publishable_legacy' });
  assert.equal(getSupabaseConfig().publishableKey, 'sb_publishable_legacy');
});

// ── A3: syncToCloud() must never flip the opt-in (consent gap fix) ────────────

test('syncToCloud() does not flip sync_enabled (false stays false)', async () => {
  writeConfig({ sync_enabled: false });
  const res = await syncToCloud(); // no sessions → "Nothing new to sync", no network
  assert.equal(res.synced, 0);
  const cfg = readConfig();
  assert.equal(cfg.sync_enabled, false, 'sync must never silently enable itself');
  assert.ok(cfg.last_sync_at, 'last_sync_at is still recorded');
});

test('syncToCloud() leaves sync_enabled untouched (true stays true)', async () => {
  writeConfig({ sync_enabled: true });
  await syncToCloud();
  assert.equal(readConfig().sync_enabled, true);
});

test('syncToCloud() does not introduce sync_enabled when it is absent', async () => {
  writeConfig({}); // no sync_enabled key at all
  await syncToCloud();
  assert.equal(readConfig().sync_enabled, undefined, 'must not add sync_enabled as a side effect');
});

// ── hygiene preserved: legacy-secret pruning still strips, key still kept ─────

test('pruneLegacySecrets strips a legacy secret key but keeps the publishable key', () => {
  writeConfig({
    supabase_secret_key: 'sb_secret_should_be_gone',
    supabase_publishable_key: 'sb_publishable_keep',
    sync_enabled: true,
  });
  const removed = pruneLegacySecrets();
  assert.deepEqual(removed, ['supabase_secret_key']);
  const cfg = readConfig();
  assert.equal(cfg.supabase_secret_key, undefined);
  assert.equal(cfg.supabase_publishable_key, 'sb_publishable_keep');
  assert.equal(cfg.sync_enabled, true, 'pruning must not touch the opt-in flag');
});

// ── 0.1.8: earned badges ride the sync payload (the badge-sync gap fix) ───────
// Regression for the bug where the dashboard Badges tab showed 0 despite locally
// earned badges: the CLI computed badges but never sent them to the cloud.

// Stub global fetch; capture each POST body. Returns a minimal Response-like
// from a server with migration 009 (its reply carries the fills_missing
// marker, so a first sync completes the one-time re-send gate at once).
function stubFetch(calls) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => ({ synced: 1, turns_synced: 1, message: 'ok', fills_missing: ['cost_estimate_usd', 'git_branch'] }), text: async () => '' };
  };
  return () => { globalThis.fetch = real; };
}

// One session with a turn → earns at least `first_session` (and 100k_club here).
function seedEarningSession() {
  mkdirSync(SESSIONS, { recursive: true });
  const turn = {
    turn: 1, ts: '2026-06-10T12:00:00Z', model: 'claude-opus-4-8',
    input_tokens: 60000, output_tokens: 50000, cache_read_tokens: 0, cache_write_tokens: 0,
    cost_usd: 0.5, speed_tier: 'standard',
  };
  writeFileSync(join(SESSIONS, 'sess-1.ndjson'), JSON.stringify(turn) + '\n');
}

test('syncToCloud includes earned badges (badge_type + earned_at) in the payload', async () => {
  seedEarningSession();
  writeConfig({ sync_enabled: true, anonymous_id: uid(1) });
  const calls = [];
  const restore = stubFetch(calls);
  try {
    await syncToCloud();
  } finally {
    restore();
  }
  assert.equal(calls.length, 1, 'one POST to the edge function');
  const badges = calls[0].body.badges;
  assert.ok(Array.isArray(badges) && badges.length >= 1, 'payload carries a non-empty badges array');
  const first = badges.find((b) => b.badge_type === 'first_session');
  assert.ok(first, 'the first_session badge is sent');
  assert.match(first.earned_at, /^\d{4}-\d\d-\d\dT/, 'earned_at is an ISO timestamp');
  const cfg = readConfig();
  assert.equal(cfg.badge_earned_at.first_session, first.earned_at, 'earn timestamp persisted in config');
  assert.ok((cfg.synced_badge_types || []).includes('first_session'), 'synced types recorded after push');
});

test('badges are not re-sent and earned_at does not churn once synced', async () => {
  seedEarningSession();
  writeConfig({ sync_enabled: true, anonymous_id: uid(1) });
  const calls = [];
  const restore = stubFetch(calls);
  try {
    await syncToCloud();                                  // first push: turns + badges
    const stamp = readConfig().badge_earned_at.first_session;
    await syncToCloud();                                  // nothing new: no turns, badges already synced
    assert.equal(calls.length, 1, 'no second POST — no new turns and badges already in the cloud');
    assert.equal(readConfig().badge_earned_at.first_session, stamp, 'earned_at is stable across syncs');
  } finally {
    restore();
  }
});

// ── BUILD-018 (QA-0928): chunked, resumable sync ──────────────────────────────
// A real install's sync failed silently for weeks: the whole backlog went up as
// ONE request (tens of megabytes), the server takes it all-or-nothing, and
// last_sync_at only moved on success — so the backlog could only grow. These pin
// the fix: bounded requests, per-session progress that survives a failure, no
// turn skipped by a write that lands mid-request, and failures that are recorded.

const PAD = 'x'.repeat(400); // realistic per-row weight (~1 KB rows in real data)
function seedSession(id, n, { from = 1, startMs = Date.parse('2026-09-01T00:00:00Z') } = {}) {
  mkdirSync(SESSIONS, { recursive: true });
  const rows = [];
  for (let i = from; i < from + n; i++) {
    rows.push(JSON.stringify({
      turn: i, ts: new Date(startMs + i * 1000).toISOString(), session_id: id,
      model: 'claude-opus-5-5[1m]', input_tokens: 10, output_tokens: 20, cache_read_tokens: 30, cache_write_tokens: 0,
      cost_usd: 0.01, speed_tier: 'standard', git_branch: PAD,
    }));
  }
  writeFileSync(join(SESSIONS, `${id}.ndjson`), rows.join('\n') + '\n', { flag: from === 1 ? 'w' : 'a' });
}

// Stub fetch; `plan(callIndex, body)` returns a Response-like or throws.
function stubFetchPlan(calls, plan = () => null) {
  const real = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const i = calls.length;
    calls.push({ url, body, bytes: Buffer.byteLength(opts.body) });
    const override = await plan(i, body);
    if (override) return override;
    const turns = body.sessions.reduce((a, s) => a + s.turns.length, 0);
    return { ok: true, status: 200, json: async () => ({ synced: body.sessions.length, turns_synced: turns }), text: async () => '' };
  };
  return () => { globalThis.fetch = real; };
}
const fail = (status = 546, text = 'WORKER_LIMIT') => ({ ok: false, status, json: async () => ({}), text: async () => text });
const sentKeys = (calls, okOnly = null) => calls
  .filter((_, i) => !okOnly || okOnly.has(i))
  .flatMap((c) => c.body.sessions.flatMap((s) => s.turns.map((t) => `${s.session_id}#${t.turn}`)));

test('a large backlog goes up in bounded requests, every turn exactly once', async () => {
  seedSession('big-a', 2600);
  seedSession('big-b', 1900);
  writeConfig({ sync_enabled: true, anonymous_id: uid(3) });
  const calls = [];
  const restore = stubFetchPlan(calls);
  let res;
  try { res = await syncToCloud(); } finally { restore(); }
  assert.ok(calls.length > 1, 'more than one request');
  for (const c of calls) {
    const turns = c.body.sessions.reduce((a, s) => a + s.turns.length, 0);
    assert.ok(turns <= MAX_CHUNK_TURNS, `request carries ${turns} turns`);
    assert.ok(c.bytes <= MAX_CHUNK_BYTES, `request is ${c.bytes} bytes`);
  }
  const keys = sentKeys(calls);
  assert.equal(keys.length, 4500, 'all turns sent');
  assert.equal(new Set(keys).size, 4500, 'no turn sent twice');
  assert.equal(res.complete, true);
  assert.equal(readConfig().last_sync_error, undefined);
});

test('a failed request keeps the progress before it, and the next sync resumes without re-sending', async () => {
  seedSession('res-a', 2500);
  writeConfig({ sync_enabled: true, anonymous_id: uid(10), last_sync_at: '2026-07-01T09:00:00.000Z' });
  const calls1 = [];
  let restore = stubFetchPlan(calls1, (i) => (i === 1 ? fail() : null));
  let res1;
  try { res1 = await syncToCloud(); } finally { restore(); }
  assert.equal(res1.complete, false, 'run 1 is incomplete');
  const cfg1 = readConfig();
  assert.equal(cfg1.last_sync_at, '2026-07-01T09:00:00.000Z', 'last complete sync unchanged by a failure');
  assert.match(cfg1.last_sync_error.message, /546/);
  assert.equal(cfg1.sync_failures, 1);
  const okFirst = sentKeys(calls1, new Set([0]));
  assert.ok(okFirst.length > 0);

  const calls2 = [];
  restore = stubFetchPlan(calls2);
  let res2;
  try { res2 = await syncToCloud(); } finally { restore(); }
  assert.equal(res2.complete, true);
  const resent = sentKeys(calls2).filter((k) => okFirst.includes(k));
  assert.deepEqual(resent, [], 'turns confirmed in run 1 are not re-sent');
  assert.equal(new Set([...okFirst, ...sentKeys(calls2)]).size, 2500, 'together every turn arrived');
  const cfg2 = readConfig();
  assert.equal(cfg2.last_sync_error, undefined, 'success clears the recorded failure');
  assert.equal(cfg2.sync_failures, undefined);
  assert.notEqual(cfg2.last_sync_at, '2026-07-01T09:00:00.000Z');
});

test('a network error (fetch throws) is recorded, not raised, and loses nothing', async () => {
  seedSession('net-a', 30);
  writeConfig({ sync_enabled: true, anonymous_id: uid(8) });
  const calls = [];
  const restore = stubFetchPlan(calls, () => { throw new TypeError('fetch failed'); });
  let res;
  try { res = await syncToCloud(); } finally { restore(); }
  assert.equal(res.complete, false);
  assert.match(readConfig().last_sync_error.message, /fetch failed/);
  assert.equal(pendingSyncCounts().turns, 30, 'all 30 turns still pending');
});

test('a turn written while a request is in flight is sent on the next sync', async () => {
  seedSession('race-a', 5);
  writeConfig({ sync_enabled: true, anonymous_id: uid(9) });
  const calls = [];
  let restore = stubFetchPlan(calls, (i) => {
    if (i === 0) seedSession('race-a', 1, { from: 6 }); // collector writes turn 6 mid-request
    return null;
  });
  try { await syncToCloud(); } finally { restore(); }
  assert.deepEqual(sentKeys(calls), ['race-a#1', 'race-a#2', 'race-a#3', 'race-a#4', 'race-a#5']);
  const calls2 = [];
  restore = stubFetchPlan(calls2);
  try { await syncToCloud(); } finally { restore(); }
  assert.deepEqual(sentKeys(calls2), ['race-a#6'], 'turn 6 was not skipped');
});

test('the first 0.3.2 sync re-sends the whole history once, then only what is new', async () => {
  // A ≤0.3.1 last_sync_at was stamped after its response and skipped turns written
  // mid-request, so it cannot tell us what reached the cloud. Re-send everything
  // once (the server ignores duplicates on session_id + turn_number).
  seedSession('legacy-a', 100);
  writeConfig({ sync_enabled: true, anonymous_id: uid(5), last_sync_at: '2026-09-02T00:00:00Z' });
  const calls = [];
  let restore = stubFetchPlan(calls);
  try { await syncToCloud(); } finally { restore(); }
  assert.equal(sentKeys(calls).length, 100, 'full history once');
  seedSession('legacy-a', 2, { from: 101 });
  const calls2 = [];
  restore = stubFetchPlan(calls2);
  try { await syncToCloud(); } finally { restore(); }
  assert.deepEqual(sentKeys(calls2), ['legacy-a#101', 'legacy-a#102'], 'then only new turns');
});

// ── QA-0928-34: the one-time full history re-send is gated on the server ──────
// Orchestrator ruling (2026-09-28). sync-state.json version < 2 means a full
// re-send is pending. It runs only once a sync-data reply carries fills_missing
// with 'cost_estimate_usd' (migration 009's RPC; the 008 server and the old
// sync-data never say so), and version 2 is written only when that pass
// completes. Until then syncing stays incremental. A real v1 file — cursors for
// every session, written by an earlier 0.3.2 build against the 008 server —
// therefore heals by itself on the first sync after the server deploy.
const STATE = join(DIR, 'sync-state.json');
const writeState = (obj) => writeFileSync(STATE, JSON.stringify(obj));
const readState = () => JSON.parse(readFileSync(STATE, 'utf8'));
const FILLS = ['cost_estimate_usd', 'git_branch'];
const marked = (fills = FILLS) => (i, body) => ({
  ok: true, status: 200, text: async () => '',
  json: async () => ({ synced: body.sessions.length, turns_synced: 0, fills_missing: fills }),
});

test('re-send gate: a v1 state and replies without the marker stay incremental, and the version stays 1', async () => {
  seedSession('gate-a', 50);
  writeConfig({ sync_enabled: true, anonymous_id: uid(40) });
  writeState({ version: 1, cursors: { 'gate-a': 50 } });
  seedSession('gate-a', 2, { from: 51 });
  const calls = [];
  const restore = stubFetchPlan(calls);
  let res;
  try { res = await syncToCloud(); } finally { restore(); }
  assert.deepEqual(sentKeys(calls), ['gate-a#51', 'gate-a#52'], 'only the new turns');
  assert.equal(res.complete, true);
  assert.doesNotMatch(res.message, /re-sent/);
  const st = readState();
  assert.equal(st.version, 1, 'the re-send is still pending');
  assert.equal(st.cursors['gate-a'], 52);
  // A reply that names other fields is not the marker either.
  seedSession('gate-a', 1, { from: 53 });
  const calls2 = [];
  const restore2 = stubFetchPlan(calls2, marked(['git_branch']));
  try { await syncToCloud(); } finally { restore2(); }
  assert.deepEqual(sentKeys(calls2), ['gate-a#53']);
  assert.equal(readState().version, 1);
});

test('re-send gate: a reply with the marker runs the full pass once, then writes version 2', async () => {
  seedSession('gate-b', 40);
  seedSession('gate-c', 10);
  writeConfig({ sync_enabled: true, anonymous_id: uid(41) });
  writeState({ version: 1, cursors: { 'gate-b': 40, 'gate-c': 10 } });
  seedSession('gate-b', 1, { from: 41 });
  const calls = [];
  const restore = stubFetchPlan(calls, marked());
  let res;
  try { res = await syncToCloud(); } finally { restore(); }
  assert.deepEqual(sentKeys([calls[0]]), ['gate-b#41'], 'the new turn goes first, and its reply carries the marker');
  const resent = sentKeys(calls.slice(1));
  assert.equal(resent.length, 50, 'then every earlier turn once');
  assert.equal(new Set(resent).size, 50);
  assert.ok(!resent.includes('gate-b#41'), 'a turn this run already sent to the new server is not sent again');
  for (const c of calls.slice(1)) {
    assert.ok(c.body.sessions.reduce((a, x) => a + x.turns.length, 0) <= MAX_CHUNK_TURNS, 'the full pass is chunked too');
  }
  assert.equal(res.complete, true);
  assert.match(res.message, /re-sent 50 earlier turns once/);
  const st = readState();
  assert.equal(st.version, 2, 'written once the full pass completed');
  assert.deepEqual(st.cursors, { 'gate-b': 41, 'gate-c': 10 });
  assert.equal(st.resend, undefined, 'no pass left in progress');
});

test('re-send gate: a v2 state never re-sends history, whatever the reply says', async () => {
  seedSession('gate-d', 20);
  writeConfig({ sync_enabled: true, anonymous_id: uid(42) });
  writeState({ version: 2, cursors: { 'gate-d': 20 } });
  seedSession('gate-d', 1, { from: 21 });
  const calls = [];
  const restore = stubFetchPlan(calls, marked());
  let res;
  try { res = await syncToCloud(); } finally { restore(); }
  assert.deepEqual(sentKeys(calls), ['gate-d#21']);
  assert.doesNotMatch(res.message, /re-sent/);
  assert.equal(readState().version, 2);
});

test('re-send gate: an interrupted full pass keeps its progress, and the next marked sync finishes it', async () => {
  seedSession('gate-e', 2500);
  writeConfig({ sync_enabled: true, anonymous_id: uid(43) });
  writeState({ version: 1, cursors: { 'gate-e': 2500 } });
  seedSession('gate-e', 1, { from: 2501 });
  const calls1 = [];
  let restore = stubFetchPlan(calls1, (i, body) => (i === 2 ? fail() : marked()(i, body)));
  let res1;
  try { res1 = await syncToCloud(); } finally { restore(); }
  assert.equal(res1.complete, false, 'a failed re-send request is a failed sync');
  assert.match(res1.message, /re-send/);
  assert.match(res1.message, /next sync/);
  assert.equal(readState().version, 1, 'still pending');
  const doneFirst = sentKeys([calls1[1]]);
  assert.ok(doneFirst.length > 0);

  seedSession('gate-e', 1, { from: 2502 });
  const calls2 = [];
  restore = stubFetchPlan(calls2, marked());
  let res2;
  try { res2 = await syncToCloud(); } finally { restore(); }
  assert.equal(res2.complete, true);
  assert.deepEqual(sentKeys([calls2[0]]), ['gate-e#2502']);
  const rest = sentKeys(calls2.slice(1));
  assert.deepEqual(rest.filter((k) => doneFirst.includes(k)), [], 'what the first pass confirmed is not re-sent');
  const history = new Set([...doneFirst, ...rest]);
  for (let n = 1; n <= 2500; n++) assert.ok(history.has(`gate-e#${n}`), `turn ${n} was re-sent`);
  assert.equal(readState().version, 2);
});

test('re-send gate: a full-pass reply without the marker stops the pass and leaves it pending', async () => {
  seedSession('gate-f', 30);
  writeConfig({ sync_enabled: true, anonymous_id: uid(44) });
  writeState({ version: 1, cursors: { 'gate-f': 30 } });
  seedSession('gate-f', 1, { from: 31 });
  const calls = [];
  const restore = stubFetchPlan(calls, (i, body) => (i === 0 ? marked()(i, body) : null)); // then a server without 009
  let res;
  try { res = await syncToCloud(); } finally { restore(); }
  assert.equal(calls.length, 2, 'one incremental request, one re-send request, then it stops');
  assert.equal(res.complete, true, 'nothing failed; the new turn is up');
  const st = readState();
  assert.equal(st.version, 1);
  assert.deepEqual(st.resend?.done || {}, {}, 'turns a server without the marker took do not count as re-sent');
});

test('badges earned while the upload fails stay pending and go up with the next success', async () => {
  seedEarningSession();
  writeConfig({ sync_enabled: true, anonymous_id: uid(2) });
  const calls1 = [];
  let restore = stubFetchPlan(calls1, () => fail(500, 'boom'));
  try { await syncToCloud(); } finally { restore(); }
  assert.ok(calls1[0].body.badges.length >= 1);
  assert.equal(readConfig().synced_badge_types, undefined, 'nothing marked synced after a failure');
  const calls2 = [];
  restore = stubFetchPlan(calls2);
  try { await syncToCloud(); } finally { restore(); }
  assert.ok(calls2[0].body.badges.some((b) => b.badge_type === 'first_session'), 'badges re-sent after the failure');
  assert.ok(readConfig().synced_badge_types.includes('first_session'));
});

// RC 2026-09-28: a failed sync re-announced 'New badge: …' on every attempt,
// because earned_badges only moves on success. A badge is announced once the
// cloud has taken it (or the sync completed), and then never again.
test('a new badge is announced once, after the cloud takes it — not on every failed attempt', async () => {
  seedEarningSession();
  writeConfig({ sync_enabled: true, anonymous_id: uid(45) });
  const names = (res) => (res.new_badges || []).map((b) => b.type);
  let restore = stubFetchPlan([], () => fail(500, 'boom'));
  let r1, r2;
  try { r1 = await syncToCloud(); r2 = await syncToCloud(); } finally { restore(); }
  assert.deepEqual(names(r1), [], 'not announced on a failed attempt');
  assert.deepEqual(names(r2), [], 'nor on the next failed attempt');
  restore = stubFetchPlan([]);
  let r3, r4;
  try { r3 = await syncToCloud(); r4 = await syncToCloud(); } finally { restore(); }
  assert.ok(names(r3).includes('first_session'), 'announced when the cloud takes it');
  assert.deepEqual(names(r4), [], 'and only once');
});

// RC 2026-09-28: with a v1 state and nothing new — every session's cursor at
// its last turn, badges and profile already synced — sync returned 'Nothing new
// to sync' before any request, so the marker could never arrive and the
// re-send never ran. It now sends one probe (no sessions: the 009 RPC stores
// nothing and answers with the marker; the 008 reply lacks it).
test('re-send gate: with nothing new, a v1 state sends one empty probe, and a marked reply runs the pass', async () => {
  seedSession('probe-a', 30);
  writeConfig({ sync_enabled: true, anonymous_id: uid(46) });
  writeState({ version: 1, cursors: { 'probe-a': 30 } });
  // Flush the badges this history earns, against a server without 009.
  let restore = stubFetchPlan([]);
  try { await syncToCloud(); } finally { restore(); }
  assert.equal(readState().version, 1);

  // Nothing new, server without the marker: one probe, and the message says
  // the re-send waits — not a bare 'Nothing new to sync'.
  const calls1 = [];
  restore = stubFetchPlan(calls1);
  let r1;
  try { r1 = await syncToCloud(); } finally { restore(); }
  assert.equal(calls1.length, 1, 'one probe request');
  assert.deepEqual(calls1[0].body.sessions, [], 'the probe carries no sessions');
  assert.equal(calls1[0].body.badges, undefined);
  assert.equal(r1.complete, true);
  assert.match(r1.message, /^Nothing new to sync; the one-time re-send of earlier turns waits until the cloud/);
  assert.equal(readState().version, 1);

  // Nothing new, server with 009: the probe's marker starts the full pass.
  const calls2 = [];
  restore = stubFetchPlan(calls2, marked());
  let r2;
  try { r2 = await syncToCloud(); } finally { restore(); }
  assert.deepEqual(calls2[0].body.sessions, []);
  const resent = sentKeys(calls2.slice(1));
  assert.equal(resent.length, 30);
  assert.equal(new Set(resent).size, 30);
  assert.equal(r2.complete, true);
  assert.match(r2.message, /re-sent 30 earlier turns once/);
  assert.notEqual(r2.message, 'Nothing new to sync');
  assert.equal(readState().version, 2);

  // Done: no probe, no request.
  const calls3 = [];
  restore = stubFetchPlan(calls3, marked());
  let r3;
  try { r3 = await syncToCloud(); } finally { restore(); }
  assert.equal(calls3.length, 0);
  assert.equal(r3.message, 'Nothing new to sync');
});

test('re-send gate: a failed probe is a failed sync and leaves the re-send pending', async () => {
  seedSession('probe-b', 5);
  writeConfig({ sync_enabled: true, anonymous_id: uid(47) });
  writeState({ version: 1, cursors: { 'probe-b': 5 } });
  let restore = stubFetchPlan([]);
  try { await syncToCloud(); } finally { restore(); }   // flush badges
  restore = stubFetchPlan([], () => fail(503, 'down'));
  let res;
  try { res = await syncToCloud(); } finally { restore(); }
  assert.equal(res.complete, false);
  assert.match(res.message, /re-send/);
  assert.match(res.message, /next sync/);
  assert.equal(readState().version, 1);
});

test('only one sync runs at a time: a live lock holder makes a second sync stand down', async () => {
  seedSession('lock-a', 3);
  writeConfig({ sync_enabled: true, anonymous_id: uid(6) });
  writeFileSync(join(DIR, 'sync.lock'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
  const calls = [];
  const restore = stubFetchPlan(calls);
  let res;
  try { res = await syncToCloud(); } finally { restore(); }
  assert.equal(calls.length, 0, 'no request while another sync holds the lock');
  assert.equal(res.busy, true);
});

test('a stale lock (dead pid) does not block syncing forever', async () => {
  seedSession('lock-b', 3);
  writeConfig({ sync_enabled: true, anonymous_id: uid(7) });
  writeFileSync(join(DIR, 'sync.lock'), JSON.stringify({ pid: 999999, at: '2026-01-01T00:00:00Z' }));
  const calls = [];
  const restore = stubFetchPlan(calls);
  try { await syncToCloud(); } finally { restore(); }
  assert.equal(calls.length, 1);
  assert.equal(existsSync(join(DIR, 'sync.lock')), false, 'lock released after the run');
});

test('pendingSyncCounts reports what is still waiting to upload', () => {
  seedSession('pend-a', 12);
  seedSession('pend-b', 3);
  writeConfig({ sync_enabled: true });
  assert.deepEqual(pendingSyncCounts(), { sessions: 2, turns: 15, resend_pending: false });
  // A v1 state (history already uploaded once) still owes its one-time re-send.
  writeState({ version: 1, cursors: { 'pend-a': 12, 'pend-b': 1 } });
  assert.deepEqual(pendingSyncCounts(), { sessions: 1, turns: 2, resend_pending: true });
  writeState({ version: 2, cursors: { 'pend-a': 12, 'pend-b': 3 } });
  assert.deepEqual(pendingSyncCounts(), { sessions: 0, turns: 0, resend_pending: false });
});

test('`sync --disable` while a sync is in flight stays disabled (no stale config write-back)', async () => {
  seedSession('dis-a', 5);
  writeConfig({ sync_enabled: true, anonymous_id: uid(4) });
  const calls = [];
  const restore = stubFetchPlan(calls, (i) => {
    if (i === 0) { const c = readConfig(); c.sync_enabled = false; writeConfig(c); } // user runs --disable mid-request
    return null;
  });
  try { await syncToCloud(); } finally { restore(); }
  assert.equal(readConfig().sync_enabled, false, 'the in-flight sync must not write sync_enabled back to true');
});

test('the first sync on a config with no anonymous_id keeps the id it generated and sent', async () => {
  seedSession('id-a', 3);
  writeConfig({ sync_enabled: true });
  const calls = [];
  const real = globalThis.fetch;
  const headers = [];
  globalThis.fetch = async (url, opts) => { headers.push(opts.headers['x-anonymous-id']); calls.push(1); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; };
  try { await syncToCloud(); } finally { globalThis.fetch = real; }
  const id = readConfig().anonymous_id;
  assert.ok(id, 'the generated id is persisted');
  assert.equal(headers[0], id, 'and it is the id the upload used');
  globalThis.fetch = async (url, opts) => { headers.push(opts.headers['x-anonymous-id']); return { ok: true, status: 200, json: async () => ({}), text: async () => '' }; };
  seedSession('id-a', 1, { from: 4 });
  try { await syncToCloud(); } finally { globalThis.fetch = real; }
  assert.equal(headers[1], id, 'the next sync uploads under the same identity');
});

// ── QA-0928-05 / contract A: the payload is built from ONE manifest ────────────
// Each uploaded turn carries only the keys below; git branch names go up as salted
// hashes; the privacy previews are generated from the same manifest.

const CONTRACT_A_TURN_KEYS = [
  'turn', 'ts', 'model', 'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
  'cumulative_input', 'cumulative_output', 'cumulative_cache_read', 'cumulative_cache_write',
  'used_percentage', 'cost_usd', 'cumulative_cost_usd', 'cost_estimate_usd', 'speed_tier', 'speed_tier_source',
  'usage_pool', 'billing_basis', 'git_branch', 'project_hash', 'cost_center', 'device_id', 'task_category',
  'edit_target_hash', 'lines_added', 'lines_removed', 'duration_ms', 'api_duration_ms', 'effort_level',
  'thinking_enabled', 'exceeds_200k_tokens', 'cc_version', 'rate_limit_5h_pct', 'rate_limit_5h_resets_at',
  'rate_limit_7d_pct', 'rate_limit_7d_resets_at',
];
const SALT = 'feedfacefeedfacefeedfacefeedface';

// A full collector-shaped record, including the fields that must stay local.
function fullRecord(n, extra = {}) {
  return {
    ts: `2026-09-20T10:00:0${n}.000Z`, session_id: 'full-a', turn: n, model: 'claude-opus-5-5', model_source: 'session_setting',
    input_tokens: 100, output_tokens: 200, cache_read_tokens: 300, cache_write_tokens: 40, tool_names: ['Edit', 'Bash'],
    cumulative_input: 100 * n, cumulative_output: 200 * n, cumulative_cache_read: 300 * n, cumulative_cache_write: 40 * n,
    cost_usd: 0.25, cumulative_cost_usd: 0.25 * n, speed_tier: 'standard', speed_tier_source: 'payload',
    usage_pool: 'interactive', billing_basis: 'subscription_limits', fable_billing: null, used_percentage: 12,
    project_hash: 'abcdefabcdef', git_branch: 'feature/secret-client-name', cost_center: 'Acme', device_id: uid(99),
    task_category: 'feature_development', edit_target_hash: null, user_identifier: uid(98),
    lines_added: 3, lines_removed: 1, cumulative_lines_added: 3, cumulative_lines_removed: 1,
    duration_ms: 1000, api_duration_ms: 800, cumulative_duration_ms: 1000, cumulative_api_duration_ms: 800,
    effort_level: 'xhigh', thinking_enabled: true, exceeds_200k_tokens: false, cc_version: '3.1.0',
    rate_limit_5h_pct: 10, rate_limit_5h_resets_at: 1790000000, rate_limit_7d_pct: 20, rate_limit_7d_resets_at: 1790500000,
    ...extra,
  };
}
function seedRecords(id, rows) {
  mkdirSync(SESSIONS, { recursive: true });
  writeFileSync(join(SESSIONS, `${id}.ndjson`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}
async function syncCapture(config) {
  writeConfig(config);
  const calls = [];
  const restore = stubFetchPlan(calls);
  try { await syncToCloud(); } finally { restore(); }
  return calls;
}
const allTurns = (calls) => calls.flatMap((c) => c.body.sessions.flatMap((s) => s.turns));

test('the manifest is exactly contract A, and every uploaded turn key is in it', async () => {
  const manifestKeys = SYNC_TURN_FIELDS.flatMap((g) => g.keys);
  assert.deepEqual([...manifestKeys].sort(), [...CONTRACT_A_TURN_KEYS].sort(), 'manifest = contract A turn keys');
  seedRecords('full-a', [fullRecord(1), fullRecord(2, { cost_usd: undefined, speed_tier_source: undefined })]);
  const calls = await syncCapture({ sync_enabled: true, anonymous_id: uid(20), edit_hash_salt: SALT });
  const turns = allTurns(calls);
  assert.equal(turns.length, 2);
  for (const t of turns) {
    for (const k of Object.keys(t)) assert.ok(manifestKeys.includes(k), `uploaded key "${k}" is not in the manifest`);
  }
  for (const k of ['tool_names', 'user_identifier', 'session_id', 'fable_billing', 'model_source', 'cumulative_lines_added', 'cumulative_duration_ms']) {
    assert.ok(!(k in turns[0]), `${k} stays local`);
  }
});

test('git branch names go up as "#" + a 12-hex salted hash, never raw', async () => {
  seedRecords('full-a', [fullRecord(1), fullRecord(2, { git_branch: null })]);
  const calls = await syncCapture({ sync_enabled: true, anonymous_id: uid(21), edit_hash_salt: SALT });
  const [a, b] = allTurns(calls);
  const expected = '#' + createHash('sha256').update(SALT + ' ' + 'feature/secret-client-name').digest('hex').slice(0, 12);
  assert.equal(a.git_branch, expected);
  assert.equal(b.git_branch, null, 'no branch stays null');
  assert.ok(!JSON.stringify(calls.map((c) => c.body)).includes('secret-client-name'), 'the raw branch name is nowhere in the upload');
  const local = readFileSync(join(SESSIONS, 'full-a.ndjson'), 'utf8');
  assert.ok(local.includes('feature/secret-client-name'), 'local data keeps the raw branch');
});

test('with no per-install salt a branch is sent as null (an unsalted hash of "main" would be the same for everyone)', async () => {
  seedRecords('full-a', [fullRecord(1)]);
  const calls = await syncCapture({ sync_enabled: true, anonymous_id: uid(22) });
  assert.equal(allTurns(calls)[0].git_branch, null);
});

test('cost_estimate_usd is the list-rate estimate only for a turn without a cost anchor', async () => {
  const anchored = fullRecord(1);
  const unanchored = fullRecord(2);
  delete unanchored.cost_usd;
  seedRecords('full-a', [anchored, unanchored]);
  const calls = await syncCapture({ sync_enabled: true, anonymous_id: uid(23), edit_hash_salt: SALT });
  const [a, b] = allTurns(calls);
  assert.equal(a.cost_estimate_usd, null, 'anchored turn: no estimate');
  assert.equal(a.cost_usd, 0.25);
  assert.equal(b.cost_estimate_usd, computeTurnCost(unanchored), 'unanchored turn: the CLI estimate');
  assert.ok(b.cost_estimate_usd > 0);
});

// Orchestrator ruling on contract A (2026-09-28): a turn the CLI leaves out of
// every $ total — unanchored, on a family-fallback, partner or unknown model
// (turnCostBasis(t).basis === 'excluded') — goes up with cost_estimate_usd null,
// so the dashboard can't price what the CLI names as "Not priced". A legacy row
// with cost_usd 0 and no cumulative cost (QA-0928-52) goes up unanchored.
test('cost_estimate_usd is null for a turn the CLI excludes, and a legacy $0-without-cumulative row goes up unanchored', async () => {
  const noAnchor = (n, model, extra = {}) => { const r = fullRecord(n, { model, ...extra }); delete r.cost_usd; delete r.cumulative_cost_usd; return { ...r, ...extra }; };
  seedRecords('full-a', [
    fullRecord(1),                                   // anchored
    noAnchor(2, 'claude-fable-5-1'),                 // priceable → estimate
    noAnchor(3, 'claude-opus-6'),                    // family fallback → excluded
    noAnchor(4, 'vertex_ai/claude-sonnet-5'),        // partner platform → excluded
    noAnchor(5, 'claude-zeta-9'),                    // unknown → excluded
    fullRecord(6, { model: 'claude-fable-5-1', cost_usd: 0, cumulative_cost_usd: null }), // legacy QA-0928-52 row
  ]);
  const calls = await syncCapture({ sync_enabled: true, anonymous_id: uid(27), edit_hash_salt: SALT });
  const byTurn = Object.fromEntries(allTurns(calls).map((t) => [t.turn, t]));
  assert.equal(byTurn[1].cost_estimate_usd, null);
  assert.ok(byTurn[2].cost_estimate_usd > 0, 'a priceable unanchored turn carries the estimate');
  for (const n of [3, 4, 5]) {
    assert.equal(byTurn[n].cost_estimate_usd, null, `turn ${n} is excluded by the CLI, so no estimate goes up`);
    assert.equal(byTurn[n].cost_usd, undefined);
  }
  assert.equal(byTurn[6].cost_usd, null, 'the legacy $0 is not an anchor');
  assert.ok(byTurn[6].cost_estimate_usd > 0, 'so it goes up as an estimate');
  // The session summary names the excluded turns for the server (a number), and
  // carries only the whitelisted totals.
  const summary = calls[0].body.sessions[0].summary;
  assert.equal(summary.excluded_turns, 3);
  for (const k of Object.keys(summary)) assert.ok(SYNC_SUMMARY_KEYS.includes(k), `summary key "${k}" is not in the whitelist`);
  assert.equal('excluded_models' in summary, false, 'model names of excluded turns stay local (models already counts them)');
  assert.equal(summary.anchored_turns, 1);
  assert.equal(summary.estimated_turns, 2);
});

test('profile.sharing_enabled rides the upload when set, and a change alone is pushed once', async () => {
  seedRecords('full-a', [fullRecord(1)]);
  // A server with 009 (its replies carry the re-send marker), so no one-time
  // re-send is left pending to probe for.
  writeConfig({ sync_enabled: true, anonymous_id: uid(24), edit_hash_salt: SALT, sharing_enabled: true });
  let calls = []; let restore = stubFetchPlan(calls, marked());
  try { await syncToCloud(); } finally { restore(); }
  assert.deepEqual(calls[0].body.profile, { sharing_enabled: true });
  // Nothing new and the cloud already has the setting → no request at all.
  let cfg = readConfig();
  calls = []; restore = stubFetchPlan(calls, marked());
  try { await syncToCloud(); } finally { restore(); }
  assert.equal(calls.length, 0, 'unchanged setting is not re-sent on its own');
  // Opting out with no new turns still reaches the cloud on the next sync.
  cfg = readConfig(); cfg.sharing_enabled = false; writeConfig(cfg);
  calls = []; restore = stubFetchPlan(calls);
  try { await syncToCloud(); } finally { restore(); }
  assert.equal(calls.length, 1, 'a profile-only request');
  assert.deepEqual(calls[0].body.profile, { sharing_enabled: false });
  assert.deepEqual(calls[0].body.sessions, []);
});

test('the sync message says when the sharing setting went up, and a push with no new turns does not read "Synced 0 turns"', async () => {
  seedRecords('full-a', [fullRecord(1)]);
  writeConfig({ sync_enabled: true, anonymous_id: uid(26), edit_hash_salt: SALT, sharing_enabled: true });
  let calls = []; let restore = stubFetchPlan(calls); let result;
  try { result = await syncToCloud(); } finally { restore(); }
  assert.match(result.message, /^Synced 1 turn from 1 session/);
  assert.match(result.message, /leaderboard-sharing setting \(on\)/);
  // Opt out with nothing new to upload: one profile-only request.
  const cfg = readConfig(); cfg.sharing_enabled = false; writeConfig(cfg);
  calls = []; restore = stubFetchPlan(calls);
  try { result = await syncToCloud(); } finally { restore(); }
  assert.equal(calls.length, 1);
  assert.doesNotMatch(result.message, /Synced 0 turns/);
  assert.match(result.message, /No new turns/);
  assert.match(result.message, /leaderboard-sharing setting \(off\)/);
});

test('no profile is sent when sharing was never set', async () => {
  seedRecords('full-a', [fullRecord(1)]);
  const calls = await syncCapture({ sync_enabled: true, anonymous_id: uid(25), edit_hash_salt: SALT });
  assert.equal('profile' in calls[0].body, false);
});

// RC 2026-09-28 follow-up: until migration 009 and the new sync-data deploy,
// the server never sends the fills_missing marker, so each manual sync with
// nothing new and a re-send pending sends one probe. The probe carries the
// unchanged sharing flag, as every request does once it is set (contract A).
// The 0.3.1-era sync-data ignores `profile`, and its RPC with no sessions or
// badges only looks the user up (no daily recompute), so the probe changes
// nothing there. Pinned here against a reply shaped like that server's: one
// small request per sync, no sessions or badges, the setting neither reported
// nor re-recorded as sent, no error recorded, and the re-send still pending.
test('re-send gate: against a server without the marker, each no-op sync sends one probe carrying the unchanged profile, and nothing else changes', async () => {
  seedRecords('full-a', [fullRecord(1), fullRecord(2)]);
  writeConfig({ sync_enabled: true, anonymous_id: uid(48), edit_hash_salt: SALT, sharing_enabled: true, synced_sharing_enabled: true });
  writeState({ version: 1, cursors: { 'full-a': 2 } });
  // The 0.3.1-era reply: counts and a message, no fills_missing.
  const oldServer = (i, body) => ({
    ok: true, status: 200, text: async () => '',
    json: async () => ({ synced: body.sessions.length, turns_synced: 0, message: `Synced ${body.sessions.length} session(s), 0 turn(s)` }),
  });
  let restore = stubFetchPlan([], oldServer);
  try { await syncToCloud(); } finally { restore(); }   // flush the badges this history earns
  const settled = readConfig();
  assert.equal(settled.synced_sharing_enabled, true);

  for (const run of [1, 2]) {
    const calls = [];
    restore = stubFetchPlan(calls, oldServer);
    let res;
    try { res = await syncToCloud(); } finally { restore(); }
    assert.equal(calls.length, 1, `run ${run}: exactly one request, the probe`);
    assert.deepEqual(calls[0].body, { sessions: [], profile: { sharing_enabled: true } }, `run ${run}: no sessions or badges; the unchanged flag rides as on every request`);
    assert.ok(calls[0].bytes < 100, `run ${run}: the probe is tiny (${calls[0].bytes} bytes)`);
    assert.equal(res.complete, true);
    assert.equal(res.turns_synced, 0);
    assert.equal(res.resend_pending, true);
    assert.match(res.message, /^Nothing new to sync; the one-time re-send of earlier turns waits until the cloud reports/);
    assert.doesNotMatch(res.message, /leaderboard-sharing|Synced|sent your/, 'an unchanged setting is not reported as sent');
    const cfg = readConfig();
    assert.equal(cfg.synced_sharing_enabled, true);
    assert.equal(cfg.sharing_enabled, true);
    assert.equal(cfg.last_sync_error, undefined);
    assert.equal(cfg.sync_failures, undefined);
    assert.deepEqual(cfg.synced_badge_types, settled.synced_badge_types, 'no badge is re-sent');
    const st = readState();
    assert.equal(st.version, 1, 'the re-send stays pending until a reply carries the marker');
    assert.equal(st.cursors['full-a'], 2);
  }
});

test('the privacy preview names every manifest group and what else is sent', () => {
  const text = syncPreviewLines().join('\n');
  for (const g of SYNC_TURN_FIELDS) assert.ok(text.includes(g.label), `preview names "${g.label}"`);
  for (const l of SYNC_ALSO_SENT) assert.ok(text.includes(l), `preview names "${l}"`);
  assert.match(text, /git branch names, as salted hashes/i);
  assert.match(text, /cost-center labels you set/i);
  assert.doesNotMatch(text, /salted hashes only|ONLY these/i, 'the old understatement is gone');
});

test('the README sync section lists every manifest group', () => {
  const readme = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'README.md'), 'utf8');
  for (const g of SYNC_TURN_FIELDS) assert.ok(readme.includes(g.label), `README names "${g.label}"`);
  for (const l of SYNC_ALSO_SENT) assert.ok(readme.includes(l), `README names "${l}"`);
  assert.doesNotMatch(readme, /salted hashes only/i);
});

// ── QA-0928-07 / 08 / 142: config.json is never clobbered, created safely ──────

test('a config.json that does not parse is never overwritten and no new id is minted', () => {
  const broken = '{\n  "anonymous_id": "' + uid(30) + '",\n  "plan": "max5",\n}\n';
  writeFileSync(CONFIG, broken);
  assert.throws(() => getOrCreateAnonymousId(), (err) => err instanceof ConfigError
    && err.message.includes(CONFIG) && /not valid JSON/.test(err.message) && /line 4/.test(err.message)
    && !err.message.includes('\n'));
  assert.throws(() => saveConfig({ anonymous_id: uid(31) }), ConfigError);
  assert.equal(readFileSync(CONFIG, 'utf8'), broken, 'file byte-for-byte unchanged');
});

test('a sync on a config that does not parse fails before any upload and leaves the file alone', async () => {
  seedSession('corrupt-a', 3);
  const broken = '{ "sync_enabled": true, "anonymous_id": "' + uid(32) + '", }';
  writeFileSync(CONFIG, broken);
  const calls = [];
  const restore = stubFetchPlan(calls);
  try { await assert.rejects(syncToCloud(), ConfigError); } finally { restore(); }
  assert.equal(calls.length, 0);
  assert.equal(readFileSync(CONFIG, 'utf8'), broken);
});

test('a non-UUID anonymous_id is refused, never replaced', () => {
  writeConfig({ anonymous_id: 'x"; touch /tmp/pwned; echo "' });
  assert.throws(() => getOrCreateAnonymousId(), ConfigError);
  assert.equal(readConfig().anonymous_id, 'x"; touch /tmp/pwned; echo "');
});

test('saveConfig creates a missing data dir (0700) and writes config.json 0600', () => {
  rmSync(DIR, { recursive: true, force: true });
  saveConfig({ anonymous_id: uid(33) });
  assert.equal(statSync(DIR).mode & 0o777, 0o700, 'dir 0700');
  assert.equal(statSync(CONFIG).mode & 0o777, 0o600, 'config 0600');
  // An existing world-readable file is tightened on the next save.
  writeFileSync(CONFIG, '{}', { mode: 0o644 });
  saveConfig({ anonymous_id: uid(33) });
  assert.equal(statSync(CONFIG).mode & 0o777, 0o600);
});

// Node 18's JSON.parse says only "at position N"; the config error still names
// the line and column there (the CLI's engines floor is Node 18).
test('jsonErrorLocation reads newer V8 messages and counts line/column from a position on Node 18', () => {
  const text = '{\n  "edit_hash_salt": "x",\n  "plan": "max5",\n}\n';
  const pos = text.indexOf('}');
  assert.deepEqual(jsonErrorLocation(`Unexpected token } in JSON at position ${pos}`, text), { line: 4, column: 1 });
  assert.deepEqual(jsonErrorLocation('Expected double-quoted property name in JSON at position 44 (line 4 column 1)', text), { line: 4, column: 1 });
  assert.equal(jsonErrorLocation('Unexpected end of JSON input', text), null);
});
