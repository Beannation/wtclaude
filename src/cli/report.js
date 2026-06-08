import { getSessionsForDateRange } from '../utils/sessions.js';
import { groupTurns, displayKey } from '../utils/group.js';
import { resolveCurrency, formatMoney, currencyNote } from '../utils/currency.js';
import { output, round, sessionCount } from './_summary.js';
import { toCSV } from '../utils/export.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude report --cost-center [--month YYYY-MM] [--csv]` — monthly cost-by-
// cost-center report (build-spec M4 v1.1). INDIVIDUAL only — the team-wide
// rollup across employees is explicitly Phase 2 SMB. Cost centers are resolved
// per turn from the user's `cost_center_map` in config (keyed by project/branch).

const MONTH_RE = /^\d{4}-\d{2}$/;

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
    .description('Monthly cost report (individual). Use --cost-center for the cost-center breakdown.')
    .option('--cost-center', 'Break the month down by cost center')
    .option('--month <YYYY-MM>', 'Month to report (default: current month)')
    .option('--json', 'Output machine-readable JSON')
    .option('--csv', 'Output CSV')
    .option('--clipboard', 'Copy the output to the clipboard as well')
    .option('--currency <ISO>', 'Display amounts in another currency (display-only)')
    .action((opts) => {
      const o = opts || {};
      if (!o.costCenter) {
        console.error('\n  Specify what to report. Currently supported: --cost-center\n');
        process.exitCode = 1;
        return;
      }
      const month = o.month || localDate().slice(0, 7); // local current month (QA-BUG-10)
      if (!MONTH_RE.test(month)) {
        console.error(`\n  --month must be YYYY-MM (got "${month}")\n`);
        process.exitCode = 1;
        return;
      }
      const { start, end } = monthBounds(month);
      const turns = getSessionsForDateRange(start, end).flatMap(s => s.turns);
      const groups = groupTurns(turns, 'cost_center');
      const cur = resolveCurrency(o);
      const total = groups.reduce((a, g) => a + g.summary.cost, 0);

      const rows = groups.map(g => ({
        cost_center: displayKey(g.key, 'cost_center'),
        cost_usd: round(g.summary.cost),
        turns: g.summary.turn_count,
        sessions: sessionCount(turns.filter(t => (t.cost_center ?? null) === g.key)),
      }));

      if (o.json) {
        output(JSON.stringify({ schema_version: SCHEMA_VERSION, month, scope: 'individual', total_usd: round(total), cost_centers: rows }, null, 2), o);
        return;
      }
      if (o.csv) {
        output(toCSV(rows, [
          { key: 'cost_center', label: 'cost_center' }, { key: 'cost_usd', label: 'cost_usd' },
          { key: 'turns', label: 'turns' }, { key: 'sessions', label: 'sessions' },
        ]), o);
        return;
      }

      const lines = [`\n  Cost-center report · ${month} (individual)`, '  ' + '='.repeat(40)];
      if (turns.length === 0) { lines.push('\n  No usage recorded for this month.\n'); output(lines.join('\n'), o); return; }
      lines.push('');
      lines.push(`  ${'Cost center'.padEnd(24)} ${'Cost'.padStart(12)} ${'Turns'.padStart(7)}`);
      for (const r of rows) {
        lines.push(`  ${r.cost_center.padEnd(24)} ${formatMoney(r.cost_usd, cur).padStart(12)} ${String(r.turns).padStart(7)}`);
      }
      lines.push(`  ${'—'.repeat(5).padEnd(24)} ${''.padStart(12)}`);
      lines.push(`  ${'TOTAL'.padEnd(24)} ${formatMoney(total, cur).padStart(12)} ${String(turns.length).padStart(7)}`);
      const untagged = groups.find(g => g.key == null);
      if (untagged) {
        lines.push('');
        lines.push('  Tip: tag projects/branches by adding a `cost_center_map` to');
        lines.push('  ~/.wtclaude/config.json so untagged turns get attributed.');
      }
      const note = currencyNote(cur); if (note) lines.push(note);
      lines.push('  (Individual view — team-wide rollup is Phase 2 SMB.)');
      lines.push('');
      output(lines.join('\n'), o);
    });
}
