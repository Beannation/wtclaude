import { execSync } from 'node:child_process';
import { getOrCreateAnonymousId } from '../sync/index.js';

export function registerDashboard(program) {
  program
    .command('dashboard')
    .description('Open the web dashboard in your browser')
    .action(() => {
      const anonymousId = getOrCreateAnonymousId();
      const baseUrl = 'https://dashboard.wtclaude.com'; // canonical dashboard host (QA-0610-02)

      const url = `${baseUrl}/settings?link=${anonymousId}`;

      console.log(`\n  Opening dashboard...`);
      console.log(`  Your anonymous ID: ${anonymousId}`);
      console.log(`  URL: ${url}\n`);

      try {
        // macOS
        execSync(`open "${url}"`, { stdio: 'ignore' });
      } catch {
        try {
          // Linux
          execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
        } catch {
          console.log('  Could not open browser automatically.');
          console.log(`  Open this URL manually: ${url}\n`);
        }
      }
    });
}
