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
      .description('Break usage down by task category (alias for --group-by=task)'),
    { groupBy: false }, // always grouped by task; --group-by is rejected, not ignored (QA-0928-65)
  ).action((opts) => {
    const o = opts || {};
    o.groupBy = 'task';
    // Defaults only; --since/--until resolve in emitSummary like every other
    // summary command, so --until alone means the 30 days ending then (QA-0928-56).
    const start = daysAgo(29);
    const end = localDate(); // local calendar date (QA-BUG-10)
    emitSummary('Tasks (last 30 days)', start, end, o, { span: 30 });
  });
}
