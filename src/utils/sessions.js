import { readdirSync, readFileSync, statSync } from 'node:fs';
import { SESSIONS_DIR } from './paths.js';
import { turnCostBasis } from './cost.js';
import { localDateOf, normalizeResetsAt } from './time.js';

// Lines this process could not parse, per session file (QA-0928-14). Keyed by
// session id and SET on each read, so reading a file twice never double counts.
const unreadable = new Map();

export function readSession(sessionId) {
  const path = `${SESSIONS_DIR}/${sessionId}.ndjson`;
  const { turns, bad } = readSessionFile(path);
  if (bad > 0) unreadable.set(sessionId, bad);
  else unreadable.delete(sessionId);
  return turns;
}

// `readSession` with a caller-held cache (QA-0928-161): `watch` redraws every few
// seconds, and re-parsing the whole history each frame grew linearly with it.
// A file whose size and mtime are unchanged returns its previous parse.
export function readSessionCached(sessionId, cache) {
  const path = `${SESSIONS_DIR}/${sessionId}.ndjson`;
  let st;
  try { st = statSync(path); } catch { cache.delete(sessionId); return []; }
  const hit = cache.get(sessionId);
  if (hit && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.turns;
  const turns = readSession(sessionId);
  cache.set(sessionId, { size: st.size, mtimeMs: st.mtimeMs, turns });
  return turns;
}

function readSessionFile(filePath) {
  let data;
  try {
    data = readFileSync(filePath, 'utf8');
  } catch {
    return { turns: [], bad: 0 };
  }
  return parseSessionText(data);
}

// Parse ndjson one line at a time (QA-0928-14). A single truncated line — a
// killed collector, a full disk, a power cut mid-write — used to throw out of
// JSON.parse and take down every read command and every sync. Now a line that
// does not parse to an object is skipped and counted. A last line with no
// trailing newline is treated as still being written: skipped, not counted.
export function parseSessionText(data) {
  const turns = [];
  let bad = 0;
  const lines = data.split('\n');
  const endsComplete = data.endsWith('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    let rec;
    try { rec = JSON.parse(line); } catch { rec = undefined; }
    if (rec && typeof rec === 'object' && !Array.isArray(rec)) { turns.push(rec); continue; }
    const beingWritten = i === lines.length - 1 && !endsComplete;
    if (!beingWritten) bad++;
  }
  return { turns, bad };
}

// What the reads in this process had to skip: { lines, files: [{ session_id, lines }] }.
export function getUnreadableLines() {
  const files = [...unreadable.entries()].map(([session_id, lines]) => ({ session_id, lines }));
  return { lines: files.reduce((a, f) => a + f.lines, 0), files };
}

// Whether this process has already produced the note (so the CLI's shared
// post-action hook doesn't print it a second time).
let noteShown = false;

// One line for text output when any line was skipped — file ids and counts only,
// never content. Empty string when every line parsed. `rest` ends the line (the
// read views count the rest; sync uploads it).
export function unreadableNote(rest = 'the rest is counted') {
  const u = getUnreadableLines();
  if (u.lines === 0) return '';
  noteShown = true;
  const ids = u.files.slice(0, 3).map(f => f.session_id.slice(0, 8)).join(', ') + (u.files.length > 3 ? ', …' : '');
  const n = u.files.length;
  return `  Note: skipped ${u.lines} unreadable line${u.lines === 1 ? '' : 's'} in ${n} session file${n === 1 ? '' : 's'} (${ids}) — an interrupted write; ${rest}.`;
}

// The note for a command that has not printed it yet (RC 2026-09-28: only some
// read commands named a skipped line). bin/wtclaude.js prints it to stderr
// after every read command, so JSON and CSV on stdout stay clean. Empty when
// nothing was skipped or the command already showed it.
export function pendingUnreadableNote() {
  return noteShown ? '' : unreadableNote();
}

export function listSessions() {
  let files;
  try {
    files = readdirSync(SESSIONS_DIR).filter(f => f.endsWith('.ndjson'));
  } catch {
    return [];
  }
  return files.map(f => f.replace('.ndjson', ''));
}

export function getSessionsForDateRange(startDate, endDate) {
  const sessionIds = listSessions();
  const results = [];

  for (const id of sessionIds) {
    const turns = readSession(id);
    if (turns.length === 0) continue;

    const sessionTurns = turns.filter(t => {
      // Bucket each turn by its LOCAL calendar date (QA-BUG-10): timestamps are
      // stored UTC, but "today"/week/month are local-day ranges, so a late-evening
      // turn (e.g. 22:00 EDT = 02:00 UTC next day) must count under the local day.
      const d = localDateOf(t.ts);
      return d >= startDate && d <= endDate;
    });

    if (sessionTurns.length > 0) {
      results.push({ session_id: id, turns: sessionTurns });
    }
  }

  return results;
}

export function summarizeTurns(turns) {
  const models = {};
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, cost = 0;
  // Honesty breakdown: how much of `cost` is the billing-grade anchor
  // (collector recorded cost_usd from cost.total_cost_usd) vs the labeled
  // pricing-map estimate (legacy/pre-anchor turns), and the inferred fast-mode
  // spend (speed_tier is inferred — fast mode is not in the payload).
  let anchoredCost = 0, estimatedCost = 0, fastCost = 0;
  let anchoredTurns = 0, estimatedTurns = 0, fastTurns = 0;
  // BUILD-022: track how the fast-mode label was sourced. 'payload' turns read
  // the billing-grade `fast_mode` field; 'inferred' turns are the legacy ratio
  // fallback (older CC). The format layer drops "· inferred" only when every
  // fast turn was payload-sourced.
  let fastPayloadTurns = 0, fastInferredTurns = 0;
  // QA-0928-54: unanchored turns on a model we cannot price (unresolved,
  // partner-platform, family fallback) add nothing to any $ total — they are
  // counted and named instead. Their tokens are real and still counted.
  let excludedTurns = 0;
  const excludedModels = {};

  for (const t of turns) {
    // `|| 0` (QA-0928-154): a row missing a token field counts it as 0, not NaN.
    input += t.input_tokens || 0;
    output += t.output_tokens || 0;
    cacheRead += t.cache_read_tokens || 0;
    cacheWrite += t.cache_write_tokens || 0;
    models[t.model] = (models[t.model] || 0) + 1;
    const { usd: c, basis } = turnCostBasis(t);
    if (basis === 'excluded') {
      excludedTurns++;
      const m = t.model || '(no model)';
      excludedModels[m] = (excludedModels[m] || 0) + 1;
      continue;
    }
    cost += c;
    if (basis === 'billing-grade') { anchoredCost += c; anchoredTurns++; }
    else { estimatedCost += c; estimatedTurns++; }
    if (t.speed_tier === 'fast') {
      fastCost += c; fastTurns++;
      if (t.speed_tier_source === 'payload') fastPayloadTurns++;
      else fastInferredTurns++;
    }
  }

  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    cost,
    anchored_cost: anchoredCost,
    estimated_cost: estimatedCost,
    fast_cost: fastCost,
    anchored_turns: anchoredTurns,
    estimated_turns: estimatedTurns,
    excluded_turns: excludedTurns,
    excluded_models: excludedModels,
    fast_turns: fastTurns,
    fast_payload_turns: fastPayloadTurns,
    fast_inferred_turns: fastInferredTurns,
    turn_count: turns.length,
    models,
  };
}

// The current rate-limit reading across all sessions (QA-0928-61). Powers the
// payload-sourced `limit` gauge (BUILD-023/Task 4) and `watch`. Returns null when
// no turn has rate-limit data (older CC predating the field).
export function getLatestRateLimitTurn() {
  return latestRateLimit(listSessions().flatMap(id => readSession(id)));
}

// Readings from the same window can differ by a few seconds of resets_at.
const SAME_WINDOW_MS = 5 * 60 * 1000;

// Pure core of getLatestRateLimitTurn. The newest row by timestamp is NOT the
// current reading: concurrent sessions report the same window, and a lagging
// session's newer row can carry an older, lower percentage (a real 17% read as
// 16%). So per limit (5-hour, 7-day, independently): take the newest window —
// the latest resets_at — and the highest percentage any row reported for it.
// `ts` is the newest snapshot time. Missing values stay null (shown as "—").
export function latestRateLimit(turns) {
  let ts = null;
  const pick = (pctKey, resetKey) => {
    let newest = null, newestRow = null;
    for (const t of turns) {
      if (t[pctKey] == null) continue;
      const r = normalizeResetsAt(t[resetKey]);
      if (r != null && (newest == null || r > newest)) newest = r;
      if (!newestRow || t.ts > newestRow.ts) newestRow = t;
    }
    if (!newestRow) return { pct: null, resets_at: null };
    if (newest == null) return { pct: Number(newestRow[pctKey]), resets_at: null }; // no reset times at all
    let pct = null, resetsAt = null;
    for (const t of turns) {
      if (t[pctKey] == null) continue;
      const r = normalizeResetsAt(t[resetKey]);
      if (r == null || Math.abs(r - newest) > SAME_WINDOW_MS) continue;
      const p = Number(t[pctKey]);
      if (Number.isFinite(p) && (pct == null || p > pct)) { pct = p; resetsAt = t[resetKey]; }
    }
    return { pct, resets_at: resetsAt };
  };
  for (const t of turns) {
    if (t.rate_limit_5h_pct == null && t.rate_limit_7d_pct == null) continue;
    if (ts == null || t.ts > ts) ts = t.ts;
  }
  if (ts == null) return null;
  const five = pick('rate_limit_5h_pct', 'rate_limit_5h_resets_at');
  const seven = pick('rate_limit_7d_pct', 'rate_limit_7d_resets_at');
  return {
    ts,
    rate_limit_5h_pct: five.pct, rate_limit_5h_resets_at: five.resets_at,
    rate_limit_7d_pct: seven.pct, rate_limit_7d_resets_at: seven.resets_at,
  };
}

export function summarizeSessions(sessions) {
  const allTurns = sessions.flatMap(s => s.turns);
  const summary = summarizeTurns(allTurns);
  summary.session_count = sessions.length;
  return summary;
}
