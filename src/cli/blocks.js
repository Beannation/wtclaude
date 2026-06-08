import { listSessions, readSession } from '../utils/sessions.js';
import { computeTurnCost, formatCost, formatTokens } from '../utils/cost.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude blocks` — the rolling 5-HOUR-BLOCK view (A1 parity vs ccusage).
// Subscription limits reset on a 5-hour window; this buckets every turn into
// fixed 5h blocks (aligned to the UTC clock) so users can pace against the
// window. Billing-grade: each block's cost sums the per-turn `cost_usd` anchor.

const BLOCK_MS = 5 * 60 * 60 * 1000;

function allTurns() {
  const turns = [];
  for (const id of listSessions()) {
    for (const t of readSession(id)) turns.push(t);
  }
  return turns;
}

function blockStart(tsMs) { return Math.floor(tsMs / BLOCK_MS) * BLOCK_MS; }

function buildBlocks() {
  const byBlock = new Map();
  for (const t of allTurns()) {
    const ms = Date.parse(t.ts);
    if (Number.isNaN(ms)) continue;
    const key = blockStart(ms);
    if (!byBlock.has(key)) byBlock.set(key, { start: key, cost: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, sessions: new Set() });
    const b = byBlock.get(key);
    b.cost += computeTurnCost(t);
    b.input += t.input_tokens || 0;
    b.output += t.output_tokens || 0;
    b.cacheRead += t.cache_read_tokens || 0;
    b.cacheWrite += t.cache_write_tokens || 0;
    b.turns += 1;
    if (t.session_id) b.sessions.add(t.session_id);
  }
  return [...byBlock.values()].sort((a, b) => b.start - a.start); // newest first
}

function fmtBlockRange(startMs) {
  const start = new Date(startMs);
  const end = new Date(startMs + BLOCK_MS);
  const d = start.toISOString().slice(0, 10);
  const hh = (x) => x.toISOString().slice(11, 16);
  return `${d} ${hh(start)}–${hh(end)} UTC`;
}

export function registerBlocks(program) {
  program
    .command('blocks')
    .description('Show usage grouped into rolling 5-hour blocks (supports --json, --limit)')
    .option('--json', 'Output machine-readable JSON')
    .option('--limit <n>', 'Max number of blocks to show', '10')
    .action((opts) => {
      const o = opts || {};
      const blocks = buildBlocks();
      const nowBlock = blockStart(Date.now());
      const limit = Math.max(1, parseInt(o.limit, 10) || 10);

      if (o.json) {
        console.log(JSON.stringify({
          schema_version: SCHEMA_VERSION,
          blocks: blocks.slice(0, limit).map(b => ({
            block_start: new Date(b.start).toISOString(),
            block_end: new Date(b.start + BLOCK_MS).toISOString(),
            active: b.start === nowBlock,
            turns: b.turns,
            sessions: b.sessions.size,
            cost_usd: round(b.cost),
            tokens: { input: b.input, output: b.output, cache_read: b.cacheRead, cache_write: b.cacheWrite },
          })),
        }, null, 2));
        return;
      }

      if (blocks.length === 0) { console.log('\n  No usage data yet.\n'); return; }
      console.log('\n  5-hour blocks (newest first)');
      console.log('  ============================');
      console.log(`  ${'Block'.padEnd(26)} ${'Turns'.padStart(5)} ${'Cost'.padStart(10)} ${'Tokens'.padStart(8)}`);
      for (const b of blocks.slice(0, limit)) {
        const mark = b.start === nowBlock ? ' ◀ active' : '';
        const tokens = b.input + b.output + b.cacheRead + b.cacheWrite;
        console.log(`  ${fmtBlockRange(b.start).padEnd(26)} ${String(b.turns).padStart(5)} ${formatCost(b.cost).padStart(10)} ${formatTokens(tokens).padStart(8)}${mark}`);
      }
      console.log('');
    });
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }
