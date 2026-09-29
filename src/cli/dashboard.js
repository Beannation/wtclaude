import { execFileSync } from 'node:child_process';
import { readConfigStrict, assertAnonymousId, withConfigGuard } from '../sync/index.js';

const DASHBOARD_URL = 'https://dashboard.wtclaude.com'; // canonical dashboard host (QA-0610-02)

// Contract D (QA-0928-09): the id rides in the URL FRAGMENT, which browsers never
// send to a server, so it can't land in hosting request logs. The dashboard reads
// #link= (and the legacy ?link=), then strips it from the address bar.
export function dashboardLinkUrl(anonymousId) {
  return `${DASHBOARD_URL}/settings#link=${anonymousId}`;
}

export function registerDashboard(program) {
  program
    .command('dashboard')
    .description('Open the web dashboard in your browser')
    .action(withConfigGuard(() => {
      // Never mints an id (QA-0928-08): an id nothing was synced under would
      // link the browser to an empty dashboard.
      const config = readConfigStrict();
      if (!config.anonymous_id) {
        console.log('\n  Nothing to link yet: this install has no anonymous id.');
        console.log('  Run `wtclaude setup`, then `wtclaude sync --enable` to fill the dashboard.\n');
        return;
      }
      // QA-0928-143: the id comes from a file, so check its shape before it goes
      // into a URL.
      assertAnonymousId(config);
      const url = dashboardLinkUrl(config.anonymous_id);

      console.log('\n  Opening the dashboard (this links your browser to your synced data)...\n');
      if (openInBrowser(url)) return;
      console.log('  Could not open a browser. Open this link yourself. It contains your');
      console.log('  private id, so don\'t share it or paste it anywhere public:');
      console.log(`\n  ${url}\n`);
    }));
}

// QA-0928-143: execFile passes the URL as one argument; no shell ever parses it.
function openInBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? null : 'xdg-open';
  if (!opener) return false;
  try {
    execFileSync(opener, [url], { stdio: 'ignore', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}
