import { randomBytes } from 'node:crypto';
import { readConfigStrict, saveConfig, withConfigGuard } from '../sync/index.js';

export function registerInvite(program) {
  program
    .command('invite')
    .description('Generate a shareable invite link')
    .action(withConfigGuard(() => {
      // QA-0928-07/08: through saveConfig, so an unparsable config.json is never
      // replaced by {invite_code} and a fresh install gets its data dir created.
      const config = readConfigStrict();

      if (!config.invite_code) {
        config.invite_code = randomBytes(6).toString('hex');
        saveConfig(config);
      }

      const baseUrl = config.landing_url || 'https://wtclaude.com';
      const url = `${baseUrl}?ref=${config.invite_code}`;

      // QA-0928-40: no badge or install-attribution promise — nothing reads ?ref=
      // and no such badge exists.
      console.log('\n  Share this link with colleagues:');
      console.log(`\n  ${url}\n`);
    }));
}
