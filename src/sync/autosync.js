import { spawn } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getConfig, getSupabaseConfig } from './index.js';
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
const SKIP_COMMANDS = new Set(['sync', 'setup', 'uninstall', 'help']);

export function maybeBackgroundSync(argv = process.argv) {
  try {
    // Never recurse: the detached child runs `wtclaude sync` with this flag set.
    if (process.env.WTCLAUDE_AUTOSYNC_CHILD === '1') return;
    // Escape hatch for users/CI that never want a background push.
    if (process.env.WTCLAUDE_NO_AUTOSYNC === '1') return;

    // Only piggy-back on real subcommands; skip sync/setup/uninstall and bare
    // `--help` / `--version` invocations.
    const sub = argv.slice(2).find((a) => !a.startsWith('-'));
    if (!sub || SKIP_COMMANDS.has(sub)) return;

    const config = getConfig();
    if (config.sync_enabled !== true) return; // only after an explicit opt-in

    const { url, publishableKey } = getSupabaseConfig();
    if (!url || !publishableKey) return;

    const lastSync = config.last_sync_at || null;
    const lastMs = lastSync ? Date.parse(lastSync) : 0;
    if (lastMs && Date.now() - lastMs < MIN_INTERVAL_MS) return; // debounced

    if (!hasNewLocalDataSince(lastSync)) return; // nothing changed → nothing to push

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
