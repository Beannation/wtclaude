import { getSessionsForDateRange } from '../utils/sessions.js';
import { fableDailyRunRate } from '../utils/fablepool.js';
import { getFableCliffDate, daysUntil } from '../utils/config.js';
import { formatCost, formatTokens } from '../utils/cost.js';
import { output, daysAgo } from './_summary.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude fable` — the post-June-22 "Fable cliff" cost forecast (FABLE-001
// PART 2). Reuses the BUILD-005 readiness pattern but stays a SEPARATE stream
// from `forecast`: interactive Fable bills the usage-credits wallet after the
// cliff; the Agent-SDK credit pool is a different wallet with its own countdown.
//
// EXPLICITLY a labeled estimate/forecast, scoped to "if the announced $10/$50
// post-June-22 pricing holds" — Anthropic may extend the included window or
// restore inclusion. ANCHORED on the payload cost field: the PART-1 capture
// proved the free-window statusline reports a non-zero notional Fable cost at
// the real rates (cache reads + thinking tokens already baked in), so the
// accumulated notional IS the post-cliff charge for the same usage. Token math
// is only the fallback for anchor-less records (and understates thinking).

export function registerFable(program) {
  program
    .command('fable')
    .description('Estimate what your Fable 5 usage will cost once the included window ends June 23 (labeled estimate)')
    .option('--json', 'Output machine-readable JSON')
    .option('--days <n>', 'Look-back window for the run-rate', '7')
    .action((opts) => {
      const o = opts || {};
      const lookback = Math.max(1, parseInt(o.days, 10) || 7);
      const start = daysAgo(lookback - 1);
      const today = localDate(); // local calendar date (QA-BUG-10)
      const turns = getSessionsForDateRange(start, today).flatMap(s => s.turns);
      const rr = fableDailyRunRate(turns);

      const projectedMonthly = rr.avgPerDay * 30;
      const cliff = getFableCliffDate();
      const countdown = daysUntil(cliff, today);

      if (o.json) {
        output(JSON.stringify({
          schema_version: SCHEMA_VERSION,
          estimate: true, method: 'linear-runrate-anchored', lookback_days: lookback,
          fable_days_with_data: rr.days,
          fable_turns: rr.fableTurns,
          anchored_turns: rr.anchoredTurns,
          estimated_turns: rr.estimatedTurns,
          fable_usd_in_window: round(rr.sum),
          avg_fable_usd_per_day: round(rr.avgPerDay),
          projected_monthly_fable_usd: round(projectedMonthly),
          fable_tokens: {
            input: rr.tokens.input, output: rr.tokens.output,
            cache_read: rr.tokens.cacheRead, cache_write: rr.tokens.cacheWrite,
          },
          cliff_date: cliff, days_until_cliff: countdown,
          pricing_assumption: 'announced post-June-22 rates: $10/MTok in, $1 cached, $50/MTok out — subject to change',
        }, null, 2), o);
        return;
      }

      const lines = ['\n  Fable 5 cost forecast  (estimate — the June-23 "Fable cliff")', '  ' + '='.repeat(58)];
      lines.push('');
      if (countdown != null && countdown > 0) {
        lines.push(`  Fable 5 is included with your plan until ${cliff} — ${countdown} day${countdown === 1 ? '' : 's'} away.`);
        lines.push('  After that, interactive Fable use bills usage credits from token #1.');
      } else {
        lines.push(`  The Fable included window has ended (${cliff}) — interactive Fable use`);
        lines.push('  now bills usage credits from token #1.');
      }
      lines.push('');
      if (rr.fableTurns === 0) {
        lines.push('  No Fable 5 turns in the look-back window, so there is nothing to');
        lines.push('  forecast yet. Select it with /model fable (Claude Code 2.1.170+).');
        lines.push('');
        output(lines.join('\n'), o);
        return;
      }
      lines.push(`  Look-back:         last ${lookback} days (${rr.days} with Fable use, ${rr.fableTurns} turns)`);
      lines.push(`  Fable in window:   ${formatCost(rr.sum)}  (statusline notional — what this usage`);
      lines.push('                     would cost in usage credits after the cliff)');
      lines.push(`  Avg Fable/day:     ${formatCost(rr.avgPerDay)}  (estimate)`);
      lines.push(`  Projected/month:   ${formatCost(projectedMonthly)}  (≈ avg × 30, estimate)`);
      lines.push(`  Fable tokens:      ${formatTokens(rr.tokens.input)} in · ${formatTokens(rr.tokens.output)} out · ${formatTokens(rr.tokens.cacheRead)} cache-read`);
      if (rr.estimatedTurns > 0) {
        lines.push(`  ${rr.estimatedTurns} of ${rr.fableTurns} turns had no cost anchor — those use token × rate math,`);
        lines.push('  which understates thinking-heavy turns.');
      }
      lines.push('');
      lines.push('  Estimate only — holds if the announced $10/$50 post-June-22 pricing');
      lines.push('  holds (Anthropic may extend the window or restore inclusion). Separate');
      lines.push('  from the Agent-SDK credit pool — see `wtclaude forecast` for that.');
      lines.push('');
      output(lines.join('\n'), o);
    });
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }
