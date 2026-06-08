import { listSessions, readSession } from '../utils/sessions.js';

// `wtclaude statusline` — render the short status string on demand (A1 parity).
// Mirrors what the collector prints back into Claude Code's status line, but
// reads the most-recent captured turn so users can preview/verify it. Nearly
// free since the data is already collected.

function latestTurn() {
  let latest = null;
  for (const id of listSessions()) {
    const turns = readSession(id);
    const t = turns[turns.length - 1];
    if (t && (!latest || t.ts > latest.ts)) latest = t;
  }
  return latest;
}

function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}

export function registerStatusline(program) {
  program
    .command('statusline')
    .description('Render the wtclaude status line from your latest turn (preview of the collector output)')
    .action(() => {
      const t = latestTurn();
      if (!t) { console.log('wtclaude · $— · no data'); return; }
      const cost = typeof t.cumulative_cost_usd === 'number' ? `$${t.cumulative_cost_usd.toFixed(2)}` : '$—';
      const tokens = (t.cumulative_input || 0) + (t.cumulative_output || 0) + (t.cumulative_cache_read || 0) + (t.cumulative_cache_write || 0);
      console.log(`wtclaude · ${cost} · ${fmtTokens(tokens)} tok`);
    });
}
