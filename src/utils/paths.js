import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

const WTCLAUDE_DIR = join(homedir(), '.wtclaude');
const SESSIONS_DIR = join(WTCLAUDE_DIR, 'sessions');
const DAILY_DIR = join(WTCLAUDE_DIR, 'daily');
const COMPARISONS_DIR = join(WTCLAUDE_DIR, 'comparisons');
const CONFIG_FILE = join(WTCLAUDE_DIR, 'config.json');

export function ensureDataDirs() {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  mkdirSync(DAILY_DIR, { recursive: true });
  mkdirSync(COMPARISONS_DIR, { recursive: true });
}

export function sessionPath(sessionId) {
  return join(SESSIONS_DIR, `${sessionId}.ndjson`);
}

export function dailyPath(dateStr) {
  return join(DAILY_DIR, `${dateStr}.json`);
}

export { WTCLAUDE_DIR, SESSIONS_DIR, DAILY_DIR, COMPARISONS_DIR, CONFIG_FILE };
