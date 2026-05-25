import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { CONFIG_FILE } from '../utils/paths.js';

export function registerInvite(program) {
  program
    .command('invite')
    .description('Generate a shareable invite link')
    .action(() => {
      let config = {};
      if (existsSync(CONFIG_FILE)) {
        try { config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch {}
      }

      if (!config.invite_code) {
        config.invite_code = randomBytes(6).toString('hex');
        writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
      }

      const baseUrl = config.landing_url || 'https://wtclaude.com';
      const url = `${baseUrl}?ref=${config.invite_code}`;

      console.log('\n  Share this link with colleagues:');
      console.log(`\n  ${url}\n`);
      console.log('  They\'ll see the JSONL accuracy bug explained and how to install WTClaude.');
      console.log('  You\'ll earn the "Recruiter" badge when someone installs via your link.\n');
    });
}
