import { getSessionsForDateRange, summarizeSessions } from '../utils/sessions.js';
import { formatUsageSummary } from '../utils/format.js';

export function registerMonth(program) {
  program
    .command('month')
    .description('Show last 30 days usage')
    .action(() => {
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 29);

      const startStr = start.toISOString().slice(0, 10);
      const endStr = end.toISOString().slice(0, 10);
      const sessions = getSessionsForDateRange(startStr, endStr);

      if (sessions.length === 0) {
        console.log('\n  No usage data for the last 30 days.\n');
        return;
      }

      const summary = summarizeSessions(sessions);
      console.log(formatUsageSummary(`Last 30 days (${startStr} to ${endStr})`, summary));
    });
}
