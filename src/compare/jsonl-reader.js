import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { localDateOf } from '../utils/time.js';
import { claudeConfigDir } from '../utils/paths.js';

// Where Claude Code keeps conversation transcripts.
//
// `CLAUDE_CONFIG_DIR` relocates the whole thing: the settings documentation says
// that when it is set, "Claude Code then stores your settings, session history,
// and plugins there instead". Hardcoding ~/.claude meant that for anyone who sets
// it we read an empty directory and reported ZERO session-log usage — which, in a
// comparison whose entire point is "your session-log tracker is undercounting",
// renders as the most favourable possible result for us. Honour it.
//
// `CLAUDE_CODE_PROJECT_DIR_NAME` (v2.1.234) renames the per-project directory
// *inside* `projects/`. It needs no handling here because we enumerate whatever
// directories exist rather than deriving a name from the cwd — but it is the
// reason we must keep enumerating instead of computing a path.
//
// Exported so `waste` inventories the same root it reads transcripts from
// (QA-0928-72).
export function claudeRoot() {
  return claudeConfigDir(); // one resolution with setup/uninstall's settings path
}

// A path for display: `~/…` under the home directory, as-is elsewhere.
export function displayPath(p) {
  const home = homedir();
  return p === home || p.startsWith(home + '/') ? '~' + p.slice(home.length) : p;
}

function projectsDir() {
  return join(claudeRoot(), 'projects');
}

// Recursively collect transcript files.
//
// This used to read exactly one level — `projects/<dir>/*.jsonl`. Claude Code
// nests transcripts well below that (subagent and workflow transcripts sit
// several levels down), so on a real machine the one-level walk found fewer
// than a tenth of the transcripts and under half the session-log INPUT tokens.
//
// The direction of that error matters: input-token undercount is the specific
// claim our comparison exists to demonstrate, so reading 44% of the session-log
// side made the gap look larger than it is, in our favour. A recursive walk is
// also what real session-log trackers do, which is the only fair basis for a
// comparison against them.
const MAX_DEPTH = 12;   // generous; guards against a symlink loop

function collectTranscripts(dir, depth = 0, acc = []) {
  if (depth > MAX_DEPTH) return acc;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) collectTranscripts(p, depth + 1, acc);
    else if (entry.name.endsWith('.jsonl')) acc.push(p);
  }
  return acc;
}

// Is there a transcript directory to read at all? "No transcript data available"
// and "you used zero tokens" are completely different statements, and the old
// silent `return []` collapsed them into the second one.
export function transcriptsAvailable() {
  try {
    readdirSync(projectsDir());
    return true;
  } catch {
    return false;
  }
}

export function transcriptRootForDisplay() {
  return projectsDir();
}

// Local midnight at the start of a local 'YYYY-MM-DD', as epoch ms (null if the
// string is not a date).
function localMidnightMs(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  const t = new Date(y, (m || 1) - 1, d || 1).getTime();
  return Number.isFinite(t) && y ? t : null;
}

// ───────────────────────────────────────────────────────────────────────────
// Bounded-memory reading (QA-0928-15, 2026-09-28).
//
// This used to read every transcript whole, parse every line and keep every
// entry — message content included — for the whole window. On a real machine
// (gigabytes of transcripts, most of them touched within 30 days) `compare
// --days 30` and `waste` died with a JavaScript heap out-of-memory. Now:
//   1. a file whose mtime (its LAST write) is before the window's first local
//      midnight cannot hold an in-window record, so it is never opened;
//   2. files are streamed in 1 MB chunks, one line at a time;
//   3. a line is decoded and parsed only if it contains `"assistant"` — every
//      record either caller needs is an assistant line, and the bulky ones
//      (tool results, attachments) are user lines;
//   4. nothing is retained here: callers fold each entry into a compact record.
// Memory is bounded by the largest single line, not by the corpus.
// ───────────────────────────────────────────────────────────────────────────

// Transcripts that CAN hold a record in the window. `stat` is injectable so a
// test can prove the decision is made from mtime alone.
export function transcriptFiles(dateFilter, { stat = statSync } = {}) {
  const all = collectTranscripts(projectsDir());
  const since = dateFilter && dateFilter.start ? localMidnightMs(dateFilter.start) : null;
  if (since == null) return { files: all, skipped: 0 };
  const files = [];
  let skipped = 0;
  for (const p of all) {
    let mtimeMs;
    try { mtimeMs = stat(p).mtimeMs; } catch { continue; }
    if (mtimeMs < since) { skipped++; continue; }
    files.push(p);
  }
  return { files, skipped };
}

const NL = 0x0a;
const CHUNK = 1 << 20;
const ASSISTANT = Buffer.from('"assistant"');

// Call fn(line) for each line of `path` that contains `needle`, reading in
// fixed-size chunks. A line that spans chunks is reassembled from its pieces
// before decoding (a newline byte never occurs inside a multi-byte character).
function forEachMatchingLine(path, needle, fn) {
  let fd;
  try { fd = openSync(path, 'r'); } catch { return; }
  const buf = Buffer.allocUnsafe(CHUNK);
  let carry = [];
  const emit = (bytes) => {
    if (bytes.length > 0 && bytes.indexOf(needle) !== -1) fn(bytes.toString('utf8'));
  };
  try {
    for (;;) {
      let n;
      try { n = readSync(fd, buf, 0, CHUNK, null); } catch { break; }
      if (!n) break;
      const view = buf.subarray(0, n);
      let pos = 0;
      for (;;) {
        const nl = view.indexOf(NL, pos);
        if (nl === -1) {
          if (pos < n) carry.push(Buffer.from(view.subarray(pos)));   // copy: buf is reused
          break;
        }
        if (carry.length) {
          carry.push(view.subarray(pos, nl));
          emit(Buffer.concat(carry));
          carry = [];
        } else {
          emit(view.subarray(pos, nl));
        }
        pos = nl + 1;
      }
    }
    if (carry.length) emit(Buffer.concat(carry));   // last line with no trailing newline
  } finally {
    closeSync(fd);
  }
}

// Is the entry inside the LOCAL-date window? QA-0928-67: this compared the UTC
// date (`timestamp.slice(0, 10)`) against a local range, so an EDT evening
// counted on the next day — the billing-grade side buckets by local date
// (utils/sessions.js), and the two sides must cover the same days. An entry
// with no timestamp is kept, as before.
function inWindow(entry, dateFilter) {
  if (!dateFilter || !entry.timestamp) return true;
  const d = localDateOf(entry.timestamp);
  return d >= dateFilter.start && d <= dateFilter.end;
}

// Visit every in-window assistant entry across the transcripts, one parsed line
// at a time. `visit(entry, fileSessionId)`; the file's basename is passed for
// callers that need a fallback identity.
//
// Also returns `firstDate`: the earliest local date of any assistant entry the
// scan parsed, up to the window's end — earlier than the window when a file it
// read holds older entries. With `skipped` (files last written before the
// window, so all older) it tells a projection how many days the data covers
// (utils/window.js coveredDays; RC 2026-09-28, waste /mo).
export function scanAssistantEntries(dateFilter, visit, { stat } = {}) {
  if (!transcriptsAvailable()) return { available: false, files: 0, skipped: 0, firstDate: null };
  const { files, skipped } = transcriptFiles(dateFilter, { stat });
  let firstDate = null;
  for (const path of files) {
    const fileSession = basename(path, '.jsonl');
    forEachMatchingLine(path, ASSISTANT, (text) => {
      let entry;
      try { entry = JSON.parse(text); } catch { return; }
      if (!entry || typeof entry !== 'object') return;
      if (entry.timestamp) {
        const d = localDateOf(entry.timestamp);
        if (d && (!dateFilter || !dateFilter.end || d <= dateFilter.end) && (!firstDate || d < firstDate)) firstDate = d;
      }
      if (!inWindow(entry, dateFilter)) return;
      visit(entry, fileSession);
    });
  }
  return { available: true, files: files.length, skipped, firstDate };
}

// ───────────────────────────────────────────────────────────────────────────
// One compact usage record per API response.
//
// QA-0610-01: Claude Code writes the same response many times as it streams
// (one line per content block, same message id + request id). Real session-log
// trackers key on `message.id:requestId` and count each response once.
//
// QA-0928-16 (2026-09-28): WHICH of those lines counts. We kept the FIRST, but
// only the last carries the final output count and stop_reason — input and
// cache fields are identical across them, output is not. Keeping the first
// undercounted log-side output several-fold, which understated the log
// side in our favour. The record kept now is
// the FINAL one: the largest output_tokens, a set stop_reason breaking a tie,
// and an all-zero record never replacing a non-zero one. Not "last in scan
// order": the same response can sit in a parent and a subagent transcript, and
// files are read in directory order.
// ───────────────────────────────────────────────────────────────────────────
export function usageRecord(entry, fileSession) {
  const msg = entry && entry.message && typeof entry.message === 'object' ? entry.message : null;
  // Real Claude Code JSONL nests usage under `message.usage` (input_tokens,
  // output_tokens, cache_read_input_tokens, cache_creation_input_tokens). Read
  // that first; fall back to a flat top-level `usage` for flat-shaped fixtures.
  const usage = (msg && msg.usage) || (entry && entry.usage);
  if (!usage || typeof usage !== 'object') return null;
  // Flat fixtures without ids are counted as-is (each entry is its own response).
  const hasId = msg?.id != null || entry.requestId != null;
  return {
    key: hasId ? `${msg?.id}:${entry.requestId}` : null,
    session_id: entry.sessionId || fileSession || null,
    entrypoint: entry.entrypoint || null,
    sidechain: entry.isSidechain === true,
    ts: entry.timestamp || null,
    model: (msg && msg.model) || entry.model || null,
    speed: usage.speed || null,
    stop: msg?.stop_reason != null,
    input_tokens: usage.input_tokens || 0,
    output_tokens: usage.output_tokens || 0,
    cache_read_tokens: usage.cache_read_input_tokens || usage.cache_read || 0,
    cache_write_tokens: usage.cache_creation_input_tokens || usage.cache_write || 0,
  };
}

function isZero(r) {
  return !r.input_tokens && !r.output_tokens && !r.cache_read_tokens && !r.cache_write_tokens;
}

// Should `next` replace `cur` as the record for one response?
export function isBetterFinal(cur, next) {
  if (isZero(next) !== isZero(cur)) return isZero(cur);
  if (next.output_tokens !== cur.output_tokens) return next.output_tokens > cur.output_tokens;
  return next.stop && !cur.stop;
}

// Fold one record in. `byKey` spans ALL files deliberately: one response can
// legitimately appear in more than one transcript (a subagent's and its
// parent's), and it must still be counted once.
export function foldUsage(byKey, anon, rec) {
  if (!rec) return;
  if (rec.key == null) { anon.push(rec); return; }
  const cur = byKey.get(rec.key);
  if (!cur || isBetterFinal(cur, rec)) byKey.set(rec.key, rec);
}

// Every in-window response's final usage record, deduplicated across files.
// `available: false` means there is no transcript directory at all — which is
// not the same statement as "zero usage" (QA-0928-69).
export function readJsonlUsage(dateFilter, opts) {
  const byKey = new Map();
  const anon = [];
  const scan = scanAssistantEntries(dateFilter, (entry, fileSession) => {
    foldUsage(byKey, anon, usageRecord(entry, fileSession));
  }, opts);
  return {
    available: scan.available,
    files: scan.files,
    skipped_files: scan.skipped,
    records: [...byKey.values(), ...anon],
  };
}

export function summarizeUsageRecords(records) {
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;
  for (const r of records) {
    input += r.input_tokens;
    output += r.output_tokens;
    cacheRead += r.cache_read_tokens;
    cacheWrite += r.cache_write_tokens;
  }
  return { input_tokens: input, output_tokens: output, cache_read_tokens: cacheRead, cache_write_tokens: cacheWrite };
}

// Entry-shaped callers: [{ session_id, entries }]. Same dedup, same final-record
// rule as readJsonlUsage().
export function summarizeJsonl(sessions) {
  const byKey = new Map();
  const anon = [];
  for (const session of sessions) {
    for (const entry of session.entries) foldUsage(byKey, anon, usageRecord(entry, session.session_id));
  }
  return summarizeUsageRecords([...byKey.values(), ...anon]);
}
