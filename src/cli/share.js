import { readConfigStrict, saveConfig, withConfigGuard, shortId, syncPreviewLines } from '../sync/index.js';

// What the leaderboard shows for an opted-in user (get-leaderboard): per week and
// per month, a rank with these totals next to a random row id.
export const LEADERBOARD_SHOWS = [
  'your rank, with your total tokens, sessions and turns for the week and',
  'the month, next to a random row id (not your anonymous id).',
];

export function registerShare(program) {
  program
    .command('share')
    .description('Opt in or out of the leaderboard (needs cloud sync)')
    .option('--enable', 'Opt into the leaderboard')
    .option('--disable', 'Opt out of the leaderboard')
    .option('--preview', 'See exactly what is uploaded and what the leaderboard shows')
    .action(withConfigGuard((opts) => {
      if (opts.enable && opts.disable) {
        console.error('\n  Use either --enable or --disable, not both.\n');
        process.exitCode = 1;
        return;
      }

      // QA-0928-39: the opt-in reaches the cloud as profile.sharing_enabled with
      // the next sync; with sync off nothing reaches the leaderboard.
      if (opts.enable) {
        const config = readConfigStrict();
        config.sharing_enabled = true;
        saveConfig(config);
        console.log('\n  Data sharing enabled. You join the leaderboard with your next sync.');
        if (config.sync_enabled !== true) {
          console.log('  Cloud sync is off, so nothing reaches the leaderboard until you turn it');
          console.log('  on with `wtclaude sync --enable`.');
        }
        console.log('  Run `wtclaude share --preview` to see exactly what\'s uploaded and shown.\n');
        return;
      }

      if (opts.disable) {
        const config = readConfigStrict();
        config.sharing_enabled = false;
        saveConfig(config);
        console.log('\n  Data sharing disabled.');
        if (config.sync_enabled === true) {
          console.log('  The leaderboard drops you after your next sync (`wtclaude sync` pushes now).');
        } else if (config.synced_sharing_enabled === true) {
          console.log('  Cloud sync is off, so the cloud keeps your earlier opt-in until sync runs again.');
        }
        console.log('');
        return;
      }

      if (opts.preview) {
        showPreview();
        return;
      }

      // Default: show current status
      const config = readConfigStrict();
      const on = config.sharing_enabled === true;
      console.log(`\n  Data sharing: ${on ? 'Enabled' : 'Disabled'}`);
      console.log('  Run `wtclaude share --preview` to see what data is shared.');
      console.log(on ? '  Run `wtclaude share --disable` to opt out.\n' : '  Run `wtclaude share --enable` to opt in.\n');
    }));
}

// QA-0928-05: the upload list is the sync manifest itself. A preview never
// writes (QA-0928-07): it shows the id only if one already exists.
function showPreview() {
  const config = readConfigStrict();
  const id = config.anonymous_id ? shortId(config.anonymous_id) : '(created on your first sync)';

  console.log('\n  What WTClaude shares (when you opt in)');
  console.log('  =======================================\n');
  console.log('  THE LEADERBOARD SHOWS:');
  for (const line of LEADERBOARD_SHOWS) console.log(`    ${line}`);
  console.log('    Sharing needs cloud sync and takes effect with your next sync.');
  console.log('');
  console.log(`  CLOUD SYNC UPLOADS (shared or not), under your anonymous id ${id}:`);
  for (const line of syncPreviewLines()) console.log(line);
  console.log('');
}
