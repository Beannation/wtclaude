import { readdirSync, readFileSync } from 'node:fs';
import { SESSIONS_DIR } from './paths.js';
import { computeTurnCost } from './cost.js';

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
      const d = t.ts.slice(0, 10);
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

  for (const t of turns) {
    input += t.input_tokens;
    output += t.output_tokens;
    cacheRead += t.cache_read_tokens;
    cacheWrite += t.cache_write_tokens;
    cost += computeTurnCost(t);
    models[t.model] = (models[t.model] || 0) + 1;
  }

  return {
    input_tokens: input,
    output_tokens: output,
    cache_read_tokens: cacheRead,
    cache_write_tokens: cacheWrite,
    cost,
    turn_count: turns.length,
    models,
  };
}

export function summarizeSessions(sessions) {
  const allTurns = sessions.flatMap(s => s.turns);
  const summary = summarizeTurns(allTurns);
  summary.session_count = sessions.length;
  return summary;
}
