// Cowork surface reader for compare-models (feature C). "Cowork" = the desktop
// app's local agent-mode runs. Each run keeps its logs in a run directory:
//   ~/Library/Application Support/Claude/local-agent-mode-sessions/<…>/<run>/
//     audit.jsonl                                  the app's audit log
//     .claude/projects/<project>/<session>.jsonl   the run's Claude Code transcripts
//     .claude/projects/<project>/<session>/subagents/*.jsonl
// Run directories are named local_<uuid>/ or, in newer builds, <hex8>/. Older
// builds used a single ~/…/Claude/cowork/audit.jsonl. We walk the session logs,
// honor the WTCLAUDE_COWORK_AUDIT override (a single explicit file, also the test
// seam), and keep the legacy single-file locations for back-compat. Absent
// everything, there are no turns and the surface renders as "not captured here"
// (never a fabricated zero).
//
// WHICH RECORD COUNTS (BUILD-018, QA-0928-23, canon E-7). An audit.jsonl
// `assistant` line echoes the usage snapshot from the START of the response
// (message_start): every repeat of a message id carries the same numbers, and
// its output is 0.5–2% of what the response actually produced. The FINAL usage
// is in the run's own transcripts, which also hold subagent requests that never
// appear in audit.jsonl at all. So we read both, key every record by message.id
// alone (audit lines often lack a request id), and keep the most complete one:
// a record with stop_reason set beats one without, otherwise the larger output
// (streamed output only grows), and an all-zero record never replaces a
// non-zero one. A request with no final record anywhere (interrupted, or logged
// only at its start) is still counted at its largest logged usage and reported
// as partial.
//
// COST FIELDS ARE DELIBERATELY UNUSED. Cowork `result` lines do carry
// total_cost_usd and modelUsage[].costUSD (costBasis 'list' where present). We
// never read them (canon E-1/E-7): Cowork is priced token × rate from the
// records above and stays a LABELED ESTIMATE in compare-models regardless.
// Helper-model calls (web search and fetch) show up only in those result lines'
// modelUsage, never as an assistant record, so they — and search fees — are not
// in this estimate; the compare-models caveat says so (QA-0928-81).
//
// COST OF A CALL (QA-0928-82). A machine can hold well over a gigabyte of these
// logs. With a window, a file whose last write (mtime) predates the window start
// by more than a 36-hour pad cannot hold an in-window record, so it is never
// opened; the per-record date filter still applies to the files we do read
// (a run can span weeks). The walk stops at a run directory instead of
// descending its whole subtree, and a line without "usage" is skipped before
// JSON.parse. Without a window every file is read; the run transcripts are
// most of the volume, so an all-history read takes about twice as long as the
// audit-only reader did (12.5 s against 6.0 s on 1.37 GB, in less memory).
// Every caller passes a window.
//
// Dates are LOCAL calendar dates (QA-0928-83), the same bucketing the Code
// surface uses, so both rows of the table cover the same days.
//
// Format-churn note (scope §7): the app's session layout changes over time — the
// walk is bounded + defensive (missing dir -> skip, bad line -> skip).

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { localDate } from '../utils/time.js';

// Resolved per call, not at import, so HOME can be pointed at a fixture tree.
const sessionsDir = () => join(homedir(), 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
const legacyFiles = () => [
  join(homedir(), '.claude', 'cowork', 'audit.jsonl'),
  join(homedir(), 'Library', 'Application Support', 'Claude', 'cowork', 'audit.jsonl'),
];

// Bounded walk collecting audit.jsonl paths under a root. A directory holding an
// audit.jsonl IS a run: its subtree (.claude/, outputs, uploads, plugin caches)
// never holds another run's log, so the walk stops there.
function findAuditFiles(root, out, depth = 0) {
  if (depth > 8) return;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  if (entries.some(e => e.isFile() && e.name === 'audit.jsonl')) {
    out.push(join(root, 'audit.jsonl'));
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory() || e.name === 'node_modules' || e.name === '.git') continue;
    findAuditFiles(join(root, e.name), out, depth + 1);
  }
}

// A run's own transcripts: <run>/.claude/projects/<project>/<session>.jsonl and
// <session>/subagents/*.jsonl. Bounded; a missing directory means none.
function findTranscripts(root, out, depth = 0) {
  if (depth > 4) return;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) findTranscripts(p, out, depth + 1);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
}

// Candidate Cowork audit files, priority order: explicit env override (single file,
// also the test seam) → current per-run session logs → legacy single-file locations.
export function coworkAuditFiles() {
  const override = process.env.WTCLAUDE_COWORK_AUDIT;
  if (override) return existsSync(override) ? [override] : [];
  const files = [];
  findAuditFiles(sessionsDir(), files);
  for (const f of legacyFiles()) if (existsSync(f)) files.push(f);
  return files;
}

// First candidate (for any UI that wants to show where Cowork data came from).
export function coworkAuditPath() {
  return coworkAuditFiles()[0] || null;
}

// Local calendar date of an ISO timestamp or epoch-ms value; null if unreadable.
function localDay(v) {
  if (v == null) return null;
  const s = String(v);
  const d = /^\d{4}-\d{2}-\d{2}/.test(s) ? new Date(s) : new Date(Number(s));
  if (!(d.getTime() > 0)) return null;
  return localDate(d);
}

// Earliest instant an in-window record can carry: local midnight of the window's
// first day, less a 36-hour pad (file clocks and zones are not ours to trust).
function cutoffMs(dateFilter) {
  if (!dateFilter || !dateFilter.start) return null;
  const [y, m, d] = String(dateFilter.start).split('-').map(Number);
  const t = new Date(y, m - 1, d).getTime();
  return Number.isFinite(t) ? t - 36 * 3_600_000 : null;
}

// mtime is a file's LAST write, so mtime < cutoff means no in-window record.
// An unreadable stat reads the file (fail open).
function isStale(path, cutoff) {
  if (cutoff == null) return false;
  try { return statSync(path).mtimeMs < cutoff; } catch { return false; }
}

const isZero = r => !(r.input_tokens || r.output_tokens || r.cache_read_tokens || r.cache_write_tokens);

// Does `cand` describe the response more completely than `cur`? See the header.
function better(cand, cur) {
  if (!cur) return true;
  if (isZero(cand) !== isZero(cur)) return !isZero(cand);
  const cf = cand.stop != null, uf = cur.stop != null;
  if (cf !== uf) return cf;
  return cand.output_tokens >= cur.output_tokens;
}

// Scan one log file, handing each in-window usage record to `sink`. Returns
// false when the file could not be read.
function scanFile(path, dateFilter, sink, seen) {
  let data;
  try { data = readFileSync(path, 'utf8'); } catch { return false; }
  for (const line of data.split('\n')) {
    if (!line.includes('"usage"')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== 'assistant') continue;
    const msg = e.message && typeof e.message === 'object' ? e.message : null;
    const usage = msg && msg.usage;
    if (!usage) continue;

    const day = localDay(e._audit_timestamp ?? e.timestamp);
    if (dateFilter && day) {
      // Only filter when we can read a date; an unparseable stamp includes the
      // record (better than silently dropping real usage).
      if (day < dateFilter.start) { seen.older = true; continue; }
      if (day > dateFilter.end) continue;
    }

    const model = msg.model || e.model || null;
    // `<synthetic>` is Claude's placeholder for a message no model produced; it
    // carries all-zero usage. Kept, it surfaced as an "excluded, unpriceable"
    // turn with an upgrade hint that no upgrade can satisfy (seen on real logs,
    // 2026-09-27).
    if (!model || model === '<synthetic>') continue;
    const reqId = e.request_id ?? e.requestId ?? null;
    sink(msg.id ?? (reqId != null ? `req:${reqId}` : null), {
      model,
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cache_read_tokens: usage.cache_read_input_tokens || usage.cache_read || 0,
      cache_write_tokens: usage.cache_creation_input_tokens || usage.cache_write || 0,
      stop: msg.stop_reason ?? null,
      day,
    });
  }
  return true;
}

// Read the Cowork logs for a window ({ start, end } local YYYY-MM-DD; omit for
// all history). Returns:
//   turns            reprice-ready turns, one per request
//   files_found      Cowork logs discovered (runs), read or not
//   files_read       files actually opened (audit logs + transcripts)
//   partial_count    requests counted without a final usage record
//   first_date       earliest local day of a counted request, or null
//   older_than_window  Cowork records exist before the window start
export function readCowork(dateFilter) {
  const files = coworkAuditFiles();
  const out = { turns: [], files_found: files.length, files_read: 0, partial_count: 0, first_date: null, older_than_window: false };
  if (files.length === 0) return out;
  const cutoff = cutoffMs(dateFilter);
  const byId = new Map();   // message id -> most complete record
  const anon = [];          // records with no identity: each its own request
  const seen = { older: false };
  const sink = (key, r) => {
    if (key == null) { anon.push(r); return; }
    if (better(r, byId.get(key))) byId.set(key, r);
  };
  const read = (path) => {
    if (isStale(path, cutoff)) { seen.older = true; return; }
    if (scanFile(path, dateFilter, sink, seen)) out.files_read++;
  };
  for (const f of files) {
    read(f);
    const transcripts = [];
    findTranscripts(join(dirname(f), '.claude', 'projects'), transcripts);
    for (const t of transcripts) read(t);
  }

  for (const r of [...byId.values(), ...anon]) {
    if (isZero(r)) continue;
    if (r.stop == null) out.partial_count++;
    if (r.day && (!out.first_date || r.day < out.first_date)) out.first_date = r.day;
    out.turns.push({
      model: r.model,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      cache_read_tokens: r.cache_read_tokens,
      cache_write_tokens: r.cache_write_tokens,
    });
  }
  out.older_than_window = seen.older;
  return out;
}

// Back-compat: just the turns.
export function readCoworkTurns(dateFilter) {
  return readCowork(dateFilter).turns;
}
