import { getLatestRateLimitTurn } from '../utils/sessions.js';

// `wtclaude limit` — the CLI limit gauge / burn-countdown.
//
// Billing-grade and payload-sourced: reads the `rate_limits` snapshot the
// statusline payload carries (captured per turn by the collector, BUILD-023),
// so CLI users get their limit % + reset countdown with NO OAuth /usage call.
//
// Honesty / framing (per GTM-005): this is the user's SINGLE shared subscription
// usage limit — the one bucket Claude meters. We do NOT claim a "unified
// cross-surface view" (any OAuth-reading tool can read the same shared bucket).
// The OAuth path stays the documented fallback for surfaces the statusline
// can't reach (desktop/Cowork — see R-12); it is not replaced here, only
// preferred for CLI users where the payload already carries the data.

function bar(pct, width = 20) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round((p / 100) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

// resets_at is a Unix epoch in SECONDS. Render a human countdown from now.
function countdown(resetsAtSec) {
  if (resetsAtSec == null) return 'reset time unknown';
  const ms = resetsAtSec * 1000 - Date.now();
  if (ms <= 0) return 'resetting now';
  const totalMin = Math.floor(ms / 60000);
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `resets in ${d}d ${h}h`;
  if (h > 0) return `resets in ${h}h ${m}m`;
  return `resets in ${m}m`;
}

function pctStr(pct) {
  if (pct == null) return '  —';
  return `${Math.round(Number(pct))}%`.padStart(4);
}

function gaugeLine(label, pct, resetsAt) {
  return `  ${label.padEnd(16)} ${bar(pct)} ${pctStr(pct)}   ${countdown(resetsAt)}`;
}

export function registerLimit(program) {
  program
    .command('limit')
    .description('Show your shared plan usage limit + reset countdown (billing-grade, from the statusline payload)')
    .action(() => {
      const turn = getLatestRateLimitTurn();

      if (!turn) {
        console.log('\n  No limit data captured yet.');
        console.log('  The limit gauge reads the `rate_limits` snapshot from the statusline');
        console.log('  payload — run a Claude Code session with wtclaude-collector configured.');
        console.log('  (Older Claude Code versions predate this field; the OAuth /usage view is');
        console.log('  the fallback for those and for desktop/Cowork surfaces.)\n');
        return;
      }

      const when = turn.ts ? ` · as of your last turn (${turn.ts.slice(0, 16).replace('T', ' ')})` : '';
      console.log('\n  Shared overall plan limit');
      console.log('  =========================');
      console.log(`  Billing-grade · read from the statusline payload, no OAuth needed${when}.`);
      console.log('');
      console.log(gaugeLine('5-hour window', turn.rate_limit_5h_pct, turn.rate_limit_5h_resets_at));
      console.log(gaugeLine('7-day window', turn.rate_limit_7d_pct, turn.rate_limit_7d_resets_at));
      console.log('');
      console.log('  This is your shared overall plan limit — the single subscription bucket');
      console.log('  Claude meters. (Not a cross-surface view.)');
      console.log('');
    });
}
