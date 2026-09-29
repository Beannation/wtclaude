import { listSessions, readSession, summarizeTurns } from '../utils/sessions.js';
import { formatTokens } from '../utils/cost.js';
import { costBasisJson, basisTag, tableAmount, basisBadgeText, excludedLines, mergeExcluded, tokensAll, TOKENS_ALL_LABEL } from '../utils/format.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude blocks` — usage in FIXED 5-hour UTC buckets (A1 parity vs ccusage).
// Buckets are aligned to the Unix epoch (so the grid moves 4 hours a day, since
// 24 is not a multiple of 5) and are the same for everyone. They are NOT the
// rate-limit window: that window starts with your first message after the last
// one expired, so its real resets fall at arbitrary times (e.g. 15:10Z) —
// QA-0928-62. Relabelled only; re-bucketing by rate_limit_5h_resets_at is a
// product decision. Each block's cost sums the per-turn anchor where present,
// labelled when any of it is estimated (QA-0928-55).

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
    if (!byBlock.has(key)) byBlock.set(key, { start: key, turns: [], sessions: new Set() });
    const b = byBlock.get(key);
    b.turns.push(t);
    if (t.session_id) b.sessions.add(t.session_id);
  }
  // Each block is summarized by the same engine as today/week/month, so its cost
  // carries the same billing-grade / estimated split and exclusions (QA-0928-55).
  return [...byBlock.values()]
    .map(b => ({ start: b.start, sessions: b.sessions, turns: b.turns, summary: summarizeTurns(b.turns) }))
    .sort((a, b) => b.start - a.start); // newest first
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
    .description('Show usage in fixed 5-hour UTC blocks — not your limit window (supports --json, --limit)')
    .option('--json', 'Output machine-readable JSON')
    .option('--limit <n>', 'Max number of blocks to show', '10')
    .action((opts) => {
      const o = opts || {};
      // A whole number of 1 or more (QA-0928-159): 0 used to show 10 blocks.
      const limit = Number(o.limit);
      if (!Number.isInteger(limit) || limit < 1) {
        console.error(`\n  --limit must be a whole number of 1 or more (got "${o.limit}")\n`);
        process.exitCode = 1;
        return;
      }
      const blocks = buildBlocks();
      const nowBlock = blockStart(Date.now());

      if (o.json) {
        console.log(JSON.stringify({
          schema_version: SCHEMA_VERSION,
          note: 'fixed 5-hour UTC buckets (epoch-aligned) — not your rate-limit window',
          blocks: blocks.slice(0, limit).map(b => ({
            block_start: new Date(b.start).toISOString(),
            block_end: new Date(b.start + BLOCK_MS).toISOString(),
            active: b.start === nowBlock,
            turns: b.summary.turn_count,
            sessions: b.sessions.size,
            cost_usd: round(b.summary.cost),
            cost_basis: costBasisJson(b.summary), // QA-0928-55
            tokens: { input: b.summary.input_tokens, output: b.summary.output_tokens, cache_read: b.summary.cache_read_tokens, cache_write: b.summary.cache_write_tokens },
          })),
        }, null, 2));
        return;
      }

      if (blocks.length === 0) { console.log('\n  No usage data yet.\n'); return; }
      console.log('\n  5-hour blocks (newest first)');
      console.log('  ============================');
      console.log('  Fixed 5-hour UTC buckets on a set grid — not your limit window.');
      console.log(`  ${'Block'.padEnd(26)} ${'Turns'.padStart(5)} ${'Cost'.padStart(10)} ${'Tokens'.padStart(8)}  Basis`);
      const shown = blocks.slice(0, limit);
      for (const b of shown) {
        const s = b.summary;
        const mark = b.start === nowBlock ? ' ◀ active' : '';
        const tokens = tokensAll(s);
        console.log(`  ${fmtBlockRange(b.start).padEnd(26)} ${String(s.turn_count).padStart(5)} ${tableAmount(s.cost, s).padStart(10)} ${formatTokens(tokens).padStart(8)}  ${basisTag(s).tag}${mark}`);
      }
      // When any shown block is estimated in part, spell out the split for the
      // blocks shown, as today/week/month do (QA-0928-55).
      if (shown.some(b => basisTag(b.summary).tilde)) {
        const all = summarizeTurns(shown.flatMap(b => b.turns));
        console.log(`  Shown: ${tableAmount(all.cost, all)} across ${shown.length} block${shown.length === 1 ? '' : 's'}  (${basisBadgeText(all.cost, all)})`);
      }
      for (const l of excludedLines(mergeExcluded(shown.map(b => b.summary)))) console.log(l);
      console.log(`  Tokens = ${TOKENS_ALL_LABEL}.`); // QA-0928-174
      console.log('');
    });
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }
