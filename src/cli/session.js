import { listSessions, readSession, summarizeTurns } from '../utils/sessions.js';
import { formatCost, formatTokens, computeTurnCost } from '../utils/cost.js';
import { costBasisBadge, turnBasis } from '../utils/format.js';
import { resolveDimension } from '../utils/group.js';
import { resolveCurrency } from '../utils/currency.js';
import { renderGroupedTurns } from './_summary.js';
import { coldStartMessage } from '../utils/firstrun.js';
import { SCHEMA_VERSION } from '../utils/schema.js';
import { localTime } from '../utils/time.js';

// The cost_basis block mirrors today/week/month --json (jsonSummary) so a script
// reads the same honesty shape everywhere. Built from summarizeTurns' tallies.
function costBasisJson(s) {
  return {
    anchored_usd: round(s.anchored_cost),
    estimated_usd: round(s.estimated_cost),
    anchored_turns: s.anchored_turns,
    estimated_turns: s.estimated_turns,
  };
}

// `wtclaude session` — explicit per-session view (A1 parity vs ccusage/CCUM).
//   wtclaude session            → list every session, newest first, one line each
//   wtclaude session <id|prefix> → per-turn detail for one session
// Supports --json on both.

function sessionRows() {
  const rows = [];
  for (const id of listSessions()) {
    const turns = readSession(id);
    if (turns.length === 0) continue;
    const s = summarizeTurns(turns);
    rows.push({
      session_id: id,
      first_ts: turns[0].ts,
      last_ts: turns[turns.length - 1].ts,
      turns: s.turn_count,
      cost_usd: round(s.cost),
      // Honesty (QA-BUG-03): every cost the `session` view shows is labeled with
      // whether it is the billing-grade anchor or a pricing-map estimate.
      cost_basis: costBasisJson(s),
      tokens: s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens,
      models: Object.keys(s.models),
      git_branch: turns[turns.length - 1].git_branch ?? null,
    });
  }
  rows.sort((a, b) => (a.last_ts < b.last_ts ? 1 : -1)); // newest first
  return rows;
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }

function printGrouped(opts) {
  const dim = resolveDimension(opts.groupBy);
  if (!dim) {
    console.error(`\n  --group-by must be one of: project, branch, cost_center, task (got "${opts.groupBy}")\n`);
    process.exitCode = 1;
    return;
  }
  const turns = listSessions().flatMap(id => readSession(id));
  renderGroupedTurns('Sessions', turns, dim, resolveCurrency(opts), opts);
}

// Compact per-session basis tag for the list/header. billing-grade when fully
// anchored, mixed when some turns are estimated, estimated when none are anchored.
function shortBasis(cb) {
  if (cb.anchored_turns > 0 && cb.estimated_turns === 0) return { tag: 'billing-grade', tilde: false };
  if (cb.anchored_turns > 0 && cb.estimated_turns > 0) return { tag: 'mixed', tilde: true };
  if (cb.estimated_turns > 0) return { tag: 'estimated', tilde: true };
  return { tag: '—', tilde: false };
}

function printList(opts) {
  if (opts.groupBy) { printGrouped(opts); return; }
  const rows = sessionRows();
  if (opts.json) { console.log(JSON.stringify({ schema_version: SCHEMA_VERSION, sessions: rows }, null, 2)); return; }
  if (rows.length === 0) { console.log(coldStartMessage('your sessions')); return; }
  console.log('\n  Sessions (newest first)');
  console.log('  =======================');
  console.log(`  ${'Date'.padEnd(12)} ${'Session'.padEnd(10)} ${'Turns'.padStart(5)} ${'Cost'.padStart(10)} ${'Basis'.padEnd(13)} ${'Tokens'.padStart(8)}  Branch`);
  for (const r of rows) {
    const b = shortBasis(r.cost_basis);
    const cost = `${b.tilde ? '~' : ''}${formatCost(r.cost_usd)}`;
    console.log(
      `  ${r.last_ts.slice(0, 10).padEnd(12)} ${r.session_id.slice(0, 8).padEnd(10)} ` +
      `${String(r.turns).padStart(5)} ${cost.padStart(10)} ${b.tag.padEnd(13)} ${formatTokens(r.tokens).padStart(8)}  ${r.git_branch || '—'}`
    );
  }
  console.log('');
}

function printDetail(idArg, opts) {
  const full = listSessions().find(id => id === idArg || id.startsWith(idArg));
  if (!full) { console.error(`\n  No session matching "${idArg}".\n`); process.exitCode = 1; return; }
  const turns = readSession(full);
  const s = summarizeTurns(turns);

  if (opts.json) {
    console.log(JSON.stringify({
      schema_version: SCHEMA_VERSION,
      session_id: full,
      summary: {
        turns: s.turn_count, cost_usd: round(s.cost),
        // Honesty block, identical shape to today/week/month --json (QA-BUG-03).
        cost_basis: costBasisJson(s),
        tokens: { input: s.input_tokens, output: s.output_tokens, cache_read: s.cache_read_tokens, cache_write: s.cache_write_tokens }, models: s.models,
      },
      turns: turns.map(t => ({
        turn: t.turn, ts: t.ts, model: t.model,
        cost_usd: round(computeTurnCost(t)),
        cost_basis: turnBasis(t), // 'billing-grade' | 'estimated'
        input: t.input_tokens, output: t.output_tokens,
        speed_tier: t.speed_tier, speed_tier_source: t.speed_tier_source,
        lines_added: t.lines_added ?? null, lines_removed: t.lines_removed ?? null,
        api_duration_ms: t.api_duration_ms ?? null,
      })),
    }, null, 2));
    return;
  }

  // Header carries the per-session basis badge + "~" on an estimated total, so a
  // session whose turns have no cost_usd anchor never reads as an exact bill.
  const badge = costBasisBadge(s);
  const headCost = `${badge.tilde ? '~' : ''}${formatCost(s.cost)}`;
  const headBadge = badge.label ? `  (${badge.label})` : '';
  console.log(`\n  Session ${full.slice(0, 8)} · ${s.turn_count} turns · ${headCost}${headBadge}`);
  console.log('  ' + '='.repeat(40));
  console.log(`  ${'Turn'.padStart(4)} ${'Time'.padEnd(9)} ${'Cost'.padStart(10)} ${'Basis'.padEnd(13)} ${'In'.padStart(7)} ${'Out'.padStart(7)}  Speed`);
  for (const t of turns) {
    const speed = t.speed_tier === 'fast' ? `fast (${t.speed_tier_source || 'inferred'})` : 'standard';
    const basis = turnBasis(t);
    const est = basis === 'estimated';
    const cost = `${est ? '~' : ''}${formatCost(computeTurnCost(t))}`;
    console.log(
      `  ${String(t.turn).padStart(4)} ${localTime(t.ts).padEnd(9)} ${cost.padStart(10)} ${basis.padEnd(13)} ` +
      `${formatTokens(t.input_tokens).padStart(7)} ${formatTokens(t.output_tokens).padStart(7)}  ${speed}`
    );
  }
  console.log('');
}

export function registerSession(program) {
  program
    .command('session [id]')
    .description('List sessions, or show per-turn detail for one (supports --json, --group-by)')
    .option('--json', 'Output machine-readable JSON')
    .option('--group-by <dimension>', 'In list mode, group by project | branch | cost_center | task')
    .option('--currency <ISO>', 'Display amounts in another currency (display-only)')
    .option('--csv', 'Output CSV (list/group mode)')
    .option('--clipboard', 'Copy the output to the clipboard as well')
    .action((id, opts) => {
      if (id) printDetail(id, opts || {});
      else printList(opts || {});
    });
}
