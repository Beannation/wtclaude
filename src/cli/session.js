import { listSessions, readSession, summarizeTurns, getUnreadableLines, unreadableNote } from '../utils/sessions.js';
import { formatTokens, turnCostBasis } from '../utils/cost.js';
import {
  costBasisJson, basisTag, usdTag, basisBadgeText, tableAmount, excludedLines, mergeExcluded, BASIS_CSV_COLUMNS, basisCsvFields,
} from '../utils/format.js';
import { resolveDimension } from '../utils/group.js';
import { resolveCurrency, formatMoney, currencyNote } from '../utils/currency.js';
import { renderGroupedTurns, output, matchId, reportAmbiguous } from './_summary.js';
import { toCSV } from '../utils/export.js';
import { coldStartMessage } from '../utils/firstrun.js';
import { SCHEMA_VERSION } from '../utils/schema.js';
import { localTime, localDateOf, localDateRange } from '../utils/time.js';

// `wtclaude session` — explicit per-session view (A1 parity vs ccusage/CCUM).
//   wtclaude session            → list every session, newest first, one line each
//   wtclaude session <id|prefix> → per-turn detail for one session
// Supports --json, --csv, --currency and --clipboard on both (QA-0928-65).

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
      cost_basis_summary: s,
      tokens: s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens,
      models: Object.keys(s.models),
      git_branch: turns[turns.length - 1].git_branch ?? null,
    });
  }
  rows.sort((a, b) => (a.last_ts < b.last_ts ? 1 : -1)); // newest first
  return rows;
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }

// Terminal width for the list (QA-0928-163): the TTY's columns, else $COLUMNS,
// else 80 (a pipe).
function termColumns() {
  return process.stdout.columns || Number(process.env.COLUMNS) || 80;
}

function truncate(s, w) { return s.length > w ? `${s.slice(0, w - 1)}…` : s; }

function printGrouped(opts) {
  const dim = resolveDimension(opts.groupBy);
  if (!dim) {
    console.error(`\n  --group-by must be one of: project, branch, cost_center, task, device (got "${opts.groupBy}")\n`);
    process.exitCode = 1;
    return;
  }
  const turns = listSessions().flatMap(id => readSession(id));
  renderGroupedTurns('Sessions', turns, dim, resolveCurrency(opts), opts);
}

function printList(opts) {
  if (opts.groupBy) { printGrouped(opts); return; }
  const rows = sessionRows();
  if (opts.json) {
    const sessions = rows.map(({ cost_basis_summary, ...r }) => r);
    console.log(JSON.stringify({ schema_version: SCHEMA_VERSION, sessions, skipped_lines: getUnreadableLines().lines }, null, 2));
    return;
  }
  if (opts.csv) {
    // Full branch names and UTC ISO timestamps, like --json.
    output(toCSV(rows.map(r => ({ ...r, ...basisCsvFields(r.cost_basis_summary) })), [
      { key: 'session_id' }, { key: 'first_ts' }, { key: 'last_ts' }, { key: 'turns' }, { key: 'cost_usd' },
      { key: 'tokens' }, { key: 'git_branch' }, ...BASIS_CSV_COLUMNS,
    ]), opts);
    return;
  }
  if (rows.length === 0) { output(coldStartMessage('your sessions'), opts); return; }
  const cur = resolveCurrency(opts);

  // Dates are LOCAL calendar dates, first–last (QA-0928-58/160) — the basis
  // today/week/month use — so a 23:30 EDT session is not listed a day late.
  // In a converted list the tag names the USD figure (QA-0928-157).
  const cells = rows.map(r => {
    const b = basisTag(r.cost_basis_summary, cur);
    return {
      date: localDateRange(r.first_ts, r.last_ts),
      id: r.session_id.slice(0, 8),
      turns: String(r.turns),
      cost: tableAmount(r.cost_usd, r.cost_basis_summary, cur),
      tag: b.tag,
      tokens: formatTokens(r.tokens),
      branch: r.git_branch || '—',
    };
  });
  const dw = Math.max(10, ...cells.map(c => c.date.length));
  const cw = Math.max(10, ...cells.map(c => c.cost.length));
  const tw = Math.max(13, ...cells.map(c => c.tag.length));
  // Fit the terminal (QA-0928-163): the branch takes what is left — 12 or more
  // on a normal list, less only when wide dates or converted amounts would
  // otherwise push the row past the edge; the full name stays in --json/--csv.
  const fixed = 2 + dw + 1 + 8 + 1 + 5 + 1 + cw + 1 + tw + 1 + 7 + 2;
  const bw = Math.max(6, termColumns() - fixed);
  const lines = ['\n  Sessions (newest first)', '  ======================='];
  lines.push(`  ${'Date'.padEnd(dw)} ${'Session'.padEnd(8)} ${'Turns'.padStart(5)} ${'Cost'.padStart(cw)} ${'Basis'.padEnd(tw)} ${'Tokens'.padStart(7)}  Branch`);
  for (const c of cells) {
    lines.push(`  ${c.date.padEnd(dw)} ${c.id.padEnd(8)} ${c.turns.padStart(5)} ${c.cost.padStart(cw)} ${c.tag.padEnd(tw)} ${c.tokens.padStart(7)}  ${truncate(c.branch, bw)}`);
  }
  // Name any turns the Cost column leaves out (QA-0928-54), across all sessions.
  lines.push(...excludedLines(mergeExcluded(rows.map(r => r.cost_basis_summary))));
  const cn = currencyNote(cur); if (cn) lines.push(cn);
  const note = unreadableNote(); if (note) lines.push(note); // QA-0928-14
  lines.push('');
  output(lines.join('\n'), opts);
}

function printDetail(idArg, opts) {
  // Exact id, else a unique prefix — an ambiguous prefix is an error that lists
  // the matches, never silently the first one (QA-0928-63).
  const m = matchId(idArg, listSessions());
  if (m.error === 'ambiguous') { reportAmbiguous('session', idArg, m.matches, opts); return; }
  if (!m.id) { console.error(`\n  No session matching "${idArg}".\n`); process.exitCode = 1; return; }
  const full = m.id;
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
      turns: turns.map(t => {
        const c = turnCostBasis(t);
        return {
          turn: t.turn, ts: t.ts, model: t.model,
          cost_usd: c.basis === 'excluded' ? null : round(c.usd),
          cost_basis: c.basis, // 'billing-grade' | 'estimated' | 'excluded' (QA-0928-54)
          input: t.input_tokens, output: t.output_tokens,
          speed_tier: t.speed_tier, speed_tier_source: t.speed_tier_source,
          lines_added: t.lines_added ?? null, lines_removed: t.lines_removed ?? null,
          api_duration_ms: t.api_duration_ms ?? null,
        };
      }),
      skipped_lines: getUnreadableLines().lines,
    }, null, 2));
    return;
  }

  if (opts.csv) {
    output(toCSV(turns.map(t => {
      const c = turnCostBasis(t);
      return {
        turn: t.turn, ts: t.ts, model: t.model,
        cost_usd: c.basis === 'excluded' ? null : round(c.usd), cost_basis: c.basis,
        input_tokens: t.input_tokens || 0, output_tokens: t.output_tokens || 0,
        cache_read_tokens: t.cache_read_tokens || 0, cache_write_tokens: t.cache_write_tokens || 0,
        speed_tier: t.speed_tier ?? null,
      };
    }), [
      { key: 'turn' }, { key: 'ts' }, { key: 'model' }, { key: 'cost_usd' }, { key: 'cost_basis' },
      { key: 'input_tokens' }, { key: 'output_tokens' }, { key: 'cache_read_tokens' }, { key: 'cache_write_tokens' }, { key: 'speed_tier' },
    ]), opts);
    return;
  }

  const cur = resolveCurrency(opts);
  const money = (usd) => formatMoney(usd, cur);
  // Header carries the per-session basis badge + "~" on an estimated total, so a
  // session whose turns have no cost_usd anchor never reads as an exact bill.
  // A converted amount is badged as converted from the USD figure (QA-0928-157).
  const priced = basisTag(s).priced;
  const headBadge = priced ? basisBadgeText(s.cost, s, cur) : 'not priced';
  const headCost = priced ? tableAmount(s.cost, s, cur) : '—';
  const span = turns.length ? localDateRange(turns[0].ts, turns[turns.length - 1].ts) : '';
  const lines = [];
  lines.push(`\n  Session ${full.slice(0, 8)} · ${span} · ${s.turn_count} turns · ${headCost}${headBadge ? `  (${headBadge})` : ''}`);
  lines.push('  ' + '='.repeat(40));
  const tw = usdTag('billing-grade', cur).length; // 13, or 17 for "billing-grade USD"
  lines.push(`  ${'Turn'.padStart(4)} ${'Time'.padEnd(9)} ${'Cost'.padStart(10)} ${'Basis'.padEnd(tw)} ${'In'.padStart(7)} ${'Out'.padStart(7)}  Speed`);
  // Multi-day sessions get a local-date sub-header wherever the date changes, so
  // HH:MM never appears to run backwards (QA-0928-160).
  const multiDay = span.includes('–');
  let day = null;
  for (const t of turns) {
    if (multiDay && localDateOf(t.ts) !== day) {
      day = localDateOf(t.ts);
      lines.push(`  ── ${day} ──`);
    }
    const speed = t.speed_tier === 'fast' ? `fast (${t.speed_tier_source || 'inferred'})` : 'standard';
    const c = turnCostBasis(t);
    // A converted turn's tag names the USD figure it came from (QA-0928-157).
    const basis = c.basis === 'excluded' ? 'not priced' : usdTag(c.basis, cur);
    const cost = c.basis === 'excluded' ? '—' : `${c.basis === 'estimated' && cur.isUsd ? '~' : ''}${money(c.usd)}`;
    lines.push(
      `  ${String(t.turn).padStart(4)} ${localTime(t.ts).padEnd(9)} ${cost.padStart(10)} ${basis.padEnd(tw)} ` +
      `${formatTokens(t.input_tokens || 0).padStart(7)} ${formatTokens(t.output_tokens || 0).padStart(7)}  ${speed}`
    );
  }
  lines.push(...excludedLines(s));
  const cn = currencyNote(cur); if (cn) lines.push(cn);
  const note = unreadableNote(); if (note) lines.push(note); // QA-0928-14
  lines.push('');
  output(lines.join('\n'), opts);
}

export function registerSession(program) {
  program
    .command('session [id]')
    .description('List sessions, or show per-turn detail for one (supports --json, --csv, --group-by)')
    .option('--json', 'Output machine-readable JSON')
    .option('--group-by <dimension>', 'In list mode, group by project | branch | cost_center | task | device')
    .option('--currency <ISO>', 'Display amounts in another currency (display-only)')
    .option('--csv', 'Output CSV')
    .option('--clipboard', 'Copy the output to the clipboard as well')
    .action((id, opts) => {
      if (id) printDetail(id, opts || {});
      else printList(opts || {});
    });
}
