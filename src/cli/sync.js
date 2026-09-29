import { createInterface } from 'node:readline/promises';
import {
  readConfigStrict, saveConfig, getSupabaseConfig, syncToCloud, pruneLegacySecrets, pendingSyncCounts, HOSTED_SUPABASE_URL,
  withConfigGuard, assertAnonymousId, shortId, syncPreviewLines,
} from '../sync/index.js';
import { listSessions, readSession, unreadableNote } from '../utils/sessions.js';

// QA-0928-14: what sync had to skip, named by file id and count (never content).
const SYNC_SKIP_REST = "those lines aren't uploaded; the rest is";

// QA-0928-41: the full id grants dashboard access; screens show its start only.
function idLine(id) {
  return `${shortId(id)} (full id: \`wtclaude dashboard\` links this browser)`;
}

export function registerSync(program) {
  program
    .command('sync')
    .description('Push your usage data to the cloud (opt-in)')
    .option('--status', 'Show cloud sync status')
    .option('--enable', 'Turn on cloud sync (shows a privacy preview first)')
    .option('--disable', 'Turn off cloud sync (your local data is kept)')
    .option('-y, --yes', 'Skip the opt-in confirmation prompt (non-interactive)')
    .action(withConfigGuard(async (opts) => {
      if (opts.status) {
        showStatus();
        return;
      }

      if (opts.enable) {
        await enableSync(opts);
        return;
      }

      if (opts.disable) {
        disableSync();
        return;
      }

      // Default: manual push (only if already opted in).
      await runSync();
    }));
}

// QA-0928-08: a no-op on a fresh install (nothing to write, nothing to crash on).
// QA-0928-42: once anything was uploaded, say the cloud copy stays and that
// deleting it is not self-serve yet. Peter's decision: there is no private
// channel for a deletion request yet, and GitHub issues are public (a request
// there would need the id), so the CLI points at none.
function disableSync() {
  const config = readConfigStrict();
  if (config.sync_enabled === true) {
    config.sync_enabled = false;
    saveConfig(config);
    console.log('\n  Cloud sync turned off. Your local data and config are kept.');
  } else {
    console.log('\n  Cloud sync is already off. Nothing to change.');
  }
  if (config.last_sync_at || config.last_sync_attempt_at) {
    console.log('  Data already synced stays in the cloud under this install\'s anonymous id.');
    console.log('  Deleting it isn\'t self-serve yet.');
    console.log('  Don\'t post your anonymous id anywhere public: it opens your dashboard.');
  }
  console.log('');
}

// "3 days ago" / "11 weeks ago" — enough to see at a glance that a date is stale.
function ago(iso) {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const mins = Math.round(ms / 60_000);
  if (mins < 2) return 'just now';
  if (mins < 120) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  if (days < 21) return `${days} days ago`;
  return `${Math.round(days / 7)} weeks ago`;
}

function showStatus() {
  const config = readConfigStrict();
  const { url, publishableKey, syncEnabled } = getSupabaseConfig();
  const ready = Boolean(url && publishableKey);
  // Installs from before the hosted default carry the hosted URL in config; that
  // is still the hosted backend, not a self-host.
  const selfHosted = Boolean(config.supabase_url) && config.supabase_url.replace(/\/+$/, '') !== HOSTED_SUPABASE_URL;

  console.log('\n  Cloud sync status');
  console.log('  =================\n');
  console.log(`  Sync:       ${syncEnabled ? 'on' : 'off'}`);
  console.log(`  Backend:    ${ready ? (selfHosted ? `self-host (${url})` : 'ready') : 'unavailable'}`);
  console.log(`  Last sync:  ${config.last_sync_at ? `${config.last_sync_at} (${ago(config.last_sync_at)})` : 'never'}`);
  const err = config.last_sync_error;
  if (err && err.message) {
    console.log(`  Last try:   FAILED ${err.at ? `${ago(err.at)} ` : ''}— ${err.message}`);
  }
  if (syncEnabled || err) {
    let pending = null;
    try { pending = pendingSyncCounts(); } catch { /* unreadable data — say nothing rather than guess */ }
    const skipped = unreadableNote(SYNC_SKIP_REST);
    if (skipped) console.log(skipped);
    if (pending) {
      // RC 2026-09-28: "the cloud is up to date" sat right above "Re-send:
      // pending"; with a re-send owed, no new turns is all it can say.
      const idle = pending.resend_pending ? 'no new turns' : 'nothing — the cloud is up to date';
      console.log(`  Waiting:    ${pending.turns ? `${pending.turns} turn${pending.turns === 1 ? '' : 's'} from ${pending.sessions} session${pending.sessions === 1 ? '' : 's'}` : idle}`);
      // QA-0928-34: history uploaded before the server could store estimates
      // and hashed branches goes up once more, when the server says it can.
      if (pending.resend_pending) {
        console.log('  Re-send:    pending — earlier turns go up once more, automatically, on a');
        console.log('              sync once the cloud reports it can fill in what older uploads');
        console.log('              lacked (`wtclaude sync` checks)');
      }
    }
  }
  console.log(`  Your ID:    ${config.anonymous_id ? idLine(config.anonymous_id) : '(created on first sync)'}`);
  console.log('');
  if (err && err.message && syncEnabled) {
    console.log('  Uploads resume where they stopped. Retry now with `wtclaude sync`.\n');
    return;
  }
  console.log(syncEnabled
    ? '  Push now with `wtclaude sync`. Turn off with `wtclaude sync --disable`.\n'
    : '  Turn it on with `wtclaude sync --enable`.\n');
}

// `--enable` is the ONLY way data sharing turns on, and only after the privacy
// preview + explicit opt-in (audit #4). On confirm we flip the flag and do one
// initial push so the user sees it work.
async function enableSync(opts) {
  const config = readConfigStrict();
  assertAnonymousId(config);
  if (config.sync_enabled) {
    console.log('\n  Cloud sync is already on. Run `wtclaude sync` to push now.\n');
    return;
  }
  // QA-0610-04: show exactly what sync will send and require opt-in before
  // anything leaves the machine.
  const ok = await confirmSyncOptIn(config, opts);
  if (!ok) {
    console.log('\n  Cloud sync NOT enabled — nothing was sent.\n');
    return;
  }
  config.sync_enabled = true;
  saveConfig(config);
  console.log('\n  Cloud sync enabled.');
  // One initial push right after opt-in.
  await runSync();
}

async function runSync() {
  // QA-BUG-08: scrub any disabled legacy service/secret key from config on sync.
  const stripped = pruneLegacySecrets();
  if (stripped.length) console.log(`  Removed a disabled legacy secret key from config (${stripped.join(', ')}).`);

  // Consent gate (audit #4): a manual `wtclaude sync` NEVER uploads unless the
  // user has already opted in via `--enable` (which shows the privacy preview).
  // It must not silently enable sync, and it must not upload anything otherwise.
  const config = readConfigStrict();
  if (config.sync_enabled !== true) {
    console.log('\n  Cloud sync is off. Run `wtclaude sync --enable` to turn it on.\n');
    return;
  }

  console.log('\n  Syncing...');

  const tty = process.stdout.isTTY;
  let progressShown = false;
  try {
    const result = await syncToCloud({
      onProgress: ({ phase, request, requests, turnsSent, turnsTotal }) => {
        if (!tty || requests < 2) return;
        progressShown = true;
        const what = phase === 'resend' ? 'Re-sending earlier turns once' : 'Uploading';
        process.stdout.write(`\r  ${what}: ${turnsSent} of ${turnsTotal} turns (request ${request} of ${requests})   `);
      },
    });
    if (progressShown) process.stdout.write('\n');
    console.log(`  ${result.message}`);
    const skipped = unreadableNote(SYNC_SKIP_REST);
    if (skipped) console.log(skipped);
    console.log('');
    if (!result.complete && !result.busy) process.exitCode = 1;

    // Newly-earned badges are detected + persisted inside syncToCloud (which also
    // uploads them to the cloud badges table); just announce what it reports.
    const newBadges = result.new_badges || [];
    if (newBadges.length > 0) {
      for (const badge of newBadges) {
        console.log(`  New badge: ${badge.label}! ${badge.description}`);
      }
      console.log('');
    }
  } catch (err) {
    if (progressShown) process.stdout.write('\n');
    console.error(`  Sync failed: ${err.message}\n`);
    process.exitCode = 1;
  }
}

// QA-0610-04: privacy preview + opt-in before the first cloud send. Mirrors the
// `leaderboard`/`share` preview-then-opt-in pattern; nothing is uploaded until the
// user confirms (or passes --yes). Returns true to proceed, false to abort.
// QA-0928-05: the list is the sync manifest itself (what the payload builder
// sends), not hand-written copy.
async function confirmSyncOptIn(config, opts = {}) {
  const ids = listSessions();
  let turns = 0;
  for (const id of ids) turns += readSession(id).length;
  const anon = config.anonymous_id ? idLine(config.anonymous_id) : '(generated on first sync)';

  console.log('\n  Cloud sync — privacy preview');
  console.log('  ============================\n');
  console.log('  Enabling sync uploads your usage records to your own cloud row,');
  console.log(`  keyed by your anonymous id: ${anon}.`);
  console.log(`  It would send ${ids.length} session${ids.length === 1 ? '' : 's'} (${turns} per-turn record${turns === 1 ? '' : 's'}), then new turns as they happen:`);
  for (const line of syncPreviewLines()) console.log(line);
  console.log('  Disable any time with `wtclaude sync --disable`.\n');

  if (opts.yes) {
    console.log('  Confirmed via --yes.');
    return true;
  }
  if (!process.stdin.isTTY) {
    console.log('  Non-interactive shell — re-run with `--yes` to confirm the opt-in.');
    return false;
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question('  Enable cloud sync and allow uploads? [y/N]: ')).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } catch {
    return false; // never let a prompt error silently enable sync
  } finally {
    rl.close();
  }
}
