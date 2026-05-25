import { getConfig, saveConfig, getOrCreateAnonymousId } from '../sync/index.js';

export function registerShare(program) {
  program
    .command('share')
    .description('Manage data sharing for leaderboard and benchmarks')
    .option('--enable', 'Opt into anonymous data sharing')
    .option('--disable', 'Opt out of data sharing')
    .option('--preview', 'See exactly what data would be shared')
    .action((opts) => {
      if (opts.enable) {
        const config = getConfig();
        config.sharing_enabled = true;
        saveConfig(config);
        console.log('\n  Data sharing enabled. Your anonymous usage data will contribute');
        console.log('  to the leaderboard and community benchmarks.');
        console.log('  Run `wtclaude share --preview` to see exactly what\'s shared.\n');
        return;
      }

      if (opts.disable) {
        const config = getConfig();
        config.sharing_enabled = false;
        saveConfig(config);
        console.log('\n  Data sharing disabled.\n');
        return;
      }

      if (opts.preview) {
        showPreview();
        return;
      }

      // Default: show current status
      const config = getConfig();
      console.log(`\n  Data sharing: ${config.sharing_enabled ? 'Enabled' : 'Disabled'}`);
      console.log('  Run `wtclaude share --preview` to see what data is shared.');
      console.log('  Run `wtclaude share --enable` to opt in.\n');
    });
}

function showPreview() {
  const anonymousId = getOrCreateAnonymousId();

  console.log('\n  What WTClaude shares (when you opt in)');
  console.log('  =======================================\n');
  console.log('  SHARED:');
  console.log(`    - Anonymous ID: ${anonymousId.slice(0, 8)}...`);
  console.log('    - Token counts (input, output, cache read, cache write)');
  console.log('    - Model used (e.g., "sonnet-4-6")');
  console.log('    - Timestamps (when each turn happened)');
  console.log('    - Usage percentage');
  console.log('');
  console.log('  NEVER SHARED:');
  console.log('    - Your prompts or responses');
  console.log('    - Your code or file contents');
  console.log('    - File names or project paths');
  console.log('    - Your IP address or location');
  console.log('    - Your email or identity');
  console.log('');
}
