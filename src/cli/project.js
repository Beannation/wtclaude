import { getSessionsForDateRange, summarizeTurns } from '../utils/sessions.js';
import { formatUsageSummary, costBasisJson, BASIS_CSV_COLUMNS, basisCsvFields } from '../utils/format.js';
import { resolveCurrency } from '../utils/currency.js';
import { listProjectHashes } from '../utils/projects.js';
import { round, output, resolveRange, emptyRangeLine, matchId, reportAmbiguous, withReadNote } from './_summary.js';
import { hasAnyData } from '../utils/firstrun.js';
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
      const allTurns = sessions.flatMap(s => s.turns);

      if (!hash) {
        const known = listProjectHashes(allTurns);
        if (o.json) { output(JSON.stringify({ schema_version: SCHEMA_VERSION, projects: known }, null, 2), o); return; }
        if (o.csv) { // QA-0928-65: --csv was advertised but printed the text list
          output(toCSV(known, [{ key: 'project_hash' }, { key: 'turns' }, { key: 'git_branch' }, { key: 'last_ts' }]), o);
          return;
        }
        if (known.length === 0) {
          // QA-0928-59: with data outside the range, say so plainly.
          const ranged = (o.since || o.until) && hasAnyData();
          output(`\n  ${ranged ? emptyRangeLine(start, end, 'projects') : 'No projects recorded yet.'}\n`, o);
          return;
        }
        const lines = ['\n  Known projects (salted hashes — raw paths are never stored)', '  ' + '='.repeat(56)];
        for (const p of known) {
          lines.push(`  ${p.project_hash.padEnd(14)} ${String(p.turns).padStart(5)} turns  ${(p.git_branch || '—')}`);
        }
        lines.push('\n  Run: wtclaude project <hash>  for the full breakdown.\n');
        output(lines.join('\n'), o);
        return;
      }

      // Exact hash, else a unique prefix (QA-0928-63): an ambiguous prefix used to
      // sum every matching project under the first one's label.
      const m = matchId(hash, listProjectHashes(allTurns).map(p => p.project_hash));
      if (m.error === 'ambiguous') { reportAmbiguous('project', hash, m.matches, o); return; }
      const turns = m.id ? allTurns.filter(t => t.project_hash === m.id) : [];
      // An id no project matches, in any range, is an input error, as for
      // `session` (RC 2026-09-28); a known project with nothing in the range
      // is not.
      if (!m.id) {
        const ever = matchId(hash, listProjectHashes(getSessionsForDateRange('0000-01-01', '9999-12-31').flatMap(s => s.turns)).map(p => p.project_hash));
        if (ever.error === 'none') process.exitCode = 1;
      }
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
          project_hash: m.id,
          range: { since: start, until: end },
          cost_usd: round(summary.cost),
          cost_basis: costBasisJson(summary), // QA-0928-55
          sessions: summary.session_count,
          turns: summary.turn_count,
          tokens: { input: summary.input_tokens, output: summary.output_tokens, cache_read: summary.cache_read_tokens, cache_write: summary.cache_write_tokens },
          branches: [...new Set(turns.map(t => t.git_branch).filter(Boolean))],
        }, null, 2), o);
        return;
      }
      if (o.csv) {
        output(toCSV([{ project_hash: m.id, cost_usd: round(summary.cost), sessions: summary.session_count, turns: summary.turn_count, ...basisCsvFields(summary) }], [
          { key: 'project_hash' }, { key: 'cost_usd' }, { key: 'sessions' }, { key: 'turns' }, ...BASIS_CSV_COLUMNS,
        ]), o);
        return;
      }
      output(withReadNote(formatUsageSummary(`Project ${m.id}`, summary, cur)), o);
    });
}
