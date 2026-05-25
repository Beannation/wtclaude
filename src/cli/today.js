import { getSessionsForDateRange, summarizeSessions } from '../utils/sessions.js';
import { formatUsageSummary } from '../utils/format.js';

export function registerToday(program) {
  program
    .command('today')
    .description('Show today\'s usage summary')
    .action(() => {
      const today = new Date().toISOString().slice(0, 10);
      const sessions = getSessionsForDateRange(today, today);

      if (sessions.length === 0) {
        console.log('\n  No usage data for today yet.');
        console.log('  Start a Claude Code session with wtclaude-collector configured.\n');
        return;
      }

      const summary = summarizeSessions(sessions);
      console.log(formatUsageSummary(`Today (${today})`, summary));
    });
}
