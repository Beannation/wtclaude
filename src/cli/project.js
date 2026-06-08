import { getSessionsForDateRange, summarizeTurns } from '../utils/sessions.js';
import { formatUsageSummary } from '../utils/format.js';
import { resolveCurrency } from '../utils/currency.js';
import { listProjectHashes } from '../utils/projects.js';
import { round, output } from './_summary.js';
import { toCSV } from '../utils/export.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude project <hash>` — per-project view (build-spec M4 core). Filters the
// salted `project_hash` the collector records (the raw path is never stored) and
// summarizes that project across all data (or a --since/--until window).
// With no hash, lists the known project hashes so the user can pick one.

export function registerProject(program) {
  program
    .command('project [hash]')
    .description('Show usage for one project_hash (or list known projects)')
    .option('--json', 'Output machine-readable JSON')
    .option('--csv', 'Output CSV')
    .option('--clipboard', 'Copy the output to the clipboard as well')
    .option('--currency <ISO>', 'Display amounts in another currency (display-only)')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)')
    .action((hash, opts) => {
      const o = opts || {};
      const start = o.since || '1970-01-01';
      const end = o.until || localDate(); // local calendar date (QA-BUG-10)
      const sessions = getSessionsForDateRange(start, end);
      const allTurns = sessions.flatMap(s => s.turns);

      if (!hash) {
        const known = listProjectHashes(allTurns);
        if (o.json) { output(JSON.stringify({ schema_version: SCHEMA_VERSION, projects: known }, null, 2), o); return; }
        if (known.length === 0) { output('\n  No projects recorded yet.\n', o); return; }
        const lines = ['\n  Known projects (salted hashes — raw paths are never stored)', '  ' + '='.repeat(56)];
        for (const p of known) {
          lines.push(`  ${p.project_hash.padEnd(14)} ${String(p.turns).padStart(5)} turns  ${(p.git_branch || '—')}`);
        }
        lines.push('\n  Run: wtclaude project <hash>  for the full breakdown.\n');
        output(lines.join('\n'), o);
        return;
      }

      const turns = allTurns.filter(t => t.project_hash && (t.project_hash === hash || t.project_hash.startsWith(hash)));
      if (turns.length === 0) {
        if (o.json) { output(JSON.stringify({ schema_version: SCHEMA_VERSION, project_hash: hash, turns: 0 }, null, 2), o); return; }
        output(`\n  No usage for project "${hash}".\n`, o);
        return;
      }

      const summary = summarizeTurns(turns);
      const sessionIds = new Set(turns.map(t => t.session_id).filter(Boolean));
      summary.session_count = sessionIds.size;
      const cur = resolveCurrency(o);

      if (o.json) {
        output(JSON.stringify({
          schema_version: SCHEMA_VERSION,
          project_hash: turns[0].project_hash,
          range: { since: start, until: end },
          cost_usd: round(summary.cost),
          sessions: summary.session_count,
          turns: summary.turn_count,
          tokens: { input: summary.input_tokens, output: summary.output_tokens, cache_read: summary.cache_read_tokens, cache_write: summary.cache_write_tokens },
          branches: [...new Set(turns.map(t => t.git_branch).filter(Boolean))],
        }, null, 2), o);
        return;
      }
      if (o.csv) {
        output(toCSV([{ project_hash: turns[0].project_hash, cost_usd: round(summary.cost), sessions: summary.session_count, turns: summary.turn_count }]), o);
        return;
      }
      output(formatUsageSummary(`Project ${turns[0].project_hash}`, summary, cur), o);
    });
}
