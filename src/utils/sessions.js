import { readdirSync, readFileSync } from 'node:fs';
import { SESSIONS_DIR } from './paths.js';
import { computeTurnCost } from './cost.js';
import { localDateOf } from './time.js';

export function readSession(sessionId) {
  const path = `${SESSIONS_DIR}/${sessionId}.ndjson`;
  return readSessionFile(path);
}

function readSessionFile(filePath) {
  let data;
  try {
    data = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  return data.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
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

  for (const t of turns) {
    input += t.input_tokens;
    output += t.output_tokens;
    cacheRead += t.cache_read_tokens;
    cacheWrite += t.cache_write_tokens;
    const c = computeTurnCost(t);
    cost += c;
    if (typeof t.cost_usd === 'number') { anchoredCost += c; anchoredTurns++; }
    else { estimatedCost += c; estimatedTurns++; }
    if (t.speed_tier === 'fast') {
      fastCost += c; fastTurns++;
      if (t.speed_tier_source === 'payload') fastPayloadTurns++;
      else fastInferredTurns++;
    }
    models[t.model] = (models[t.model] || 0) + 1;
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
    fast_turns: fastTurns,
    fast_payload_turns: fastPayloadTurns,
    fast_inferred_turns: fastInferredTurns,
    turn_count: turns.length,
    models,
  };
}

// Most-recent per-turn record that carries a rate_limits snapshot, across all
// sessions. Powers the payload-sourced `limit` gauge (BUILD-023/Task 4). Returns
// null when no turn has rate-limit data (older CC predating the field).
export function getLatestRateLimitTurn() {
  let latest = null;
  for (const id of listSessions()) {
    for (const t of readSession(id)) {
      if (t.rate_limit_5h_pct == null && t.rate_limit_7d_pct == null) continue;
      if (!latest || t.ts > latest.ts) latest = t;
    }
  }
  return latest;
}

export function summarizeSessions(sessions) {
  const allTurns = sessions.flatMap(s => s.turns);
  const summary = summarizeTurns(allTurns);
  summary.session_count = sessions.length;
  return summary;
}
