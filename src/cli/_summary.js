// Shared plumbing for the summary commands (today/week/month + arbitrary
// --since/--until ranges) and their --json output. A1 CLI-parity floor (v1.7):
// --json on today/week/month/session/blocks, and --since/--until date ranges.
//
// v1.8/v1.9 adds (fast-follow): --group-by (project|branch|cost_center|task),
// --currency (display-only FX), and --csv/--clipboard (a formatter over --json).

import { getSessionsForDateRange, summarizeSessions, summarizeTurns } from '../utils/sessions.js';
import { formatUsageSummary, costBasisBadge } from '../utils/format.js';
import { resolveCurrency, formatMoney, currencyNote } from '../utils/currency.js';
import { resolveDimension, groupTurns, displayKey, coverage } from '../utils/group.js';
import { toCSV, copyToClipboard } from '../utils/export.js';
import { coldStartMessage } from '../utils/firstrun.js';
import { localDate, localDaysAgo } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Attach the parity flags shared by the summary commands.
export function addRangeOpts(cmd) {
  return cmd
    .option('--json', 'Output machine-readable JSON instead of the formatted summary')
    .option('--since <date>', 'Start date (YYYY-MM-DD) — overrides the default range')
    .option('--until <date>', 'End date (YYYY-MM-DD) — defaults to today when --since is given')
    .option('--group-by <dimension>', 'Break the range down by project | branch | cost_center | task')
    .option('--currency <ISO>', 'Display amounts in another currency (display-only; USD stays billing-grade)')
    .option('--csv', 'Output CSV (a formatter over --json)')
    .option('--clipboard', 'Copy the output to the clipboard as well');
}

function today() { return localDate(); } // local calendar date (QA-BUG-10)

// Resolve the effective [start,end] from the command default and any
// --since/--until override. Returns { startStr, endStr } or throws on bad input.
export function resolveRange(defaultStart, defaultEnd, opts = {}) {
  const o = opts || {};
  for (const [k, v] of [['--since', o.since], ['--until', o.until]]) {
    if (v != null && !DATE_RE.test(v)) throw new Error(`${k} must be YYYY-MM-DD (got "${v}")`);
  }
  let startStr = o.since || defaultStart;
  let endStr = o.until || (o.since ? today() : defaultEnd);
  if (startStr > endStr) [startStr, endStr] = [endStr, startStr]; // tolerate swapped dates
  return { startStr, endStr };
}

// The machine-readable shape for --json. Stable key set so scripts can depend on it.
export function jsonSummary(label, startStr, endStr, summary) {
  return {
    schema_version: SCHEMA_VERSION,
    range: { label, since: startStr, until: endStr },
    cost_usd: round(summary.cost),
    cost_basis: {
      anchored_usd: round(summary.anchored_cost),
      estimated_usd: round(summary.estimated_cost),
      anchored_turns: summary.anchored_turns,
      estimated_turns: summary.estimated_turns,
    },
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
  };
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }

// Emit text and, when --clipboard is set, also copy it (with a soft-fail note).
function output(text, opts = {}) {
  console.log(text);
  if (opts.clipboard) {
    const ok = copyToClipboard(text.replace(/^\n+/, ''));
    console.log(ok ? '  (copied to clipboard)\n' : '  (clipboard unavailable on this system)\n');
  }
}

// One entry point the summary commands share. Handles empty + grouping + --json
// + --csv + --currency + --clipboard + the formatted summary.
export function emitSummary(label, defaultStart, defaultEnd, opts = {}) {
  let startStr, endStr;
  try {
    ({ startStr, endStr } = resolveRange(defaultStart, defaultEnd, opts));
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
      console.error(`\n  --group-by must be one of: project, branch, cost_center, task (got "${opts.groupBy}")\n`);
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
    } else {
      output(coldStartMessage(rangeLabel), opts);
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
  } else {
    // With a --since/--until override, the date range IS the heading (avoids the
    // redundant "Today (date) (range)" double-label); otherwise use the label.
    const heading = (opts.since || opts.until) ? `Usage (${startStr} to ${endStr})` : label;
    let text = formatUsageSummary(heading, summary, cur);
    if (pools) text += formatPoolBlock(pools, cur);
    output(text, opts);
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
    cost_basis: {
      anchored_usd: round(s.anchored_cost), estimated_usd: round(s.estimated_cost),
      anchored_turns: s.anchored_turns, estimated_turns: s.estimated_turns,
    },
  });
  return { interactive: one(pools.interactive), agent_sdk: one(pools.agent_sdk) };
}

function formatPoolBlock(pools, cur) {
  const line = (label, s) => {
    const b = costBasisBadge(s);
    const amt = `${b.tilde ? '~' : ''}${formatMoney(s.cost, cur)}`;
    const badge = b.label ? `  (${b.label})` : '';
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

  if (opts.json) {
    output(JSON.stringify({
      schema_version: SCHEMA_VERSION,
      range: { label: rangeLabel, since: range.since ?? null, until: range.until ?? null },
      group_by: dim,
      coverage: coverage(turns, dim),
      groups: groups.map(g => ({
        key: g.key,
        display: displayKey(g.key, dim),
        cost_usd: round(g.summary.cost),
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
    group: displayKey(g.key, dim),
    cost_usd: round(g.summary.cost),
    turns: g.summary.turn_count,
    tokens: g.summary.input_tokens + g.summary.output_tokens + g.summary.cache_read_tokens + g.summary.cache_write_tokens,
  }));

  if (opts.csv) {
    output(toCSV(rows, [
      { key: 'group', label: dim },
      { key: 'cost_usd', label: 'cost_usd' },
      { key: 'turns', label: 'turns' },
      { key: 'tokens', label: 'tokens' },
    ]), opts);
    return;
  }

  if (turns.length === 0) { output(`\n  No usage data for ${rangeLabel}.\n`, opts); return; }

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
    lines.push(`  Range total: ${formatMoney(sumCost(groups), cur)} · ${turns.length} turns`);
    const n = currencyNote(cur); if (n) lines.push(n);
    lines.push('');
    output(lines.join('\n'), opts);
    return;
  }

  lines.push(`  ${pad(dim, 24)} ${rpad('Cost', 12)} ${rpad('Turns', 7)} ${rpad('Tokens', 9)}`);
  for (const g of groups) {
    lines.push(`  ${pad(displayKey(g.key, dim), 24)} ${rpad(formatMoney(g.summary.cost, cur), 12)} ${rpad(String(g.summary.turn_count), 7)} ${rpad(fmtTok(g.summary), 9)}`);
  }
  lines.push(`  ${pad('—'.repeat(5), 24)} ${rpad('', 12)} ${rpad('', 7)} ${rpad('', 9)}`);
  lines.push(`  ${pad('TOTAL', 24)} ${rpad(formatMoney(sumCost(groups), cur), 12)} ${rpad(String(turns.length), 7)}`);
  if (cov.withVal < cov.total) {
    lines.push(`  (${cov.total - cov.withVal} of ${cov.total} turns have no ${dim} — shown as ${displayKey(null, dim)})`);
  }
  const note = currencyNote(cur); if (note) lines.push(note);
  lines.push('');
  output(lines.join('\n'), opts);
}

function sumCost(groups) { return groups.reduce((a, g) => a + g.summary.cost, 0); }
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
  ];
}
function summaryCsvRow(label, s) {
  return {
    range: label, cost_usd: round(s.cost),
    input: s.input_tokens, output: s.output_tokens,
    cache_read: s.cache_read_tokens, cache_write: s.cache_write_tokens,
    sessions: s.session_count, turns: s.turn_count,
  };
}

function emptySummary() {
  return {
    cost: 0, anchored_cost: 0, estimated_cost: 0, fast_cost: 0,
    anchored_turns: 0, estimated_turns: 0, fast_turns: 0, fast_payload_turns: 0, fast_inferred_turns: 0,
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0,
    session_count: 0, turn_count: 0, models: {},
  };
}

export function daysAgo(n) {
  return localDaysAgo(n); // local calendar date N days back (QA-BUG-10)
}

// Re-exported so single-purpose commands (project/report) can reuse the engine.
export { round, output, sessionCount };
