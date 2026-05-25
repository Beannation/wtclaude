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

  for (const session of sessions) {
    for (const entry of session.entries) {
      const usage = entry.usage || {};
      input += usage.input_tokens || 0;
      output += usage.output_tokens || 0;
      cacheRead += usage.cache_read_input_tokens || usage.cache_read || 0;
      cacheWrite += usage.cache_creation_input_tokens || usage.cache_write || 0;
    }
  }

  return { input_tokens: input, output_tokens: output, cache_read_tokens: cacheRead, cache_write_tokens: cacheWrite };
}
