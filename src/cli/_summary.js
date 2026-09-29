// Shared plumbing for the summary commands (today/week/month + arbitrary
// --since/--until ranges) and their --json output. A1 CLI-parity floor (v1.7):
// --json on today/week/month/session/blocks, and --since/--until date ranges.
//
// v1.8/v1.9 adds (fast-follow): --group-by (project|branch|cost_center|task),
// --currency (display-only FX), and --csv/--clipboard (a formatter over --json).

import { getSessionsForDateRange, summarizeSessions, summarizeTurns, getUnreadableLines, unreadableNote } from '../utils/sessions.js';
import {
  formatUsageSummary, costBasisBadge, costBasisJson, basisBadgeText, basisTag, tableAmount, moneyWithBasis,
  excludedLines, BASIS_CSV_COLUMNS, basisCsvFields,
} from '../utils/format.js';
import { resolveCurrency, formatMoney, currencyNote } from '../utils/currency.js';
import { resolveDimension, groupTurns, displayKey, coverage } from '../utils/group.js';
import { loadConfig } from '../utils/config.js';
import { toCSV, copyToClipboard } from '../utils/export.js';
import { coldStartMessage, hasAnyData } from '../utils/firstrun.js';
import { localDate, localDaysAgo, isRealDate, addDays } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Attach the parity flags shared by the summary commands. `groupBy: false` for a
// command that fixes its own grouping (`tasks`), so it never advertises a flag it
// would ignore (QA-0928-65) — commander then rejects it with a message.
export function addRangeOpts(cmd, { groupBy = true } = {}) {
  cmd
    .option('--json', 'Output machine-readable JSON instead of the formatted summary')
    .option('--since <date>', 'Start date (YYYY-MM-DD) — overrides the default range')
    .option('--until <date>', 'End date (YYYY-MM-DD) — ends the default-length range on that day');
  if (groupBy) cmd.option('--group-by <dimension>', 'Break the range down by project | branch | cost_center | task | device');
  return cmd
    .option('--currency <ISO>', 'Display amounts in another currency (display-only; USD stays billing-grade)')
    .option('--csv', 'Output CSV (a formatter over --json)')
    .option('--clipboard', 'Copy the output to the clipboard as well');
}

function today() { return localDate(); } // local calendar date (QA-BUG-10)

// Resolve the effective [start,end] from the command default and any
// --since/--until override. Returns { startStr, endStr } or throws on bad input.
// `span` is the command's own window in days (today 1, week 7, month/tasks 30;
// null for the all-time views): --until alone ends that window on that day
// (QA-0928-56) instead of keeping a start anchored on today. Dates must be real
// calendar dates (QA-0928-159). Swapped bounds are tolerated only when both are
// given. `today` is injectable for tests.
export function resolveRange(defaultStart, defaultEnd, opts = {}, { span = null, today: t = today() } = {}) {
  const o = opts || {};
  for (const [k, v] of [['--since', o.since], ['--until', o.until]]) {
    if (v == null) continue;
    if (!DATE_RE.test(v)) throw new Error(`${k} must be YYYY-MM-DD (got "${v}")`);
    if (!isRealDate(v)) throw new Error(`${k} must be a real date (got "${v}")`);
  }
  let startStr, endStr;
  if (o.since && o.until) {
    [startStr, endStr] = o.since <= o.until ? [o.since, o.until] : [o.until, o.since]; // tolerate swapped dates
  } else if (o.since) {
    if (o.since > t) throw new Error(`--since ${o.since} is after today (${t})`);
    [startStr, endStr] = [o.since, t];
  } else if (o.until) {
    [startStr, endStr] = [span ? addDays(o.until, -(span - 1)) : defaultStart, o.until];
  } else {
    [startStr, endStr] = [defaultStart, defaultEnd];
  }
  return { startStr, endStr };
}

// The machine-readable shape for --json. Stable key set so scripts can depend on it.
export function jsonSummary(label, startStr, endStr, summary) {
  return {
    schema_version: SCHEMA_VERSION,
    range: { label, since: startStr, until: endStr },
    cost_usd: round(summary.cost),
    cost_basis: costBasisJson(summary),
    fast_mode: {
      cost_usd: round(summary.fast_cost),
      turns: summary.fast_turns,
      payload_turns: summary.fast_payload_turns || 0,
      inferred_turns: summary.fast_inferred_turns || 0,
    },
    tokens: {
      input: summary.input_tokens,
      output: summary.output_tokens,
      cache_read: summary.cache_read_tokens,
      cache_write: summary.cache_write_tokens,
    },
    sessions: summary.session_count,
    turns: summary.turn_count,
    models: summary.models,
    // Lines the reader had to skip (QA-0928-14): 0 when every line parsed.
    skipped_lines: getUnreadableLines().lines,
  };
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }

// Append the skipped-line note (QA-0928-14) to a text block when a read had to
// skip a line; machine output (--csv) gets it on stderr so the file stays clean.
function withReadNote(text) {
  const n = unreadableNote();
  return n ? `${text.replace(/\n+$/, '')}\n${n}\n` : text;
}
function readNoteToStderr() {
  const n = unreadableNote();
  if (n) console.error(n);
}

// Emit text and, when --clipboard is set, also copy it (with a soft-fail note).
function output(text, opts = {}) {
  console.log(text);
  if (opts.clipboard) {
    const ok = copyToClipboard(text.replace(/^\n+/, ''));
    console.log(ok ? '  (copied to clipboard)\n' : '  (clipboard unavailable on this system)\n');
  }
}

// QA-0928-59: an empty range for someone who already has data is just an empty
// range. The first-run copy ("your first turn will show up here") is only for a
// true cold start — no session files at all.
export function emptyRangeMessage(startStr, endStr, { what = 'usage', coldLabel = null } = {}) {
  if (!hasAnyData()) return coldStartMessage(coldLabel ?? `${startStr} to ${endStr}`);
  return `\n  ${emptyRangeLine(startStr, endStr, what)}\n`;
}
export function emptyRangeLine(startStr, endStr, what = 'usage') {
  return `No ${what} recorded ${startStr === endStr ? `on ${startStr}` : `between ${startStr} and ${endStr}`}.`;
}

// Resolve a session id / project hash the user typed (QA-0928-63): an exact
// match first, then a UNIQUE prefix. Returns { id } or { error: 'none' |
// 'ambiguous', matches } — never silently the first of several matches.
export function matchId(query, ids) {
  if (ids.includes(query)) return { id: query };
  const matches = ids.filter(i => i.startsWith(query));
  if (matches.length === 1) return { id: matches[0] };
  return { error: matches.length ? 'ambiguous' : 'none', matches };
}

// Report an ambiguous id (up to 10 matches) and set exit code 1. With --json the
// error is a JSON object on stdout so scripts can read it.
export function reportAmbiguous(kind, query, matches, opts = {}) {
  process.exitCode = 1;
  if (opts.json) {
    console.log(JSON.stringify({ schema_version: SCHEMA_VERSION, error: 'ambiguous', query, match_count: matches.length, matches: matches.slice(0, 10) }, null, 2));
    return;
  }
  console.error(`\n  "${query}" is ambiguous: ${matches.length} ${kind}s start with it.`);
  for (const m of matches.slice(0, 10)) console.error(`    ${m}`);
  if (matches.length > 10) console.error(`    … and ${matches.length - 10} more`);
  console.error('  Type more characters, or the full id.\n');
}

// One entry point the summary commands share. Handles empty + grouping + --json
// + --csv + --currency + --clipboard + the formatted summary.
export function emitSummary(label, defaultStart, defaultEnd, opts = {}, { span = null } = {}) {
  let startStr, endStr;
  try {
    ({ startStr, endStr } = resolveRange(defaultStart, defaultEnd, opts, { span }));
  } catch (err) {
    console.error(`\n  ${err.message}\n`);
    process.exitCode = 1;
    return;
  }

  const sessions = getSessionsForDateRange(startStr, endStr);
  const rangeLabel = (opts.since || opts.until) ? `${startStr} to ${endStr}` : label;
  const cur = resolveCurrency(opts);

  // --group-by branches off into the grouped renderer.
  if (opts.groupBy) {
    const dim = resolveDimension(opts.groupBy);
    if (!dim) {
      console.error(`\n  --group-by must be one of: project, branch, cost_center, task, device (got "${opts.groupBy}")\n`);
      process.exitCode = 1;
      return;
    }
    emitGrouped(rangeLabel, startStr, endStr, sessions, dim, cur, opts);
    return;
  }

  if (sessions.length === 0) {
    if (opts.json) {
      output(JSON.stringify(jsonSummary(rangeLabel, startStr, endStr, emptySummary()), null, 2), opts);
    } else if (opts.csv) {
      output(toCSV([], summaryCsvColumns()), opts);
      readNoteToStderr();
    } else {
      output(withReadNote(emptyRangeMessage(startStr, endStr, { coldLabel: rangeLabel })), opts);
    }
    return;
  }

  const summary = summarizeSessions(sessions);
  // QA-BUG-04: per-pool split (dual-pool flip active). Only the plain summary
  // path splits; --csv stays combined (the column-stable summary row).
  const pools = opts.byPool ? poolSummaries(sessions) : null;
  if (opts.json) {
    const obj = jsonSummary(rangeLabel, startStr, endStr, summary);
    if (pools) obj.pools = poolsJson(pools);
    output(JSON.stringify(obj, null, 2), opts);
  } else if (opts.csv) {
    output(toCSV([summaryCsvRow(rangeLabel, summary)], summaryCsvColumns()), opts);
    readNoteToStderr();
  } else {
    // With a --since/--until override, the date range IS the heading (avoids the
    // redundant "Today (date) (range)" double-label); otherwise use the label.
    const heading = (opts.since || opts.until) ? `Usage (${startStr} to ${endStr})` : label;
    let text = formatUsageSummary(heading, summary, cur);
    if (pools) text += formatPoolBlock(pools, cur);
    output(withReadNote(text), opts);
  }
}

// ── per-pool split (QA-BUG-04, June-15 dual-pool flip) ───────────────────────

// Classify a turn into the interactive (subscription) or agent_sdk (credits)
// pool — same rule as agentpool.js so every pool view agrees.
function turnPool(t) {
  return (t.usage_pool === 'agent_sdk' || t.billing_basis === 'agent_sdk_credits') ? 'agent_sdk' : 'interactive';
}

function poolSummaries(sessions) {
  const interactive = [], agent_sdk = [];
  for (const t of sessions.flatMap(s => s.turns)) (turnPool(t) === 'agent_sdk' ? agent_sdk : interactive).push(t);
  return { interactive: summarizeTurns(interactive), agent_sdk: summarizeTurns(agent_sdk) };
}

function poolsJson(pools) {
  const one = (s) => ({
    cost_usd: round(s.cost), turns: s.turn_count,
    cost_basis: costBasisJson(s),
  });
  return { interactive: one(pools.interactive), agent_sdk: one(pools.agent_sdk) };
}

function formatPoolBlock(pools, cur) {
  const line = (label, s) => {
    const b = costBasisBadge(s);
    const amt = `${b.tilde && cur.isUsd ? '~' : ''}${formatMoney(s.cost, cur)}`;
    const text = basisBadgeText(s.cost, s, cur);
    const badge = text ? `  (${text})` : '';
    return `  ${label.padEnd(30)} ${amt} · ${s.turn_count} turn${s.turn_count === 1 ? '' : 's'}${badge}`;
  };
  const lines = ['  By usage pool (June-15 split active)', '  ' + '-'.repeat(36)];
  lines.push(line('Interactive (subscription)', pools.interactive));
  lines.push(line('Agent SDK (included credits)', pools.agent_sdk));
  lines.push('');
  return lines.join('\n') + '\n';
}

// ── grouped output (--group-by / project / tasks) ───────────────────────────

function sessionCount(turns) {
  const ids = new Set();
  for (const t of turns) if (t.session_id) ids.add(t.session_id);
  return ids.size;
}

function emitGrouped(rangeLabel, startStr, endStr, sessions, dim, cur, opts) {
  renderGroupedTurns(rangeLabel, sessions.flatMap(s => s.turns), dim, cur, opts, { since: startStr, until: endStr });
}

// Reusable grouped renderer over a flat turn list — shared by --group-by on the
// summary commands and on `session`.
export function renderGroupedTurns(rangeLabel, turns, dim, cur, opts = {}, range = {}) {
  const groups = groupTurns(turns, dim);
  const total = summarizeTurns(turns); // the badge + exclusions for the TOTAL row
  const cfg = dim === 'device' ? loadConfig() : undefined; // device labels (QA-0928-158)
  const label = (key) => displayKey(key, dim, cfg);

  if (opts.json) {
    output(JSON.stringify({
      schema_version: SCHEMA_VERSION,
      range: { label: rangeLabel, since: range.since ?? null, until: range.until ?? null },
      group_by: dim,
      coverage: coverage(turns, dim),
      cost_usd: round(total.cost),
      cost_basis: costBasisJson(total),
      groups: groups.map(g => ({
        key: g.key,
        display: label(g.key),
        cost_usd: round(g.summary.cost),
        cost_basis: costBasisJson(g.summary),
        turns: g.summary.turn_count,
        sessions: sessionCount(turns.filter(t => (t[g.field] ?? null) === g.key)),
        tokens: {
          input: g.summary.input_tokens, output: g.summary.output_tokens,
          cache_read: g.summary.cache_read_tokens, cache_write: g.summary.cache_write_tokens,
        },
      })),
    }, null, 2), opts);
    return;
  }

  const rows = groups.map(g => ({
    group: label(g.key),
    cost_usd: round(g.summary.cost),
    turns: g.summary.turn_count,
    tokens: g.summary.input_tokens + g.summary.output_tokens + g.summary.cache_read_tokens + g.summary.cache_write_tokens,
    ...basisCsvFields(g.summary),
  }));

  if (opts.csv) {
    output(toCSV(rows, [
      { key: 'group', label: dim },
      { key: 'cost_usd', label: 'cost_usd' },
      { key: 'turns', label: 'turns' },
      { key: 'tokens', label: 'tokens' },
      ...BASIS_CSV_COLUMNS,
    ]), opts);
    readNoteToStderr();
    return;
  }

  if (turns.length === 0) {
    output(range.since && range.until ? emptyRangeMessage(range.since, range.until, { coldLabel: rangeLabel }) : `\n  No usage data for ${rangeLabel}.\n`, opts);
    return;
  }

  const cov = coverage(turns, dim);
  const lines = [];
  const heading = `${rangeLabel} · by ${dim}`;
  lines.push(`\n  ${heading}`);
  lines.push(`  ${'='.repeat(heading.length)}`);

  // Honest empty/coming-soon state when the dimension is null on every turn
  // (e.g. task_category on current payloads — see collector classifyTask).
  if (cov.withVal === 0) {
    lines.push('');
    if (dim === 'cost_center') {
      // cost_center is config-driven (cost_center_map), not payload-driven —
      // so point the user at configuring the map, not at "the payload" (QA-0610-08).
      lines.push('  No turns are tagged with a cost_center yet. Tag projects/branches');
      lines.push('  by adding a `cost_center_map` to ~/.wtclaude/config.json — new turns');
      lines.push('  are attributed automatically (no backfill needed).');
    } else {
      lines.push(`  No turns carry a ${dim} value yet — this field is captured from`);
      lines.push(`  day one but is null on the current Claude Code payloads, so the`);
      lines.push(`  breakdown is empty. It will populate automatically once the`);
      lines.push(`  payload exposes it (no backfill needed).`);
    }
    lines.push('');
    lines.push(`  Range total: ${basisTag(total).priced ? moneyWithBasis(total.cost, total, cur) : '— (not priced)'} · ${turns.length} turns`);
    lines.push(...excludedLines(total));
    const n = currencyNote(cur); if (n) lines.push(n);
    lines.push('');
    output(withReadNote(lines.join('\n')), opts);
    return;
  }

  lines.push(`  ${pad(dim, 24)} ${rpad('Cost', 12)} ${rpad('Turns', 7)} ${rpad('Tokens', 9)}  Basis`);
  for (const g of groups) {
    lines.push(`  ${pad(label(g.key), 24)} ${rpad(tableAmount(g.summary.cost, g.summary, cur), 12)} ${rpad(String(g.summary.turn_count), 7)} ${rpad(fmtTok(g.summary), 9)}  ${basisTag(g.summary, cur).tag}`);
  }
  lines.push(`  ${pad('—'.repeat(5), 24)} ${rpad('', 12)} ${rpad('', 7)} ${rpad('', 9)}`);
  // The TOTAL carries the same badge as today/week/month (QA-0928-55).
  const badge = basisBadgeText(total.cost, total, cur);
  lines.push(`  ${pad('TOTAL', 24)} ${rpad(tableAmount(total.cost, total, cur), 12)} ${rpad(String(turns.length), 7)}${badge ? `  (${badge})` : ''}`);
  lines.push(...excludedLines(total));
  if (cov.withVal < cov.total) {
    lines.push(`  (${cov.total - cov.withVal} of ${cov.total} turns have no ${dim} — shown as ${label(null)})`);
  }
  const note = currencyNote(cur); if (note) lines.push(note);
  lines.push('');
  output(withReadNote(lines.join('\n')), opts);
}

function fmtTok(s) {
  const n = s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return `${n}`;
}
function pad(s, w) { s = String(s); return s.length > w ? s.slice(0, w - 1) + '…' : s.padEnd(w); }
function rpad(s, w) { s = String(s); return s.length > w ? s : s.padStart(w); }

// ── CSV (flat summary) ──────────────────────────────────────────────────────

function summaryCsvColumns() {
  return [
    { key: 'range', label: 'range' },
    { key: 'cost_usd', label: 'cost_usd' },
    { key: 'input', label: 'input_tokens' },
    { key: 'output', label: 'output_tokens' },
    { key: 'cache_read', label: 'cache_read_tokens' },
    { key: 'cache_write', label: 'cache_write_tokens' },
    { key: 'sessions', label: 'sessions' },
    { key: 'turns', label: 'turns' },
    ...BASIS_CSV_COLUMNS,
  ];
}
function summaryCsvRow(label, s) {
  return {
    range: label, cost_usd: round(s.cost),
    input: s.input_tokens, output: s.output_tokens,
    cache_read: s.cache_read_tokens, cache_write: s.cache_write_tokens,
    sessions: s.session_count, turns: s.turn_count,
    ...basisCsvFields(s),
  };
}

function emptySummary() {
  return {
    cost: 0, anchored_cost: 0, estimated_cost: 0, fast_cost: 0,
    anchored_turns: 0, estimated_turns: 0, excluded_turns: 0, excluded_models: {},
    fast_turns: 0, fast_payload_turns: 0, fast_inferred_turns: 0,
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
    session_count: 0, turn_count: 0, models: {},
  };
}

export function daysAgo(n) {
  return localDaysAgo(n); // local calendar date N days back (QA-BUG-10)
}

// Re-exported so single-purpose commands (project/report) can reuse the engine.
export { round, output, sessionCount, withReadNote, readNoteToStderr };
