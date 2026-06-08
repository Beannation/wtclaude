import { addRangeOpts, emitSummary, daysAgo } from './_summary.js';
import { localDate } from '../utils/time.js';

export function registerMonth(program) {
  addRangeOpts(
    program
      .command('month')
      .description('Show last 30 days usage (supports --json, --since/--until)')
  ).action((opts) => {
    const startStr = daysAgo(29);
    const endStr = localDate(); // local calendar date (QA-BUG-10)
    emitSummary(`Last 30 days (${startStr} to ${endStr})`, startStr, endStr, opts);
  });
}
