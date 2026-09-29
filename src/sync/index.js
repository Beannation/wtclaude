import { readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, statSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, dirname } from 'node:path';
import { CONFIG_FILE, WTCLAUDE_DIR } from '../utils/paths.js';
import { listSessions, readSession, summarizeTurns } from '../utils/sessions.js';
import { checkBadges } from '../badges/check.js';
import { saltedHash } from '../utils/hash.js';
import { turnCostBasis } from '../utils/cost.js';

// QA-0928-07: a config.json that exists but doesn't parse is NOT a fresh
// install. It holds the only key to the user's cloud row (anonymous_id) and the
// salt behind every project_hash, so nothing may overwrite it or mint new ids in
// its place. Readers still get {} from getConfig() (a read-only command should
// keep working); every writer goes through readConfigStrict()/saveConfig(),
// which refuse with a ConfigError: one line naming the file and what to do.
export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ConfigError';
  }
}

// Where JSON.parse stopped, as { line, column } (1-based), or null. Newer V8
// says "(line 4 column 1)"; the V8 in Node 18 says only "at position 58", so
// the line and column are counted from the text — the message names them on
// every Node the CLI supports (engines >= 18).
export function jsonErrorLocation(message, text) {
  const lc = /line (\d+) column (\d+)/.exec(String(message));
  if (lc) return { line: Number(lc[1]), column: Number(lc[2]) };
  const p = /at position (\d+)/.exec(String(message));
  if (!p || typeof text !== 'string') return null;
  const pos = Math.min(Number(p[1]), text.length);
  const before = text.slice(0, pos);
  return { line: before.split('\n').length, column: pos - before.lastIndexOf('\n') };
}

// Missing file → {}. Present but unreadable, not JSON, or not an object → throws.
export function readConfigStrict() {
  let text;
  try {
    text = readFileSync(CONFIG_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new ConfigError(`Can't read ${CONFIG_FILE} (${err.code || err.message}). Fix its permissions, then re-run.`);
  }
  let config;
  try {
    config = JSON.parse(text);
  } catch (err) {
    const at = jsonErrorLocation(err.message, text);
    throw new ConfigError(`${CONFIG_FILE} is not valid JSON${at ? ` (line ${at.line}, column ${at.column})` : ''}. wtclaude won't overwrite it because it holds your install's ids: fix the file (or restore a backup), then re-run.`);
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new ConfigError(`${CONFIG_FILE} is not a JSON object. wtclaude won't overwrite it because it holds your install's ids: fix the file (or restore a backup), then re-run.`);
  }
  return config;
}

export function getConfig() {
  try {
    return readConfigStrict();
  } catch {
    return {};
  }
}

// Atomic replace: the collector reads config.json on every status-line tick, so
// a reader must never see a half-written file (it would fall back to {} and
// stamp that turn with no device id and an unsalted project hash).
// QA-0928-07/08/142: refuses to replace a file that doesn't parse, creates a
// missing data dir (0700) instead of crashing with ENOENT, and writes the file
// 0600 — it holds the anonymous id (the key to the cloud row) and the hash salt.
export function saveConfig(config) {
  readConfigStrict();
  mkdirSync(dirname(CONFIG_FILE), { recursive: true, mode: 0o700 });
  writeJsonAtomic(CONFIG_FILE, config);
}

function writeJsonAtomic(file, obj) {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, file);
}

// Read-modify-write against the file as it is NOW, so a long sync never writes
// back a stale copy over a change another command made meanwhile.
function updateConfig(mutate) {
  const config = readConfigStrict();
  mutate(config);
  saveConfig(config);
  return config;
}

// For CLI actions: a ConfigError becomes one clean line on stderr and exit code
// 1 (no stack trace, and the file is left exactly as it was).
// Whether this process has already told the user config.json is unreadable
// (a guarded command's refusal, or the cold-start copy), so the CLI's shared
// read-command warning doesn't repeat it (RC 2026-09-28).
let configProblemShown = false;
export function markConfigProblemShown() { configProblemShown = true; }
export function configProblemWasShown() { return configProblemShown; }

export function withConfigGuard(action) {
  const report = (err) => {
    if (!(err instanceof ConfigError)) throw err;
    configProblemShown = true;
    console.error(`\n  ${err.message}\n`);
    process.exitCode = 1;
  };
  return (...args) => {
    try {
      const result = action(...args);
      return result && typeof result.then === 'function' ? result.catch(report) : result;
    } catch (err) {
      return report(err);
    }
  };
}

// QA-BUG-08 hygiene: the CLI never uses a privileged service/secret key (all
// privileged writes happen server-side in the sync-data edge function under the
// publishable key + x-anonymous-id). A pre-Phase-C config may still carry the
// now-disabled legacy `service_role` JWT in plaintext. Strip any such dead secret
// key on setup/sync. The publishable key (sb_publishable_…) is browser-safe and
// is explicitly preserved.
const LEGACY_SECRET_KEYS = ['supabase_service_key', 'supabase_service_role_key', 'supabase_secret_key'];

// Remove legacy secret keys from a config object in place. Returns the list of
// keys actually removed (empty when there was nothing to strip).
export function stripLegacySecrets(config) {
  const removed = [];
  for (const k of LEGACY_SECRET_KEYS) {
    if (config[k] !== undefined) { delete config[k]; removed.push(k); }
  }
  return removed;
}

// Load → strip → save (only if something changed). Returns the removed keys so
// the caller can surface a one-line hygiene note. Never throws.
export function pruneLegacySecrets() {
  try {
    const config = getConfig();
    const removed = stripLegacySecrets(config);
    if (removed.length) saveConfig(config);
    return removed;
  } catch {
    return [];
  }
}

// The anonymous id is a random UUID (setup / first sync). It is the key to the
// user's cloud row, so a value of any other shape is refused, never replaced
// (QA-0928-143: it also goes into a dashboard URL; contract A: the server
// rejects non-UUID ids).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAnonymousId(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function assertAnonymousId(config) {
  if (config.anonymous_id && !isAnonymousId(config.anonymous_id)) {
    throw new ConfigError(`The anonymous_id in ${CONFIG_FILE} is not a valid id. wtclaude won't replace it (a new id would cut you off from your synced data): restore it from a backup, then re-run.`);
  }
}

// QA-0928-41: the id grants read access to the dashboard, so screens show only
// its start.
export function shortId(id) {
  return `${String(id).slice(0, 8)}…`;
}

export function getOrCreateAnonymousId() {
  const config = readConfigStrict();
  assertAnonymousId(config);
  if (config.anonymous_id) return config.anonymous_id;

  config.anonymous_id = randomUUID();
  saveConfig(config);
  return config.anonymous_id;
}

// ── Hosted backend (shipped) ─────────────────────────────────────────────────
// WTClaude runs the Supabase project, so cloud sync works out-of-the-box with no
// credentials to paste. The CLI ships the public URL + the browser-safe
// PUBLISHABLE key. That key (sb_publishable_…) is public BY DESIGN: it cannot
// bypass RLS, and every privileged write happens server-side in the `sync-data`
// edge function under the service-role key (a Supabase function secret, never
// shipped). A secret key (sb_secret_…) must NEVER live here.
//
// Self-host (advanced): setting `supabase_url` + `supabase_publishable_key` in
// ~/.wtclaude/config.json overrides these defaults — see the README "Advanced /
// self-host" note. User config still wins; it's just no longer required.
export const HOSTED_SUPABASE_URL = 'https://dddinnggyyabbmrsrhnq.supabase.co';
export const HOSTED_PUBLISHABLE_KEY = 'sb_publishable_n_tD9PkYUfRr3lc9677q3g_YtVB7rir';

export function getSupabaseConfig() {
  const config = getConfig();
  return {
    // Hosted defaults so sync works out-of-the-box; user config still overrides
    // (advanced / self-host) but is no longer required.
    url: config.supabase_url || HOSTED_SUPABASE_URL,
    // Browser-safe PUBLISHABLE key (sb_publishable_…). The legacy
    // `supabase_anon_key` name is still accepted for backward compatibility,
    // but a privileged service/secret key must NEVER live in the CLI path —
    // all privileged writes happen server-side in the sync-data edge function.
    publishableKey: config.supabase_publishable_key || config.supabase_anon_key || HOSTED_PUBLISHABLE_KEY,
    syncEnabled: config.sync_enabled || false,
  };
}

// ── Push (SEC Phase C + BUILD-018) ─────────────────────────────────────────────
// The CLI POSTs batches to the `sync-data` edge function, which holds the
// service-role key ONLY as a Supabase function secret and performs every
// privileged write. The CLI authenticates with the public publishable key plus
// the anonymous id — neither can bypass RLS.
//
// BUILD-018 (QA-0928): the push used to send the whole backlog as ONE request
// and only moved `last_sync_at` when that request succeeded. The server applies
// a batch all-or-nothing, so once a backlog outgrew what one request can carry
// it could never shrink: a real install's backlog grew into a single request of
// tens of megabytes, failing silently in the background for weeks.
// Now:
//   • requests are bounded (MAX_CHUNK_TURNS / MAX_CHUNK_BYTES);
//   • progress is per session — the highest turn number the server confirmed —
//     saved after every successful request in sync-state.json, so a failed or
//     interrupted sync resumes where it stopped. Turn numbers are assigned by the
//     collector as prev + 1 per session file (unique, increasing), which is also
//     the server's idempotency key (UNIQUE(session_id, turn_number)). The first
//     0.3.2 sync with no sync-state file sends the whole history: the old
//     cursor skipped every turn written while a request was in flight, so the
//     cloud may have gaps that only a full send can fill; the server ignores
//     the duplicates. A second, one-time re-send waits for a server that can
//     fill fields older uploads lacked (see RESEND_VERSION below);
//   • a turn the collector writes while a request is in flight is still sent
//     next time (the old `ts > last_sync_at` cursor, stamped after the response,
//     skipped it forever);
//   • failures are recorded in config (last_sync_error, sync_failures) so
//     `sync --status` can say so, and autosync backs off instead of re-sending
//     the whole backlog on every command;
//   • one sync at a time (sync.lock).
// `last_sync_at` now means "the last sync that left nothing behind".

// ── What sync uploads (QA-0928-05, contract A) ───────────────────────────────
// ONE manifest. It filters every uploaded turn (a key not listed here never
// leaves the machine) and it is the text of every privacy preview (sync --enable,
// share --preview, leaderboard) and of the README list — tests pin all of them to
// it. Previews used to say "counts/flags + salted hashes only" while raw git
// branch names, cost-center labels and 40-odd per-turn fields went up.
// Peter's decision (2026-09-28): branch names go up as salted hashes; local data
// keeps them raw.
export const SYNC_TURN_FIELDS = [
  { label: 'Turn number and timestamp', keys: ['turn', 'ts'] },
  { label: 'Model id (e.g. claude-opus-5-5)', keys: ['model'] },
  {
    label: 'Token counts: input, output, cache read and cache write, per turn and running totals',
    keys: ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
      'cumulative_input', 'cumulative_output', 'cumulative_cache_read', 'cumulative_cache_write'],
  },
  { label: 'Context-window use %', keys: ['used_percentage'] },
  {
    label: 'Cost: the billing-grade figure, or a list-rate estimate for a turn without one',
    keys: ['cost_usd', 'cumulative_cost_usd', 'cost_estimate_usd'],
  },
  { label: 'Speed tier, usage pool and billing basis', keys: ['speed_tier', 'speed_tier_source', 'usage_pool', 'billing_basis'] },
  { label: 'Git branch names, as salted hashes', keys: ['git_branch'] },
  { label: 'Project folder, as a salted hash (never the path)', keys: ['project_hash'] },
  { label: 'Cost-center labels you set', keys: ['cost_center'] },
  { label: 'Device id (random, one per install)', keys: ['device_id'] },
  { label: 'Task category and edit-target hash (salted)', keys: ['task_category', 'edit_target_hash'] },
  { label: 'Lines added and removed', keys: ['lines_added', 'lines_removed'] },
  { label: 'Durations: wall-clock and API time', keys: ['duration_ms', 'api_duration_ms'] },
  { label: 'Effort, thinking and long-context flags', keys: ['effort_level', 'thinking_enabled', 'exceeds_200k_tokens'] },
  { label: 'Claude Code version', keys: ['cc_version'] },
  { label: 'Rate-limit % and reset times', keys: ['rate_limit_5h_pct', 'rate_limit_5h_resets_at', 'rate_limit_7d_pct', 'rate_limit_7d_resets_at'] },
];
const SYNC_TURN_KEYS = SYNC_TURN_FIELDS.flatMap((g) => g.keys);

// The rest of each request, besides the per-turn records.
export const SYNC_ALSO_SENT = [
  'Your anonymous id, with every upload (it is the key to your cloud row)',
  'Session ids (the random id Claude Code gives each session)',
  'Per-session totals: tokens, cost, turn counts, models used, start and end time',
  'Badges you have earned, with the date',
  'Your leaderboard-sharing setting (on or off), once you set it',
];
export const SYNC_NEVER_SENT = ['prompts', 'responses', 'code', 'file contents', 'file names', 'folder paths', 'raw branch names', 'your email'];

// Preview lines, indented for the CLI screens.
export function syncPreviewLines(indent = '    ') {
  return [
    `${indent}Per turn:`,
    ...SYNC_TURN_FIELDS.map((g) => `${indent}  • ${g.label}`),
    `${indent}Also:`,
    ...SYNC_ALSO_SENT.map((l) => `${indent}  • ${l}`),
    `${indent}Never sent: ${SYNC_NEVER_SENT.slice(0, 5).join(', ')},`,
    `${indent}  ${SYNC_NEVER_SENT.slice(5).join(', ')}.`,
  ];
}

// Git branch → '#' + salted hash (contract A). The salt is the per-install
// edit_hash_salt the collector uses for project_hash. Without it the branch is
// dropped: an unsalted hash of "main" is the same for everyone, and falling back
// to the anonymous id would salt with a value the server already holds.
function hashBranch(salt, branch) {
  if (branch == null || branch === '' || !salt) return null;
  return `#${saltedHash(salt, branch)}`;
}

// One stored record → the turn contract A allows on the wire.
//
// Cost (contract A as amended by the orchestrator, 2026-09-28): an anchored turn
// sends its cost_usd and no estimate; an unanchored turn on a model the CLI can
// price sends the list-rate estimate; an unanchored turn the CLI EXCLUDES from
// every $ total (turnCostBasis(t).basis === 'excluded': a family-fallback,
// partner-platform or unknown model, QA-0928-54) sends cost_estimate_usd null,
// so the dashboard never prices what the CLI names as "Not priced". A legacy
// cost_usd 0 with no cumulative cost is not an anchor (QA-0928-52): it goes up
// as cost_usd null.
function toSyncTurn(t, salt) {
  const out = {};
  for (const k of SYNC_TURN_KEYS) if (t[k] !== undefined) out[k] = t[k];
  if ('git_branch' in out) out.git_branch = hashBranch(salt, out.git_branch);
  const basis = turnCostBasis(t);
  if (basis.basis !== 'billing-grade' && 'cost_usd' in out) out.cost_usd = null;
  out.cost_estimate_usd = basis.basis === 'estimated' && Number.isFinite(basis.usd) ? basis.usd : null;
  return out;
}

// The per-session totals each request carries ("Per-session totals" in
// SYNC_ALSO_SENT). A whitelist, like the turn manifest: summarizeTurns grows
// keys for local views (excluded_models, the fast-mode source split) that never
// need to leave the machine. excluded_turns (a count) is sent so the server can
// tell a session whose only turns were left unpriced from a billing-grade $0
// (orchestrator ruling on contract A).
export const SYNC_SUMMARY_KEYS = [
  'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
  'cost', 'anchored_cost', 'estimated_cost', 'fast_cost',
  'turn_count', 'anchored_turns', 'estimated_turns', 'excluded_turns', 'fast_turns',
  'models', 'started_at', 'ended_at',
];

function toSyncSummary(turns) {
  const full = summarizeTurns(turns);
  full.started_at = turns[0].ts;
  full.ended_at = turns[turns.length - 1].ts;
  const out = {};
  for (const k of SYNC_SUMMARY_KEYS) if (full[k] !== undefined) out[k] = full[k];
  return out;
}

export const MAX_CHUNK_TURNS = 1000;
export const MAX_CHUNK_BYTES = 1_500_000;
const REQUEST_TIMEOUT_MS = 120_000;
const MAX_FAILED_REQUESTS_PER_RUN = 3;
const LOCK_STALE_MS = 15 * 60 * 1000;

const SYNC_STATE_FILE = join(WTCLAUDE_DIR, 'sync-state.json');
const LOCK_FILE = join(WTCLAUDE_DIR, 'sync.lock');

function turnNo(t) {
  const n = Number(t && t.turn);
  return Number.isFinite(n) ? n : null;
}

// ── The one-time full history re-send (QA-0928-34; orchestrator ruling) ──────
// Uploads before migration 009 could not store a list-rate estimate for an
// unanchored turn, and stored branch names raw (009 nulls those). Migration
// 009's RPC fills such missing fields when a known turn is sent again, and says
// so: its reply carries fills_missing: ['cost_estimate_usd', 'git_branch']. The
// 008 server and the older sync-data reply never do.
//
// sync-state.json `version` < 2 means the full re-send is still pending. It
// runs only in a sync where a reply carried that marker (so a re-send can never
// go to a server that would ignore it), and version 2 is written only when the
// pass completes; an interrupted pass keeps its progress in `resend.done` and
// the next marked sync continues it. Until the marker appears, syncing stays
// incremental. An existing v1 file — cursors for every session, written by an
// earlier 0.3.2 build against the 008 server — heals on the first sync after
// the server deploy, with no manual step.
//
// FIXED 2026-09-28 (RC): that first sync returned "Nothing new to sync" before
// any request when nothing else was pending, so no reply could carry the
// marker and the re-send never ran. With a re-send pending and nothing else to
// send, sync now sends one PROBE — a body with no sessions, plus the profile
// flag if set. Migration 009's RPC stores nothing for it (no sessions, badges
// or profile change → no user created) and answers with the marker; the 008
// reply lacks it, so the re-send keeps waiting.
const RESEND_VERSION = 2;
const FILL_MARKER = 'cost_estimate_usd';

function fillsMissing(reply) {
  return !!(reply && Array.isArray(reply.fills_missing) && reply.fills_missing.includes(FILL_MARKER));
}

function readSyncState() {
  try {
    const s = JSON.parse(readFileSync(SYNC_STATE_FILE, 'utf8'));
    if (s && typeof s.cursors === 'object' && s.cursors) {
      const version = Number.isInteger(s.version) ? s.version : 1;
      const done = s.resend && typeof s.resend.done === 'object' && s.resend.done ? s.resend.done : null;
      return { version, cursors: s.cursors, resendDone: done };
    }
  } catch { /* absent or unreadable → derive */ }
  return null;
}

// Per-session upload cursors, the state version, and any re-send progress.
// Without a sync-state file (first run, or an install that last synced on
// ≤0.3.1) every turn is pending: a pre-0.3.2 `last_sync_at` cannot say which
// turns reached the cloud, because it was stamped after the response and
// skipped anything written during the request.
function loadSyncState() {
  const saved = readSyncState();
  if (saved) {
    return { version: saved.version, cursors: { ...saved.cursors }, resendDone: saved.resendDone ? { ...saved.resendDone } : null, derived: false };
  }
  return { version: 1, cursors: {}, resendDone: null, derived: true };
}

function saveSyncState({ version, cursors, resendDone }) {
  const out = { version, cursors };
  if (version < RESEND_VERSION && resendDone && Object.keys(resendDone).length) out.resend = { done: resendDone };
  writeJsonAtomic(SYNC_STATE_FILE, out);
}

function readAllSessions() {
  const out = [];
  for (const id of listSessions()) {
    const turns = readSession(id);
    if (turns.length) out.push({ id, turns });
  }
  return out;
}

function pendingPieces(sessions, cursors) {
  const pieces = [];
  for (const { id, turns } of sessions) {
    const from = cursors[id] || 0;
    const pending = turns.filter((t) => { const n = turnNo(t); return n != null && n > from; });
    if (!pending.length) continue;
    pieces.push({ id, turns, pending });
  }
  return pieces;
}

// What is still waiting to upload (for `sync --status` and hints).
// `resend_pending`: an earlier upload's history still waits for its one-time
// re-send (it runs once the server reports it can fill missing fields).
export function pendingSyncCounts() {
  const sessions = readAllSessions();
  const state = loadSyncState();
  const pieces = pendingPieces(sessions, state.cursors);
  return {
    sessions: pieces.length,
    turns: pieces.reduce((a, p) => a + p.pending.length, 0),
    resend_pending: !state.derived && state.version < RESEND_VERSION && Object.keys(state.cursors).length > 0,
  };
}

// The re-send pieces: per session, the turns an earlier upload confirmed
// (up to `target`) that the re-send has not yet confirmed (above `done`).
function resendPieces(sessions, target, done) {
  const pieces = [];
  for (const { id, turns } of sessions) {
    const hi = target[id] || 0;
    const lo = done[id] || 0;
    if (hi <= lo) continue;
    const pending = turns.filter((t) => { const n = turnNo(t); return n != null && n > lo && n <= hi; });
    if (pending.length) pieces.push({ id, turns, pending });
  }
  return pieces;
}

// Split the pending turns into requests bounded by turn count and bytes. A
// session larger than one request is split across consecutive requests; each
// part carries the session's full-history summary (the server upserts it).
function planRequests(pieces, salt) {
  const requests = [];
  let cur = [], curTurns = 0, curBytes = 16;
  const flush = () => { if (cur.length) requests.push(cur); cur = []; curTurns = 0; curBytes = 16; };
  for (const p of pieces) {
    const summary = toSyncSummary(p.turns);
    const baseBytes = Buffer.byteLength(JSON.stringify({ session_id: p.id, summary, turns: [] })) + 2;
    let i = 0;
    while (i < p.pending.length) {
      const slice = [];
      let bytes = baseBytes;
      while (i < p.pending.length) {
        const turn = toSyncTurn(p.pending[i], salt);
        const tb = Buffer.byteLength(JSON.stringify(turn)) + 1;
        const empty = cur.length === 0 && slice.length === 0; // one oversized turn still goes, alone
        if (!empty && (curTurns + slice.length + 1 > MAX_CHUNK_TURNS || curBytes + bytes + tb > MAX_CHUNK_BYTES)) break;
        slice.push(turn);
        bytes += tb;
        i++;
      }
      if (!slice.length) { flush(); continue; }
      cur.push({ session_id: p.id, summary, turns: slice });
      curTurns += slice.length;
      curBytes += bytes;
      if (i < p.pending.length) flush();
    }
  }
  flush();
  return requests;
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; }
}

export function syncLockHeld() {
  try {
    const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
    const age = Date.now() - Date.parse(lock.at);
    return pidAlive(lock.pid) && Number.isFinite(age) && age < LOCK_STALE_MS;
  } catch {
    return false;
  }
}

function acquireLock() {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(LOCK_FILE, 'wx');
      writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
      closeSync(fd);
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') return true; // can't lock (read-only dir?) — don't block the sync on it
      if (syncLockHeld()) return false;
      try { unlinkSync(LOCK_FILE); } catch { /* raced with another cleaner */ }
    }
  }
  return false;
}

function releaseLock() {
  try {
    const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
    if (lock.pid === process.pid) unlinkSync(LOCK_FILE);
  } catch { /* already gone */ }
}

function oneLine(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

async function postBatch(sbConfig, anonymousId, body) {
  let response;
  try {
    response = await fetch(`${sbConfig.url}/functions/v1/sync-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sbConfig.publishableKey}`,
        'x-anonymous-id': anonymousId,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(`network error: ${oneLine(err && err.message)}`);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`server returned ${response.status}${text ? ` (${oneLine(text)})` : ''}`);
  }
  return response.json().catch(() => ({}));
}

// Earned badges → cloud, riding the same opt-in-gated push. Each badge keeps a
// STABLE earn timestamp (badge_earned_at) so re-syncs don't churn earned_at; the
// server upsert is on-conflict-do-nothing. synced_badge_types records what the
// cloud has confirmed, so badges earned while an upload was failing still go up.
function prepareBadges() {
  const earned = checkBadges();
  const stamps = {};
  updateConfig((config) => {
    config.badge_earned_at = config.badge_earned_at || {};
    const stampNow = new Date().toISOString();
    for (const b of earned) {
      if (!config.badge_earned_at[b.type]) config.badge_earned_at[b.type] = stampNow;
      stamps[b.type] = config.badge_earned_at[b.type];
    }
    if (!earned.length && !Object.keys(config.badge_earned_at).length) delete config.badge_earned_at;
  });
  const config = getConfig();
  const prevEarned = new Set(config.earned_badges || []);
  const syncedSet = new Set(config.synced_badge_types || []);
  return {
    earned,
    newBadges: earned.filter((b) => !prevEarned.has(b.type)), // newly earned → CLI announce
    toSend: earned.filter((b) => !syncedSet.has(b.type)).map((b) => ({ badge_type: b.type, earned_at: stamps[b.type] })),
  };
}

export async function syncToCloud({ onProgress } = {}) {
  const sbConfig = getSupabaseConfig();
  if (!sbConfig.url || !sbConfig.publishableKey) {
    // With the hosted defaults shipped this is effectively unreachable; it only
    // fires if a self-host config blanks out the backend.
    throw new Error('Cloud sync backend is not available.');
  }
  if (!acquireLock()) {
    return { busy: true, complete: false, synced: 0, turns_synced: 0, new_badges: [], message: 'Another sync is already running — try again in a minute.' };
  }
  try {
    return await runLockedSync(sbConfig, onProgress);
  } finally {
    releaseLock();
  }
}

// QA-0928-39 (contract A): the leaderboard opt-in reaches the cloud as
// profile.sharing_enabled. It rides every request once the user has set it, and
// a change on its own (no new turns) still gets one request; synced_sharing_enabled
// records the value the cloud confirmed.
function prepareProfile(config) {
  if (typeof config.sharing_enabled !== 'boolean') return { profile: null, pending: false };
  const profile = { sharing_enabled: config.sharing_enabled };
  return { profile, pending: config.synced_sharing_enabled !== config.sharing_enabled };
}

async function runLockedSync(sbConfig, onProgress) {
  const startedAt = new Date().toISOString();
  const anonymousId = getOrCreateAnonymousId();
  const config = readConfigStrict();
  const sessions = readAllSessions();
  const state = loadSyncState();
  const { cursors, derived } = state;
  const base = { ...cursors }; // what earlier syncs confirmed (the re-send's scope)
  const requests = planRequests(pendingPieces(sessions, cursors), config.edit_hash_salt);
  const badges = prepareBadges();
  const earnedTypes = badges.earned.map((b) => b.type);
  const turnsTotal = requests.reduce((a, r) => a + r.reduce((b, p) => b + p.turns.length, 0), 0);
  const { profile, pending: profileWaiting } = prepareProfile(config);
  let profilePending = profileWaiting;
  // A re-send is pending for history an earlier sync confirmed (see RESEND_VERSION).
  const resendPending = !derived && state.version < RESEND_VERSION && Object.keys(cursors).length > 0;
  // Nothing else to send: one empty request asks the server for the marker.
  const probe = resendPending && !requests.length && !badges.toSend.length && !profilePending;

  if (!requests.length && !badges.toSend.length && !profilePending && !probe) {
    // syncToCloud() PUSHES; it must never flip the opt-in (audit #4). Enabling
    // happens only via `wtclaude sync --enable` + the privacy preview.
    updateConfig((config) => {
      config.last_sync_at = startedAt;
      delete config.last_sync_error;
      delete config.sync_failures;
      if (earnedTypes.length) config.earned_badges = earnedTypes;
    });
    if (derived) saveSyncState(state);
    return { synced: 0, turns_synced: 0, complete: true, message: 'Nothing new to sync', new_badges: badges.newBadges };
  }

  const blocked = new Set(); // sessions with a failed part: later parts wait, so progress stays contiguous
  const sessionsDone = new Set();
  let badgesPending = badges.toSend.length > 0;
  let profileSent = false;
  let turnsSent = 0, failures = 0, lastError = null, stoppedEarly = false;
  let markerSeen = false;
  let badgesConfirmed = false; // the cloud took this run's badges: announce them
  const unmarked = {}; // per session, the highest turn a reply WITHOUT the marker confirmed this run
  const batches = requests.length ? requests : [[]]; // badges-/profile-only push, or the probe

  for (let k = 0; k < batches.length; k++) {
    const parts = batches[k].filter((p) => !blocked.has(p.session_id));
    if (!parts.length && !badgesPending && !profilePending && !probe) continue;
    const body = { sessions: parts };
    if (badgesPending) body.badges = badges.toSend;
    if (profile) body.profile = profile;
    let reply;
    try {
      reply = await postBatch(sbConfig, anonymousId, body);
    } catch (err) {
      lastError = err.message;
      failures++;
      for (const p of parts) blocked.add(p.session_id);
      if (failures >= MAX_FAILED_REQUESTS_PER_RUN) { stoppedEarly = true; break; }
      continue;
    }
    const marked = fillsMissing(reply);
    if (marked) markerSeen = true;
    for (const p of parts) {
      const last = turnNo(p.turns[p.turns.length - 1]);
      if (last != null && last > (cursors[p.session_id] || 0)) cursors[p.session_id] = last;
      if (!marked && last != null && last > (unmarked[p.session_id] || 0)) unmarked[p.session_id] = last;
      turnsSent += p.turns.length;
      sessionsDone.add(p.session_id);
    }
    saveSyncState(state);
    if (body.profile && profilePending) {
      profilePending = false;
      profileSent = true;
      updateConfig((config) => { config.synced_sharing_enabled = body.profile.sharing_enabled; });
    }
    if (body.badges) {
      badgesPending = false;
      badgesConfirmed = true;
      updateConfig((config) => {
        config.earned_badges = earnedTypes;
        config.synced_badge_types = [...new Set([...(config.synced_badge_types || []), ...badges.toSend.map((b) => b.badge_type)])];
      });
    }
    if (onProgress) onProgress({ request: k + 1, requests: batches.length, turnsSent, turnsTotal });
  }
  const newFailures = failures;

  // The one-time full re-send (see RESEND_VERSION): only in a sync where a
  // reply carried the marker, and only once this run's new turns all went up.
  // Its scope is what earlier syncs confirmed, plus anything this run sent
  // before the marker appeared; a turn a marked reply already took is not
  // sent twice in the same run.
  let resent = 0, resendTotal = 0, resendFailed = false;
  if (state.version < RESEND_VERSION && markerSeen && failures === 0) {
    const target = { ...base };
    for (const [id, n] of Object.entries(unmarked)) if (n > (target[id] || 0)) target[id] = n;
    const done = state.resendDone || {};
    const resendRequests = planRequests(resendPieces(sessions, target, done), config.edit_hash_salt);
    resendTotal = resendRequests.reduce((a, r) => a + r.reduce((b, p) => b + p.turns.length, 0), 0);
    let finished = true;
    for (let k = 0; k < resendRequests.length; k++) {
      const parts = resendRequests[k];
      const body = { sessions: parts };
      if (profile) body.profile = profile;
      let reply;
      try {
        reply = await postBatch(sbConfig, anonymousId, body);
      } catch (err) {
        lastError = err.message;
        failures++;
        resendFailed = true;
        finished = false;
        break;
      }
      // A server that stops saying it fills missing fields (a rollback) gets
      // no more of the re-send, and what it took doesn't count as re-sent.
      if (!fillsMissing(reply)) { finished = false; break; }
      for (const p of parts) {
        const last = turnNo(p.turns[p.turns.length - 1]);
        if (last != null && last > (done[p.session_id] || 0)) done[p.session_id] = last;
        resent += p.turns.length;
      }
      state.resendDone = done;
      saveSyncState(state);
      if (onProgress) onProgress({ phase: 'resend', request: k + 1, requests: resendRequests.length, turnsSent: resent, turnsTotal: resendTotal });
    }
    if (finished) {
      state.version = RESEND_VERSION;
      state.resendDone = null;
      saveSyncState(state);
    }
  }

  const complete = failures === 0;
  updateConfig((config) => {
    config.last_sync_attempt_at = startedAt;
    if (complete) {
      config.last_sync_at = startedAt;
      delete config.last_sync_error;
      delete config.sync_failures;
      if (earnedTypes.length) config.earned_badges = earnedTypes;
    } else {
      config.last_sync_error = { at: startedAt, message: lastError };
      config.sync_failures = (Number(config.sync_failures) || 0) + 1;
    }
  });

  const left = turnsTotal - turnsSent;
  // A changed sharing setting is named, so a profile-only push (share --disable,
  // nothing new to upload) doesn't read as "Synced 0 turns from 0 sessions".
  const setting = profileSent ? `your leaderboard-sharing setting (${profile.sharing_enabled ? 'on' : 'off'})` : '';
  let message;
  if (probe) {
    // Nothing new went up; the probe only asked about the re-send.
    message = newFailures === 0
      ? 'Nothing new to sync'
      : `Nothing new to upload, but the check for the one-time re-send of earlier turns failed (${lastError}). Nothing is lost — the next sync tries again.`;
  } else {
    message = newFailures === 0
      ? (turnsSent || !setting
        ? `Synced ${turnsSent} turn${turnsSent === 1 ? '' : 's'} from ${sessionsDone.size} session${sessionsDone.size === 1 ? '' : 's'}${batches.length > 1 ? ` in ${batches.length} requests` : ''}${setting ? `, plus ${setting}` : ''}`
        : `No new turns; sent ${setting}`)
      : `Uploaded ${turnsSent} of ${turnsTotal} turns; ${left} still waiting (${stoppedEarly ? 'stopped after repeated failures' : 'a request failed'}: ${lastError}). Nothing is lost — the next sync resumes from here.`;
  }
  if (resendFailed) {
    message += `. The one-time re-send of earlier turns stopped after ${resent} of ${resendTotal} (a request failed: ${lastError}); nothing is lost — the next sync continues it.`;
  } else if (resent > 0) {
    message += `; re-sent ${resent} earlier turn${resent === 1 ? '' : 's'} once so the cloud can fill in what older uploads lacked`;
  } else if (probe && newFailures === 0 && state.version < RESEND_VERSION) {
    message += '; the one-time re-send of earlier turns waits until the cloud reports it can fill in what older uploads lacked';
  }
  return {
    synced: sessionsDone.size,
    turns_synced: turnsSent,
    turns_pending: left,
    turns_resent: resent,
    resend_pending: state.version < RESEND_VERSION,
    complete,
    error: complete ? undefined : lastError,
    message,
    // Announced once the cloud took them (or the sync completed) — earned_badges
    // has moved, so the next run won't announce them again. A failed attempt
    // announces nothing (it used to repeat 'New badge' on every retry).
    new_badges: badgesConfirmed || complete ? badges.newBadges : [],
  };
}
