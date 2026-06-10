import { getSessionsForDateRange } from '../utils/sessions.js';
import { agentDailyRunRate } from '../utils/agentpool.js';
import { loadConfig, getPlanKey, getDualPoolActivationDate, daysUntil } from '../utils/config.js';
import { getLatestPricing } from '../utils/pricing.js';
import { formatCost } from '../utils/cost.js';
import { output } from './_summary.js';
import { daysAgo } from './_summary.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude forecast` — BUILD-005, launch-critical. A daily pre-June-15
// Agent-SDK-pool spend forecast vs included credits + a June-15 countdown.
//
// EXPLICITLY a labeled estimate/forecast: usage_pool is a heuristic and this is a
// simple linear run-rate, NOT the Phase-1 predictive/plan-fit engine. We project
// the recent agent-pool daily average across the month and compare to the plan's
// included Agent-SDK credits. No recommendations, no anomaly detection.

export function registerForecast(program) {
  program
    .command('forecast')
    .description('Estimate Agent-SDK credit spend vs included credits + June-15 countdown (labeled estimate)')
    .option('--json', 'Output machine-readable JSON')
    .option('--days <n>', 'Look-back window for the run-rate', '7')
    .action((opts) => {
      const o = opts || {};
      const lookback = Math.max(1, parseInt(o.days, 10) || 7);
      const start = daysAgo(lookback - 1);
      const today = localDate(); // local calendar date (QA-BUG-10)
      const turns = getSessionsForDateRange(start, today).flatMap(s => s.turns);
      const rr = agentDailyRunRate(turns);

      const projectedMonthly = rr.avgPerDay * 30;
      const cfg = loadConfig();
      const planKey = getPlanKey();
      const pricing = getLatestPricing();
      const plan = planKey && pricing.plans[planKey] ? pricing.plans[planKey] : null;
      const included = plan ? plan.agent_sdk_credits_monthly : null;
      const activation = getDualPoolActivationDate();
      const countdown = daysUntil(activation, today);

      if (o.json) {
        output(JSON.stringify({
          schema_version: SCHEMA_VERSION,
          estimate: true, method: 'linear-runrate', lookback_days: lookback,
          agent_days_with_data: rr.days,
          avg_agent_usd_per_day: round(rr.avgPerDay),
          projected_monthly_agent_usd: round(projectedMonthly),
          plan: planKey, included_agent_credits_monthly: included,
          projected_overage_usd: included != null ? round(Math.max(0, projectedMonthly - included)) : null,
          activation_date: activation, days_until_activation: countdown,
        }, null, 2), o);
        return;
      }

      const lines = ['\n  Agent-SDK spend forecast  (estimate — not plan-fit)', '  ' + '='.repeat(50)];
      lines.push('');
      if (countdown != null && countdown >= 0) {
        lines.push(`  June-15 billing split: ${activation} — ${countdown} day${countdown === 1 ? '' : 's'} away.`);
      } else {
        lines.push(`  June-15 billing split (${activation}) is now active.`);
      }
      lines.push('');
      if (rr.days === 0) {
        lines.push('  No Agent-SDK-pool turns in the look-back window, so there is nothing to');
        lines.push('  forecast yet. (Interactive Claude Code turns bill from subscription');
        lines.push('  limits, not the Agent-SDK credit pool.)');
        lines.push('');
        output(lines.join('\n'), o);
        return;
      }
      lines.push(`  Look-back:        last ${lookback} days (${rr.days} with agent-pool spend)`);
      lines.push(`  Avg agent/day:    ${formatCost(rr.avgPerDay)}  (estimate)`);
      lines.push(`  Projected/month:  ${formatCost(projectedMonthly)}  (≈ avg × 30, estimate)`);
      if (included != null) {
        const overage = projectedMonthly - included;
        lines.push(`  Included (${plan.label}): $${included}/mo (no rollover)`);
        if (overage > 0) lines.push(`  Projected overage: ${formatCost(overage)} beyond included — estimate only.`);
        else lines.push(`  Projected to stay within included credits (est. headroom ${formatCost(-overage)}).`);
      } else {
        lines.push('  Set your plan at `wtclaude setup` to compare against included credits.');
      }
      lines.push('');
      lines.push('  Estimate only — simple linear run-rate; usage_pool is heuristic.');
      lines.push('');
      output(lines.join('\n'), o);
    });
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }
