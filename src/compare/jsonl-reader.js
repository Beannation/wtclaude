import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

const CLAUDE_DIR = join(homedir(), '.claude', 'projects');

export function readJsonlSessions(dateFilter) {
  let projectDirs;
  try {
    projectDirs = readdirSync(CLAUDE_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => join(CLAUDE_DIR, d.name));
  } catch {
    return [];
  }

  const sessions = [];

  for (const dir of projectDirs) {
    let files;
    try {
      files = readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    for (const file of files) {
      const path = join(dir, file);
      const entries = readJsonlFile(path, dateFilter);
      if (entries.length > 0) {
        sessions.push({
          session_id: basename(file, '.jsonl'),
          entries,
        });
      }
    }
  }

  return sessions;
}

function readJsonlFile(filePath, dateFilter) {
  let data;
  try {
    data = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  const entries = [];
  for (const line of data.split('\n')) {
    if (!line.trim()) continue;
    try {
      const entry = JSON.parse(line);
      if (dateFilter && entry.timestamp) {
        const entryDate = entry.timestamp.slice(0, 10);
        if (entryDate < dateFilter.start || entryDate > dateFilter.end) continue;
      }
      entries.push(entry);
    } catch {
      continue;
    }
  }

  return entries;
}

export function summarizeJsonl(sessions) {
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;

  // QA-0610-01: de-duplicate the streaming partials Claude Code writes for one
  // API response (the same message id + request id appears many times as the
  // response streams). Real session-log trackers key on `message.id:requestId`
  // and count each response once; without this one turn's tokens are summed
  // 2-3x (real data: 983 raw usage-entries today vs 402 unique responses), which
  // both inflated the estimate and masked the input-token undercount.
  const seen = new Set();

  for (const session of sessions) {
    for (const entry of session.entries) {
      // Real Claude Code JSONL nests usage under `message.usage` (input_tokens,
      // output_tokens, cache_read_input_tokens, cache_creation_input_tokens).
      // Read that first; fall back to a flat top-level `usage` for any
      // flat-shaped fixtures. Without this every sum was 0, so the session-log
      // estimate rendered as $0 / N/A — the hero comparison.
      const msg = entry.message && typeof entry.message === 'object' ? entry.message : null;
      const usage = (msg && msg.usage) || entry.usage;
      if (!usage) continue;

      // Dedup when we have an identity to key on; flat fixtures without ids are
      // counted as-is (each entry is its own response).
      if (msg?.id != null || entry.requestId != null) {
        const key = `${msg?.id}:${entry.requestId}`;
        if (seen.has(key)) continue;
        seen.add(key);
      }

      input += usage.input_tokens || 0;
      output += usage.output_tokens || 0;
      cacheRead += usage.cache_read_input_tokens || usage.cache_read || 0;
      cacheWrite += usage.cache_creation_input_tokens || usage.cache_write || 0;
    }
  }

  return { input_tokens: input, output_tokens: output, cache_read_tokens: cacheRead, cache_write_tokens: cacheWrite };
}
