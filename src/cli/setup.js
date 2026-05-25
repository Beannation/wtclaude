import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { ensureDataDirs } from '../utils/paths.js';

export function registerSetup(program) {
  program
    .command('setup')
    .description('Configure Claude Code to use the WTClaude collector')
    .action(() => {
      console.log('\n  WTClaude Setup');
      console.log('  ==============\n');

      // Step 1: Create data directories
      ensureDataDirs();
      console.log('  [1/3] Created ~/.wtclaude/ data directories');

      // Step 2: Find the collector path
      let collectorPath;
      try {
        collectorPath = execSync('which wtclaude-collector', { encoding: 'utf8' }).trim();
      } catch {
        // Not globally installed — use npx path
        collectorPath = 'wtclaude-collector';
      }

      // Step 3: Update Claude Code settings
      const settingsPath = join(homedir(), '.claude', 'settings.json');
      let settings = {};

      if (existsSync(settingsPath)) {
        try {
          settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
        } catch {
          settings = {};
        }
      }

      const existingCommand = settings.statusLine?.command;
      if (existingCommand && existingCommand.includes('wtclaude')) {
        console.log('  [2/3] Claude Code settings already configured');
      } else if (existingCommand) {
        console.log(`  [2/3] WARNING: You already have a statusline command configured:`);
        console.log(`         "${existingCommand}"`);
        console.log(`         To use WTClaude, update ~/.claude/settings.json manually:`);
        console.log(`         "statusLine": { "command": "${collectorPath}" }`);
      } else {
        settings.statusLine = { command: collectorPath };
        writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
        console.log('  [2/3] Added statusline command to Claude Code settings');
      }

      // Step 4: Verify
      console.log('  [3/3] Setup complete!');
      console.log('');
      console.log('  Next steps:');
      console.log('  1. Start a new Claude Code session');
      console.log('  2. Use Claude Code normally');
      console.log('  3. Run: wtclaude today');
      console.log('');
      console.log('  After your first session, run: wtclaude compare');
      console.log('  to see how wrong your old tracking tools were.\n');
    });
}
