import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

// Honor a WTCLAUDE_DIR override (regression/replay against a fixture dir without
// touching the real ~/.wtclaude). Defaults to the standard home location.
const WTCLAUDE_DIR = process.env.WTCLAUDE_DIR || join(homedir(), '.wtclaude');
const SESSIONS_DIR = join(WTCLAUDE_DIR, 'sessions');
const DAILY_DIR = join(WTCLAUDE_DIR, 'daily');
const COMPARISONS_DIR = join(WTCLAUDE_DIR, 'comparisons');
const CONFIG_FILE = join(WTCLAUDE_DIR, 'config.json');

// 0700 (QA-0928-142): config.json in here holds the anonymous id — the only key
// to a synced cloud row — and the per-install salt. mkdir's mode only applies
// to directories it creates; `setup` tightens an existing one.
export function ensureDataDirs() {
  mkdirSync(WTCLAUDE_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(SESSIONS_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(DAILY_DIR, { recursive: true, mode: 0o700 });
  mkdirSync(COMPARISONS_DIR, { recursive: true, mode: 0o700 });
}

// Claude Code session ids are UUIDs. Anything outside this charset — above all
// a path separator or '..' — would let a crafted payload write outside
// sessions/ (QA-0928-150), so it is refused rather than sanitised. A leading
// letter or digit also rules out '.', '-x' and hidden-file names.
export function isValidSessionId(sessionId) {
  return typeof sessionId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(sessionId)
    && !sessionId.includes('..');
}

export function sessionPath(sessionId) {
  if (!isValidSessionId(sessionId)) throw new Error('invalid session id');
  return join(SESSIONS_DIR, `${sessionId}.ndjson`);
}

export function dailyPath(dateStr) {
  return join(DAILY_DIR, `${dateStr}.json`);
}

// Where Claude Code keeps its user settings. CLAUDE_CONFIG_DIR relocates the
// whole directory (the settings docs: Claude Code "then stores your settings,
// session history, and plugins there instead"), so setup and uninstall must
// follow it or they edit a file Claude Code never reads (QA-0928-46). Same
// resolution as the transcript reader in src/compare/jsonl-reader.js. Resolved
// per call, not at import, so it tracks the environment it runs in.
export function claudeConfigDir() {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

export function claudeSettingsPath() {
  return join(claudeConfigDir(), 'settings.json');
}

export { WTCLAUDE_DIR, SESSIONS_DIR, DAILY_DIR, COMPARISONS_DIR, CONFIG_FILE };
