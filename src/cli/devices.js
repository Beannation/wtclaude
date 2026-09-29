import { getSessionsForDateRange, summarizeTurns } from '../utils/sessions.js';
import { groupTurns, deviceLabel } from '../utils/group.js';
import { resolveCurrency, currencyNote } from '../utils/currency.js';
import { costBasisJson, basisTag, tableAmount, basisBadgeText, excludedLines, BASIS_CSV_COLUMNS, basisCsvFields } from '../utils/format.js';
import { loadConfig } from '../utils/config.js';
import { getSupabaseConfig } from '../sync/index.js';
import { output, round, sessionCount, resolveRange, emptyRangeLine } from './_summary.js';
import { hasAnyData } from '../utils/firstrun.js';
import { toCSV } from '../utils/export.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude devices` — per-device breakdown of THIS machine's session files
// (build-spec M4 v1.1). It never reads the cloud, so it is always a local-only
// view (QA-0928-64): with sync on, cross-device totals live on the dashboard;
// with sync off, the hint is to enable sync. BUILD-012: when a 2nd device_id
// appears in the local files we surface an explicit "enable sync" prompt.

export function registerDevices(program) {
  program
    .command('devices')
    .description('Per-device usage from this machine\'s session files (local-only; cross-device totals are on the dashboard)')
    .option('--json', 'Output machine-readable JSON')
    .option('--csv', 'Output CSV')
    .option('--clipboard', 'Copy the output to the clipboard as well')
    .option('--currency <ISO>', 'Display amounts in another currency (display-only)')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)')
    .action((opts) => {
      const o = opts || {};
      // Same validation and bounds handling as today/week/month (QA-0928-57);
      // the default stays all-time, ending on the local calendar date (QA-BUG-10).
      let start, end;
      try {
        ({ startStr: start, endStr: end } = resolveRange('1970-01-01', localDate(), o));
      } catch (err) {
        console.error(`\n  ${err.message}\n`);
        process.exitCode = 1;
        return;
      }
      const sessions = getSessionsForDateRange(start, end);
      const turns = sessions.flatMap(s => s.turns);
      const cfg = loadConfig();
      const { syncEnabled } = getSupabaseConfig();
      const cur = resolveCurrency(o);

      const groups = groupTurns(turns, 'device');
      const localId = cfg.device_id || null;
      const distinctDevices = groups.filter(g => g.key != null).length;
      const multiDevice = distinctDevices > 1;

      const rows = groups.map(g => {
        const isLocal = g.key != null && g.key === localId;
        const label = deviceLabel(g.key, cfg); // same label as --group-by device (QA-0928-158)
        return {
          device_id: g.key, label, local: isLocal,
          cost_usd: round(g.summary.cost),
          cost_basis: costBasisJson(g.summary), // QA-0928-55
          turns: g.summary.turn_count,
          sessions: sessionCount(turns.filter(t => (t.device_id ?? null) === g.key)),
          summary: g.summary,
        };
      });
      const total = summarizeTurns(turns);
      const totalCost = total.cost;

      if (o.json) {
        output(JSON.stringify({
          schema_version: SCHEMA_VERSION,
          sync_enabled: !!syncEnabled,
          scope: 'local-only', // this command only ever reads local files (QA-0928-64)
          combined: { cost_usd: round(totalCost), cost_basis: costBasisJson(total), turns: turns.length, devices: distinctDevices },
          devices: rows.map(({ summary, ...r }) => r),
          second_device_prompt: multiDevice && !syncEnabled,
        }, null, 2), o);
        return;
      }
      if (o.csv) { output(toCSV(rows.map(r => ({ ...r, ...basisCsvFields(r.summary) })), [
        { key: 'label', label: 'device' }, { key: 'cost_usd', label: 'cost_usd' },
        { key: 'turns', label: 'turns' }, { key: 'sessions', label: 'sessions' }, { key: 'local', label: 'local' },
        ...BASIS_CSV_COLUMNS,
      ]), o); return; }

      // Always local-only (QA-0928-64): this reads this machine's session files,
      // never the cloud — so its total is never a cross-device total.
      const lines = ['\n  Devices', '  ======='];
      lines.push('  Local-only view: this machine\'s session files.');
      lines.push(syncEnabled
        ? '  Totals across all your synced devices are on the dashboard (`wtclaude dashboard`).'
        : '  Combined totals across machines need `wtclaude sync --enable`.');
      lines.push('');
      if (turns.length === 0) {
        // QA-0928-59: with data outside the range, say so plainly.
        const ranged = (o.since || o.until) && hasAnyData();
        lines.push(`  ${ranged ? emptyRangeLine(start, end) : 'No usage recorded yet.'}\n`);
        output(lines.join('\n'), o);
        return;
      }

      lines.push(`  ${'Device'.padEnd(28)} ${'Cost'.padStart(12)} ${'Turns'.padStart(7)} ${'Sessions'.padStart(9)}  Basis`);
      for (const r of rows) {
        lines.push(`  ${r.label.padEnd(28)} ${tableAmount(r.summary.cost, r.summary, cur).padStart(12)} ${String(r.turns).padStart(7)} ${String(r.sessions).padStart(9)}  ${basisTag(r.summary, cur).tag}`);
      }
      lines.push(`  ${'—'.repeat(5).padEnd(28)} ${''.padStart(12)}`);
      const badge = basisBadgeText(totalCost, total, cur); // QA-0928-55
      lines.push(`  ${"TOTAL (this machine's files)".padEnd(28)} ${tableAmount(totalCost, total, cur).padStart(12)} ${String(turns.length).padStart(7)}${badge ? `  (${badge})` : ''}`);
      lines.push(...excludedLines(total));

      if (multiDevice && !syncEnabled) {
        lines.push('');
        lines.push('  ▶ A second device is sending data to this machine. Enable cloud sync to');
        lines.push('    combine them properly across machines:  wtclaude sync --enable');
      }
      const note = currencyNote(cur); if (note) lines.push(note);
      lines.push('');
      output(lines.join('\n'), o);
    });
}
