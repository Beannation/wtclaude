import { getSessionsForDateRange, summarizeTurns } from '../utils/sessions.js';
import { turnCostBasis, formatCost, formatTokens } from '../utils/cost.js';
import { moneyWithBasis, excludedLines, tokensAll, basisTag, inputSideTokens } from '../utils/format.js';
import { localDate } from '../utils/time.js';

// CORRECTED 2026-09-28 (BUILD-018). The stored per-turn tokens are context
// occupancy deltas (BUILD-014), not billed tokens, while the per-turn cost is
// the billed anchor. So the debrief no longer reports a "cache hit rate" or a
// causal CLAUDE.md tip on those tokens (QA-0928-85), labels the costliest
// turn's tokens as context growth (QA-0928-87), and says which token fields
// its total sums — all four, as `blocks` does (QA-0928-174). The cache-read
// share is over the input side only (output is never cached), each token
// counted once, and says so rather than borrowing the four-field "recorded
// tokens".
//
// QA-0928-55 (ledger handoff): "Total cost:" was unlabelled and summed every
// turn through computeTurnCost, fallback-priced unanchored turns included. It is
// now summarizeTurns' total — the one `today` shows: billing-grade anchor plus
// labelled estimate, turns we cannot price left out and named — with its basis
// badge, and the costliest turn says when its cost is an estimate.
export function registerDebrief(program) {
  program
    .command('debrief')
    .description('End-of-day summary with the costliest turn')
    .action(() => {
      const today = localDate(); // local calendar date (QA-BUG-10)
      const sessions = getSessionsForDateRange(today, today);

      if (sessions.length === 0) {
        console.log('\n  No usage data for today yet.\n');
        return;
      }

      const allTurns = sessions.flatMap(s => s.turns);
      const total = summarizeTurns(allTurns);
      let costliestTurn = null;
      let costliest = null;

      for (const t of allTurns) {
        const b = turnCostBasis(t); // an excluded turn is $0 here: never "costliest"
        if (b.usd > (costliest ? costliest.usd : 0)) {
          costliest = b;
          costliestTurn = t;
        }
      }

      console.log(`\n  Daily Debrief — ${today}`);
      console.log('  ========================');
      console.log(`  Sessions:     ${sessions.length}`);
      console.log(`  Turns:        ${allTurns.length}`);
      // Every turn left out (no priceable model, no anchor): no $0 figure.
      console.log(`  Total cost:   ${basisTag(total).priced ? moneyWithBasis(total.cost, total) : '—  (not priced — see below)'}`);
      for (const l of excludedLines(total)) console.log(l);
      console.log(`  Tokens:       ${formatTokens(tokensAll(total))} recorded (input + output + cache read + cache write)`);
      console.log('');

      if (costliestTurn) {
        const basis = costliest.basis === 'billing-grade'
          ? 'billing-grade'
          : 'estimated — Claude Code sent no cost for this turn';
        console.log(`  Costliest turn: #${costliestTurn.turn} (${costliestTurn.model})`);
        console.log(`    Cost: ${formatCost(costliest.usd)} (${basis})`);
        console.log('    Recorded tokens (context growth, not billed tokens):');
        console.log(`      Input: ${formatTokens(costliestTurn.input_tokens || 0)} | Output: ${formatTokens(costliestTurn.output_tokens || 0)}`);
        console.log(`      Cache read: ${formatTokens(costliestTurn.cache_read_tokens || 0)} | Cache write: ${formatTokens(costliestTurn.cache_write_tokens || 0)}`);
      }

      // Input side counted once per turn (RC 2026-09-28): the stored input
      // already includes cache reads and writes, so the old sum of all three
      // counted them twice. The label says so rather than naming the three
      // fields: adding the Input, Cache read and Cache write lines printed
      // above would repeat that double count.
      const contextTokens = allTurns.reduce((a, t) => a + inputSideTokens(t), 0);
      const cacheReads = total.cache_read_tokens;
      const share = contextTokens > 0 ? ((cacheReads / contextTokens) * 100).toFixed(0) : 0;

      console.log('');
      console.log(`  Cache-read share of recorded input-side tokens: ${share}%`);
      console.log('    (input side, each token counted once; context occupancy, not a hit rate)');
      console.log('');
    });
}
