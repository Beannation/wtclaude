import { getSessionsForDateRange, summarizeSessions } from '../utils/sessions.js';
import { formatUsageSummary } from '../utils/format.js';

export function registerWeek(program) {
  program
    .command('week')
    .description('Show last 7 days usage')
    .action(() => {
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - 6);

      const startStr = start.toISOString().slice(0, 10);
      const endStr = end.toISOString().slice(0, 10);
      const sessions = getSessionsForDateRange(startStr, endStr);

      if (sessions.length === 0) {
        console.log('\n  No usage data for the last 7 days.\n');
        return;
      }

      const summary = summarizeSessions(sessions);
      console.log(formatUsageSummary(`Last 7 days (${startStr} to ${endStr})`, summary));
    });
}
