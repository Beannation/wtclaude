// Cowork surface reader for compare-models (feature C). The terminal CLI captures
// Code (statusline) only; Cowork emits an OTel/audit.jsonl log the desktop companion
// reads. When that log is present on this machine (or WTCLAUDE_COWORK_AUDIT points at
// it), we read its per-run token counts so the Cowork row is a real — though
// labeled-ESTIMATE — number. Absent, we return [] and the surface renders as "not
// captured here" (never a fabricated zero).
//
// Returned shape matches expectedCost/repriceSurface: turn records with
// { model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens }.
//
// Format-churn note (scope §7): Cowork's log layout can change; this reader is
// isolated and degrades gracefully (bad line -> skip, missing file -> []).

import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Candidate locations for the Cowork audit log, priority order. Explicit env override
// first (also the test seam), then the documented Cowork data dirs.
function candidatePaths() {
  const paths = [];
  if (process.env.WTCLAUDE_COWORK_AUDIT) paths.push(process.env.WTCLAUDE_COWORK_AUDIT);
  const home = homedir();
  paths.push(join(home, '.claude', 'cowork', 'audit.jsonl'));
  paths.push(join(home, 'Library', 'Application Support', 'Claude', 'cowork', 'audit.jsonl'));
  return paths;
}

export function coworkAuditPath() {
  return candidatePaths().find(p => { try { return existsSync(p); } catch { return false; } }) || null;
}

// Parse audit.jsonl into reprice-compatible turns. Cowork records nest token counts
// under `modelUsage` (inputTokens/outputTokens/cacheReadInputTokens/...); we map those
// to the standard token fields. Oddly-shaped/unparseable lines are skipped, not guessed.
export function readCoworkTurns(dateFilter) {
  const path = coworkAuditPath();
  if (!path) return [];
  let data;
  try { data = readFileSync(path, 'utf8'); } catch { return []; }

  const turns = [];
  for (const line of data.split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (dateFilter && e.timestamp) {
      const d = String(e.timestamp).slice(0, 10);
      if (d < dateFilter.start || d > dateFilter.end) continue;
    }
    const mu = e.modelUsage || e.usage || null;
    if (!mu) continue;
    const model = e.model || e.modelId || mu.model || null;
    if (!model) continue;
    turns.push({
      model,
      input_tokens: pick(mu, ['inputTokens', 'input_tokens']),
      output_tokens: pick(mu, ['outputTokens', 'output_tokens']),
      cache_read_tokens: pick(mu, ['cacheReadInputTokens', 'cache_read_input_tokens', 'cacheRead', 'cache_read']),
      cache_write_tokens: pick(mu, ['cacheCreationInputTokens', 'cache_creation_input_tokens', 'cacheWrite', 'cache_write']),
      cost_usd: typeof e.total_cost_usd === 'number' ? e.total_cost_usd : undefined,
    });
  }
  return turns;
}

function pick(obj, keys) {
  for (const k of keys) if (typeof obj[k] === 'number') return obj[k];
  return 0;
}
