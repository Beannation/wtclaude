import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

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
function claudeRoot() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

function projectsDir() {
  return join(claudeRoot(), 'projects');
}

// Recursively collect transcript files.
//
// This used to read exactly one level — `projects/<dir>/*.jsonl`. Claude Code
// nests transcripts well below that (subagent and workflow transcripts sit
// several levels down), so on a real machine on 2026-08-24 the one-level walk
// found 49 of 621 transcripts and 2.4M of 5.4M session-log INPUT tokens.
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

export function readJsonlSessions(dateFilter) {
  if (!transcriptsAvailable()) return [];

  const sessions = [];
  for (const path of collectTranscripts(projectsDir())) {
    const entries = readJsonlFile(path, dateFilter);
    if (entries.length > 0) {
      sessions.push({
        session_id: basename(path, '.jsonl'),
        entries,
      });
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
  //
  // The `seen` set spans ALL sessions deliberately: now that we walk the tree
  // recursively, one response can legitimately appear in more than one file
  // (a subagent transcript and its parent), and it must still be counted once.
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
