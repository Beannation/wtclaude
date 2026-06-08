import { getSessionsForDateRange } from '../utils/sessions.js';
import { computeTurnCost, formatCost, formatTokens } from '../utils/cost.js';
import { localDate } from '../utils/time.js';

export function registerDebrief(program) {
  program
    .command('debrief')
    .description('End-of-day summary with costliest turn and tip')
    .action(() => {
      const today = localDate(); // local calendar date (QA-BUG-10)
      const sessions = getSessionsForDateRange(today, today);

      if (sessions.length === 0) {
        console.log('\n  No usage data for today yet.\n');
        return;
      }

      const allTurns = sessions.flatMap(s => s.turns);
      let totalCost = 0;
      let costliestTurn = null;
      let costliestCost = 0;

      for (const t of allTurns) {
        const c = computeTurnCost(t);
        totalCost += c;
        if (c > costliestCost) {
          costliestCost = c;
          costliestTurn = t;
        }
      }

      console.log(`\n  Daily Debrief — ${today}`);
      console.log('  ========================');
      console.log(`  Sessions:     ${sessions.length}`);
      console.log(`  Turns:        ${allTurns.length}`);
      console.log(`  Total cost:   ${formatCost(totalCost)}`);
      console.log(`  Total tokens: ${formatTokens(allTurns.reduce((s, t) => s + t.input_tokens + t.output_tokens, 0))}`);
      console.log('');

      if (costliestTurn) {
        console.log(`  Costliest turn: #${costliestTurn.turn} (${costliestTurn.model})`);
        console.log(`    Cost: ${formatCost(costliestCost)}`);
        console.log(`    Input: ${formatTokens(costliestTurn.input_tokens)} | Output: ${formatTokens(costliestTurn.output_tokens)}`);
        console.log(`    Cache read: ${formatTokens(costliestTurn.cache_read_tokens)} | Cache write: ${formatTokens(costliestTurn.cache_write_tokens)}`);
      }

      const totalInput = allTurns.reduce((s, t) => s + t.input_tokens + t.cache_read_tokens + t.cache_write_tokens, 0);
      const cacheReads = allTurns.reduce((s, t) => s + t.cache_read_tokens, 0);
      const cacheRate = totalInput > 0 ? ((cacheReads / totalInput) * 100).toFixed(0) : 0;

      console.log('');
      console.log(`  Cache hit rate: ${cacheRate}%`);
      if (cacheRate < 30) {
        console.log('  Tip: A CLAUDE.md file in your project root improves cache hits significantly.');
      } else if (cacheRate > 60) {
        console.log('  Tip: Great cache efficiency! Your CLAUDE.md and project context are working well.');
      }
      console.log('');
    });
}
