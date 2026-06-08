import { getSessionsForDateRange } from '../utils/sessions.js';
import { groupTurns } from '../utils/group.js';
import { resolveCurrency, formatMoney, currencyNote } from '../utils/currency.js';
import { loadConfig } from '../utils/config.js';
import { getSupabaseConfig } from '../sync/index.js';
import { output, round, sessionCount } from './_summary.js';
import { toCSV } from '../utils/export.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude devices` — cross-device combined totals + per-device breakdown
// (build-spec M4 v1.1). Combined totals ride cloud sync; with sync off we degrade
// to a LOCAL-only view (just this machine's device_id) plus a hint to enable
// sync. BUILD-012: when a 2nd device_id appears we surface an explicit
// "enable sync" prompt rather than burying it.

export function registerDevices(program) {
  program
    .command('devices')
    .description('Combined + per-device usage (rides cloud sync; local-only with a hint if sync is off)')
    .option('--json', 'Output machine-readable JSON')
    .option('--csv', 'Output CSV')
    .option('--clipboard', 'Copy the output to the clipboard as well')
    .option('--currency <ISO>', 'Display amounts in another currency (display-only)')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)')
    .action((opts) => {
      const o = opts || {};
      const start = o.since || '1970-01-01';
      const end = o.until || localDate(); // local calendar date (QA-BUG-10)
      const sessions = getSessionsForDateRange(start, end);
      const turns = sessions.flatMap(s => s.turns);
      const cfg = loadConfig();
      const { syncEnabled } = getSupabaseConfig();
      const cur = resolveCurrency(o);

      const groups = groupTurns(turns, 'device');
      const localId = cfg.device_id || null;
      const localLabel = cfg.device_label || null;
      const distinctDevices = groups.filter(g => g.key != null).length;
      const multiDevice = distinctDevices > 1;

      const rows = groups.map(g => {
        const isLocal = g.key === localId;
        const label = isLocal && localLabel ? localLabel : (g.key ? `device ${String(g.key).slice(0, 8)}` : '(no device id)');
        return {
          device_id: g.key, label, local: isLocal,
          cost_usd: round(g.summary.cost),
          turns: g.summary.turn_count,
          sessions: sessionCount(turns.filter(t => (t.device_id ?? null) === g.key)),
        };
      });
      const totalCost = groups.reduce((a, g) => a + g.summary.cost, 0);

      if (o.json) {
        output(JSON.stringify({
          schema_version: SCHEMA_VERSION,
          sync_enabled: !!syncEnabled,
          scope: syncEnabled ? 'cloud-or-local' : 'local-only',
          combined: { cost_usd: round(totalCost), turns: turns.length, devices: distinctDevices },
          devices: rows,
          second_device_prompt: multiDevice && !syncEnabled,
        }, null, 2), o);
        return;
      }
      if (o.csv) { output(toCSV(rows, [
        { key: 'label', label: 'device' }, { key: 'cost_usd', label: 'cost_usd' },
        { key: 'turns', label: 'turns' }, { key: 'sessions', label: 'sessions' }, { key: 'local', label: 'local' },
      ]), o); return; }

      const lines = ['\n  Devices', '  ======='];
      if (!syncEnabled) {
        lines.push('  Local-only view (cloud sync is off — combined totals across machines');
        lines.push('  need `wtclaude sync --enable`).');
      }
      lines.push('');
      if (turns.length === 0) { lines.push('  No usage recorded yet.\n'); output(lines.join('\n'), o); return; }

      lines.push(`  ${'Device'.padEnd(24)} ${'Cost'.padStart(12)} ${'Turns'.padStart(7)} ${'Sessions'.padStart(9)}`);
      for (const r of rows) {
        const mark = r.local ? ' ◀ this device' : '';
        lines.push(`  ${r.label.padEnd(24)} ${formatMoney(r.cost_usd, cur).padStart(12)} ${String(r.turns).padStart(7)} ${String(r.sessions).padStart(9)}${mark}`);
      }
      lines.push(`  ${'—'.repeat(5).padEnd(24)} ${''.padStart(12)}`);
      lines.push(`  ${'COMBINED'.padEnd(24)} ${formatMoney(totalCost, cur).padStart(12)} ${String(turns.length).padStart(7)}`);

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
