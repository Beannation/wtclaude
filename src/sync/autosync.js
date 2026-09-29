import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getConfig, getSupabaseConfig, syncLockHeld } from './index.js';
import { SESSIONS_DIR } from '../utils/paths.js';

// ───────────────────────────────────────────────────────────────────────────
// Auto-sync — opportunistic background push (the "enabled" half of the UX)
//
// "Auto-sync" = push when local data has changed, WITHOUT blocking or touching
// the collector. The collector must stay write-only-local within the ~80ms D-6
// budget, so it never syncs — not on any tick. Instead, the next time the user
// runs any `wtclaude` command, we do a cheap, fully-guarded check and, if a
// push is due, spawn a DETACHED child that runs `wtclaude sync` and return
// immediately. The foreground command is never slowed or blocked, and a sync
// problem can never break it.
//
// Consent invariant (audit #4): this only ever runs when the user has already
// opted in (`sync_enabled === true`), which only happens via `sync --enable` +
// the privacy preview. Data never leaves the machine without that prior opt-in.
// ───────────────────────────────────────────────────────────────────────────

const MIN_INTERVAL_MS = 10 * 60 * 1000; // debounce: at most one auto-push / 10 min
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000; // after repeated failures, at most one try / 6 h
// `statusline` can be wired as a status-line command (it runs every tick).
const SKIP_COMMANDS = new Set(['sync', 'setup', 'uninstall', 'help', 'statusline']);
const SKIP_FLAGS = new Set(['-h', '--help', '-V', '--version']);

// How long to wait after the last attempt. BUILD-018: the debounce used to run
// from the last SUCCESSFUL sync only, so once uploads started failing every
// command spawned another full-backlog upload. Now it runs from the last
// attempt, and doubles per consecutive failed run (10 min, 20, 40 … 6 h).
export function autoSyncIntervalMs(failures) {
  const n = Math.max(0, Math.floor(Number(failures) || 0));
  if (n === 0) return MIN_INTERVAL_MS;
  return Math.min(MAX_BACKOFF_MS, MIN_INTERVAL_MS * 2 ** Math.min(n - 1, 10));
}

// Pure decision (testable): is an auto-push due right now?
export function autoSyncDue(config, nowMs, hasNewData) {
  if (!config || config.sync_enabled !== true) return false;
  const last = Math.max(
    Date.parse(config.last_sync_at || '') || 0,
    Date.parse(config.last_sync_attempt_at || '') || 0,
  );
  if (last && nowMs - last < autoSyncIntervalMs(config.sync_failures)) return false;
  // An unfinished upload (recorded error) is still pending even if no session
  // file changed since.
  return Boolean(config.last_sync_error) || hasNewData();
}

// The subcommand an auto-push may piggy-back on, or null. Skips sync/setup/
// uninstall/help/statusline, any --help/--version run, and anything that is not
// a registered command (a typo, or an option value: `--days 7 week` → '7').
export function autoSyncCommand(argv, knownCommands = null) {
  const args = argv.slice(2);
  if (args.some((a) => SKIP_FLAGS.has(a))) return null;
  const sub = args.find((a) => !a.startsWith('-'));
  if (!sub || SKIP_COMMANDS.has(sub)) return null;
  if (knownCommands && !knownCommands.includes(sub)) return null;
  return sub;
}

export function maybeBackgroundSync(argv = process.argv, knownCommands = null) {
  try {
    // Never recurse: the detached child runs `wtclaude sync` with this flag set.
    if (process.env.WTCLAUDE_AUTOSYNC_CHILD === '1') return;
    // Escape hatch for users/CI that never want a background push.
    if (process.env.WTCLAUDE_NO_AUTOSYNC === '1') return;

    if (!autoSyncCommand(argv, knownCommands)) return;

    const config = getConfig();
    if (config.sync_enabled !== true) return; // only after an explicit opt-in

    const { url, publishableKey } = getSupabaseConfig();
    if (!url || !publishableKey) return;

    if (!autoSyncDue(config, Date.now(), () => hasNewLocalDataSince(config.last_sync_at || null))) return;
    if (syncLockHeld()) return; // a sync is already running

    const binPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');
    const child = spawn(process.execPath, [binPath, 'sync'], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env, WTCLAUDE_AUTOSYNC_CHILD: '1' },
    });
    child.on('error', () => {}); // never surface a spawn error to the foreground
    child.unref();
  } catch {
    // Auto-sync is strictly best-effort — a failure here must never affect the
    // command the user actually ran.
  }
}

// Cheap, stat-only check: is any session file newer than the last sync? Avoids
// reading/parsing session contents on every CLI invocation. When we've never
// synced, any local data counts as new.
function hasNewLocalDataSince(lastSync) {
  let files;
  try { files = readdirSync(SESSIONS_DIR).filter((f) => f.endsWith('.ndjson')); }
  catch { return false; }
  if (files.length === 0) return false;
  if (!lastSync) return true;
  const lastMs = Date.parse(lastSync);
  if (Number.isNaN(lastMs)) return true;
  for (const f of files) {
    try {
      if (statSync(join(SESSIONS_DIR, f)).mtimeMs > lastMs) return true;
    } catch { /* ignore unreadable file */ }
  }
  return false;
}
