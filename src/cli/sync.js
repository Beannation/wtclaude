import { createInterface } from 'node:readline/promises';
import { getConfig, saveConfig, getSupabaseConfig, syncToCloud, pruneLegacySecrets } from '../sync/index.js';
import { checkBadges } from '../badges/check.js';
import { listSessions, readSession } from '../utils/sessions.js';

export function registerSync(program) {
  program
    .command('sync')
    .description('Push your usage data to the cloud (opt-in)')
    .option('--status', 'Show cloud sync status')
    .option('--enable', 'Turn on cloud sync (shows a privacy preview first)')
    .option('--disable', 'Turn off cloud sync (your local data is kept)')
    .option('-y, --yes', 'Skip the opt-in confirmation prompt (non-interactive)')
    .action(async (opts) => {
      if (opts.status) {
        showStatus();
        return;
      }

      if (opts.enable) {
        await enableSync(opts);
        return;
      }

      if (opts.disable) {
        const config = getConfig();
        config.sync_enabled = false;
        saveConfig(config);
        console.log('\n  Cloud sync turned off. Your local data and config are kept.\n');
        return;
      }

      // Default: manual push (only if already opted in).
      await runSync();
    });
}

function showStatus() {
  const config = getConfig();
  const { url, publishableKey, syncEnabled } = getSupabaseConfig();
  const ready = Boolean(url && publishableKey);
  const selfHosted = Boolean(config.supabase_url); // user overrode the hosted backend

  console.log('\n  Cloud sync status');
  console.log('  =================\n');
  console.log(`  Sync:       ${syncEnabled ? 'on' : 'off'}`);
  console.log(`  Backend:    ${ready ? (selfHosted ? `self-host (${url})` : 'ready') : 'unavailable'}`);
  console.log(`  Last sync:  ${config.last_sync_at || 'never'}`);
  console.log(`  Your ID:    ${config.anonymous_id || '(created on first sync)'}`);
  console.log('');
  console.log(syncEnabled
    ? '  Push now with `wtclaude sync`. Turn off with `wtclaude sync --disable`.\n'
    : '  Turn it on with `wtclaude sync --enable`.\n');
}

// `--enable` is the ONLY way data sharing turns on, and only after the privacy
// preview + explicit opt-in (audit #4). On confirm we flip the flag and do one
// initial push so the user sees it work.
async function enableSync(opts) {
  const config = getConfig();
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
  const config = getConfig();
  if (config.sync_enabled !== true) {
    console.log('\n  Cloud sync is off. Run `wtclaude sync --enable` to turn it on.\n');
    return;
  }

  console.log('\n  Syncing...');

  try {
    const result = await syncToCloud();
    console.log(`  ${result.message}\n`);

    // Check badges after sync
    const badges = checkBadges();
    const cfg = getConfig();
    const knownBadges = cfg.earned_badges || [];
    const knownSet = new Set(knownBadges);
    const newBadges = badges.filter(b => !knownSet.has(b.type));

    if (newBadges.length > 0) {
      cfg.earned_badges = badges.map(b => b.type);
      saveConfig(cfg);

      for (const badge of newBadges) {
        console.log(`  New badge: ${badge.label}! ${badge.description}`);
      }
      console.log('');
    }
  } catch (err) {
    console.error(`  Sync failed: ${err.message}\n`);
  }
}

// QA-0610-04: privacy preview + opt-in before the first cloud send. Mirrors the
// `leaderboard`/`share` preview-then-opt-in pattern and reuses its vetted privacy
// line; nothing is uploaded until the user confirms (or passes --yes). Returns
// true to proceed, false to abort.
async function confirmSyncOptIn(config, opts = {}) {
  const ids = listSessions();
  let turns = 0;
  for (const id of ids) turns += readSession(id).length;
  const anon = config.anonymous_id || '(generated on first sync)';

  console.log('\n  Cloud sync — privacy preview');
  console.log('  ============================\n');
  console.log('  Enabling sync uploads your usage records to your own anonymous');
  console.log(`  cloud row (id: ${anon}). It would send:`);
  console.log(`    • ${ids.length} session${ids.length === 1 ? '' : 's'} (${turns} per-turn record${turns === 1 ? '' : 's'})`);
  console.log('    • counts/flags + salted hashes only — no prompts, code, file');
  console.log('      names, or project paths, ever.');
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
