// Cowork surface reader for compare-models (feature C). "Cowork" = the desktop
// app's local agent-mode runs. Each run writes a Claude-Code-shaped transcript at:
//   ~/Library/Application Support/Claude/local-agent-mode-sessions/<…>/local_<run>/audit.jsonl
// (MANY per-run files, deeply nested). Older builds used a single
// ~/…/Claude/cowork/audit.jsonl. We walk the session logs, honor the
// WTCLAUDE_COWORK_AUDIT override (a single explicit file, also the test seam), and
// keep the legacy single-file locations for back-compat. Absent everything, we
// return [] and the surface renders as "not captured here" (never a fabricated zero).
//
// The Cowork log carries NO per-run cost field, so Cowork is priced token×rate and
// stays a LABELED ESTIMATE in compare-models regardless.
//
// Format-churn note (scope §7): the app's session layout changes over time — the
// walk is bounded + defensive (missing dir -> skip, bad line -> skip).

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOME = homedir();
const COWORK_SESSIONS_DIR = join(HOME, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions');
const LEGACY_FILES = [
  join(HOME, '.claude', 'cowork', 'audit.jsonl'),
  join(HOME, 'Library', 'Application Support', 'Claude', 'cowork', 'audit.jsonl'),
];

// Bounded recursive walk collecting audit.jsonl paths under a root.
function findAuditFiles(root, out, depth = 0) {
  if (depth > 8) return;
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.git') continue;
      findAuditFiles(join(root, e.name), out, depth + 1);
    } else if (e.name === 'audit.jsonl') {
      out.push(join(root, e.name));
    }
  }
}

// Candidate Cowork audit files, priority order: explicit env override (single file,
// also the test seam) → current per-run session logs → legacy single-file locations.
export function coworkAuditFiles() {
  const override = process.env.WTCLAUDE_COWORK_AUDIT;
  if (override) return existsSync(override) ? [override] : [];
  const files = [];
  findAuditFiles(COWORK_SESSIONS_DIR, files);
  for (const f of LEGACY_FILES) if (existsSync(f)) files.push(f);
  return files;
}

// First candidate (for any UI that wants to show where Cowork data came from).
export function coworkAuditPath() {
  return coworkAuditFiles()[0] || null;
}

function ymd(v) {
  if (v == null) return null;
  const s = String(v);
  // ISO timestamp (2026-06-09T09:07:18.960Z) -> date. Epoch ms -> ISO date.
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return new Date(n).toISOString().slice(0, 10);
  return null;
}

// Parse one Cowork audit.jsonl into reprice-compatible turns. Cowork logs are the
// Claude-Code transcript shape: `assistant` lines carry message.model + message.usage
// (input_tokens / output_tokens / cache_read_input_tokens / cache_creation_input_tokens).
// Streaming writes the SAME response many times (verified: identical usage per repeat),
// so we dedup by message.id + request id and count each response once — matching
// compare/jsonl-reader's QA-0610-01 dedup. `seen` is shared across files.
function parseAuditFile(path, dateFilter, seen) {
  let data;
  try { data = readFileSync(path, 'utf8'); } catch { return []; }
  const turns = [];
  for (const line of data.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type !== 'assistant') continue;
    const msg = e.message && typeof e.message === 'object' ? e.message : null;
    const usage = msg && msg.usage;
    if (!usage) continue;

    if (dateFilter) {
      const d = ymd(e._audit_timestamp ?? e.timestamp);
      // Only filter when we can read a date; an unparseable stamp includes the turn
      // (better than silently dropping real usage).
      if (d && (d < dateFilter.start || d > dateFilter.end)) continue;
    }

    const reqId = e.request_id ?? e.requestId ?? null;
    if (msg.id != null || reqId != null) {
      const key = `${msg.id}:${reqId}`;
      if (seen.has(key)) continue;
      seen.add(key);
    }

    const model = msg.model || e.model || null;
    if (!model) continue;
    turns.push({
      model,
      input_tokens: usage.input_tokens || 0,
      output_tokens: usage.output_tokens || 0,
      cache_read_tokens: usage.cache_read_input_tokens || usage.cache_read || 0,
      cache_write_tokens: usage.cache_creation_input_tokens || usage.cache_write || 0,
    });
  }
  return turns;
}

// Read all Cowork turns across the discovered audit logs (globally deduped).
export function readCoworkTurns(dateFilter) {
  const files = coworkAuditFiles();
  if (files.length === 0) return [];
  const seen = new Set();
  const turns = [];
  for (const f of files) turns.push(...parseAuditFile(f, dateFilter, seen));
  return turns;
}
