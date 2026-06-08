import { addRangeOpts, emitSummary, daysAgo } from './_summary.js';
import { localDate } from '../utils/time.js';

export function registerWeek(program) {
  addRangeOpts(
    program
      .command('week')
      .description('Show last 7 days usage (supports --json, --since/--until)')
  ).action((opts) => {
    const startStr = daysAgo(6);
    const endStr = localDate(); // local calendar date (QA-BUG-10)
    emitSummary(`Last 7 days (${startStr} to ${endStr})`, startStr, endStr, opts);
  });
}
