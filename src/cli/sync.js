import { getConfig, saveConfig, getSupabaseConfig, syncToCloud } from '../sync/index.js';
import { checkBadges } from '../badges/check.js';

export function registerSync(program) {
  program
    .command('sync')
    .description('Sync usage data to the cloud')
    .option('--configure', 'Set up Supabase connection')
    .option('--status', 'Show sync status')
    .option('--enable', 'Enable cloud sync')
    .option('--disable', 'Disable cloud sync')
    .action(async (opts) => {
      if (opts.configure) {
        await configureSynce();
        return;
      }

      if (opts.status) {
        showStatus();
        return;
      }

      if (opts.enable) {
        const config = getConfig();
        config.sync_enabled = true;
        saveConfig(config);
        console.log('\n  Cloud sync enabled. Run `wtclaude sync` to push data.\n');
        return;
      }

      if (opts.disable) {
        const config = getConfig();
        config.sync_enabled = false;
        saveConfig(config);
        console.log('\n  Cloud sync disabled.\n');
        return;
      }

      // Default: run sync
      await runSync();
    });
}

async function configureSynce() {
  const config = getConfig();

  // Read from stdin isn't great in this context, so we'll use env vars or direct config
  console.log('\n  Supabase Configuration');
  console.log('  ======================\n');
  console.log('  Add your Supabase credentials to ~/.wtclaude/config.json:\n');
  console.log('  {');
  console.log('    "supabase_url": "https://YOUR-PROJECT.supabase.co",');
  console.log('    "supabase_anon_key": "YOUR-ANON-KEY",');
  console.log('    "sync_enabled": true');
  console.log('  }\n');
  console.log('  Find these in your Supabase dashboard under Settings > API.\n');

  if (config.supabase_url) {
    console.log(`  Current URL: ${config.supabase_url}`);
    console.log(`  Sync enabled: ${config.sync_enabled || false}\n`);
  }
}

function showStatus() {
  const config = getConfig();
  const { url, syncEnabled } = getSupabaseConfig();

  console.log('\n  Sync Status');
  console.log('  ===========\n');
  console.log(`  Configured: ${url ? 'Yes' : 'No'}`);
  console.log(`  Enabled:    ${syncEnabled ? 'Yes' : 'No'}`);
  console.log(`  Last sync:  ${config.last_sync_at || 'Never'}`);
  console.log(`  Anonymous ID: ${config.anonymous_id || 'Not created yet'}\n`);

  if (!url) {
    console.log('  Run: wtclaude sync --configure\n');
  }
}

async function runSync() {
  const { url, anonKey } = getSupabaseConfig();

  if (!url || !anonKey) {
    console.log('\n  Supabase not configured yet.');
    console.log('  Run: wtclaude sync --configure\n');
    return;
  }

  console.log('\n  Syncing...');

  try {
    const result = await syncToCloud();
    console.log(`  ${result.message}\n`);

    // Check badges after sync
    const badges = checkBadges();
    const config = getConfig();
    const knownBadges = config.earned_badges || [];
    const knownSet = new Set(knownBadges);
    const newBadges = badges.filter(b => !knownSet.has(b.type));

    if (newBadges.length > 0) {
      config.earned_badges = badges.map(b => b.type);
      saveConfig(config);

      for (const badge of newBadges) {
        console.log(`  New badge: ${badge.label}! ${badge.description}`);
      }
      console.log('');
    }
  } catch (err) {
    console.error(`  Sync failed: ${err.message}\n`);
  }
}
