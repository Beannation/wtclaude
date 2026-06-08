import { addRangeOpts, emitSummary, daysAgo } from './_summary.js';
import { localDate } from '../utils/time.js';

// `wtclaude tasks` — token/cost breakdown by task_category (BUILD-014). This is
// the named alias for `--group-by=task`; the collector classifies categories
// deterministically from tool names (no LLM). task_category is null on the
// current Claude Code payloads, so the grouped renderer shows an honest
// coming-soon/empty state until the payload exposes the data (no backfill).

export function registerTasks(program) {
  addRangeOpts(
    program
      .command('tasks')
      .description('Break usage down by task category (alias for --group-by=task)')
  ).action((opts) => {
    const o = opts || {};
    o.groupBy = 'task';
    const start = o.since || daysAgo(29);
    const end = o.until || localDate(); // local calendar date (QA-BUG-10)
    emitSummary('Tasks (last 30 days)', start, end, o);
  });
}
