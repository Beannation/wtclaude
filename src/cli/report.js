import { getSessionsForDateRange, summarizeTurns } from '../utils/sessions.js';
import { groupTurns, displayKey } from '../utils/group.js';
import { resolveCurrency, currencyNote } from '../utils/currency.js';
import { costBasisJson, basisTag, tableAmount, basisBadgeText, excludedLines, BASIS_CSV_COLUMNS, basisCsvFields } from '../utils/format.js';
import { output, round, sessionCount, withReadNote } from './_summary.js';
import { toCSV } from '../utils/export.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude report [--cost-center] [--month YYYY-MM] [--csv]` — monthly cost-by-
// cost-center report (build-spec M4 v1.1). INDIVIDUAL only — the team-wide
// rollup across employees is explicitly Phase 2 SMB. Cost centers are resolved
// per turn from the user's `cost_center_map` in config (keyed by project/branch).
// A bare `report` is this monthly report (QA-0928-159): its help and /docs
// promised a monthly cost report while it exited 1 asking for --cost-center,
// the only view there is. --cost-center stays accepted.

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/; // a real month (QA-0928-159)

function monthBounds(month) {
  const [y, m] = month.split('-').map(Number);
  const start = `${month}-01`;
  const endDate = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day
  const end = endDate.toISOString().slice(0, 10);
  return { start, end };
}

export function registerReport(program) {
  program
    .command('report')
    .description('Monthly cost report (individual), broken down by cost center')
    .option('--cost-center', 'Break the month down by cost center (the default view)')
    .option('--month <YYYY-MM>', 'Month to report (default: current month)')
    .option('--json', 'Output machine-readable JSON')
    .option('--csv', 'Output CSV')
    .option('--clipboard', 'Copy the output to the clipboard as well')
    .option('--currency <ISO>', 'Display amounts in another currency (display-only)')
    .action((opts) => {
      const o = opts || {};
      const month = o.month || localDate().slice(0, 7); // local current month (QA-BUG-10)
      if (!MONTH_RE.test(month)) {
        console.error(`\n  --month must be a real month as YYYY-MM (got "${month}")\n`);
        process.exitCode = 1;
        return;
      }
      const { start, end } = monthBounds(month);
      const turns = getSessionsForDateRange(start, end).flatMap(s => s.turns);
      const groups = groupTurns(turns, 'cost_center');
      const cur = resolveCurrency(o);
      const totalSummary = summarizeTurns(turns);
      const total = totalSummary.cost;

      const rows = groups.map(g => ({
        cost_center: displayKey(g.key, 'cost_center'),
        cost_usd: round(g.summary.cost),
        turns: g.summary.turn_count,
        sessions: sessionCount(turns.filter(t => (t.cost_center ?? null) === g.key)),
        summary: g.summary,
      }));

      if (o.json) {
        // cost_basis on the total and on every row (QA-0928-55), like today --json.
        const cost_centers = rows.map(({ summary, ...r }) => ({ ...r, cost_basis: costBasisJson(summary) }));
        output(JSON.stringify({ schema_version: SCHEMA_VERSION, month, scope: 'individual', total_usd: round(total), cost_basis: costBasisJson(totalSummary), cost_centers }, null, 2), o);
        return;
      }
      if (o.csv) {
        output(toCSV(rows.map(r => ({ ...r, ...basisCsvFields(r.summary) })), [
          { key: 'cost_center', label: 'cost_center' }, { key: 'cost_usd', label: 'cost_usd' },
          { key: 'turns', label: 'turns' }, { key: 'sessions', label: 'sessions' },
          ...BASIS_CSV_COLUMNS,
        ]), o);
        return;
      }

      const lines = [`\n  Cost-center report · ${month} (individual)`, '  ' + '='.repeat(40)];
      if (turns.length === 0) { lines.push('\n  No usage recorded for this month.\n'); output(lines.join('\n'), o); return; }
      lines.push('');
      lines.push(`  ${'Cost center'.padEnd(24)} ${'Cost'.padStart(12)} ${'Turns'.padStart(7)}  Basis`);
      for (const r of rows) {
        lines.push(`  ${r.cost_center.padEnd(24)} ${tableAmount(r.summary.cost, r.summary, cur).padStart(12)} ${String(r.turns).padStart(7)}  ${basisTag(r.summary, cur).tag}`);
      }
      lines.push(`  ${'—'.repeat(5).padEnd(24)} ${''.padStart(12)}`);
      // The TOTAL carries the same badge today/week/month print (QA-0928-55).
      const badge = basisBadgeText(total, totalSummary, cur);
      lines.push(`  ${'TOTAL'.padEnd(24)} ${tableAmount(total, totalSummary, cur).padStart(12)} ${String(turns.length).padStart(7)}${badge ? `  (${badge})` : ''}`);
      lines.push(...excludedLines(totalSummary));
      const untagged = groups.find(g => g.key == null);
      if (untagged) {
        lines.push('');
        lines.push('  Tip: tag projects/branches by adding a `cost_center_map` to');
        lines.push('  ~/.wtclaude/config.json so untagged turns get attributed.');
      }
      const note = currencyNote(cur); if (note) lines.push(note);
      lines.push('  (Individual view — team-wide rollup coming soon.)');
      lines.push('');
      output(withReadNote(lines.join('\n')), o);
    });
}
