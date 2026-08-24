import { getSessionsForDateRange } from '../utils/sessions.js';
import { agentDailyRunRate } from '../utils/agentpool.js';
import { loadConfig, getPlanKey, isDualPoolActive, AGENT_SDK_POOL_PAUSED_NOTE } from '../utils/config.js';
import { getLatestPricing } from '../utils/pricing.js';
import { formatCost } from '../utils/cost.js';
import { output } from './_summary.js';
import { daysAgo } from './_summary.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude forecast` — Agent-SDK-pool spend forecast.
//
// REWRITTEN 2026-08-24. This command used to print a countdown to the June-15
// Agent-SDK billing split and, from June 15 onward, the sentence "June-15
// billing split (2026-06-15) is now active." That split was announced and then
// PAUSED by Anthropic, and the pause still holds — so from mid-June this command
// has been telling users something that did not happen, and comparing their
// spend against an included-credit allowance that does not exist. It now states
// the pause and forecasts the spend itself, which is still a real number.
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
      const splitActive = isDualPoolActive();

      if (o.json) {
        output(JSON.stringify({
          schema_version: SCHEMA_VERSION,
          estimate: true, method: 'linear-runrate', lookback_days: lookback,
          agent_days_with_data: rr.days,
          avg_agent_usd_per_day: round(rr.avgPerDay),
          projected_monthly_agent_usd: round(projectedMonthly),
          plan: planKey,
          agent_sdk_split_active: splitActive,
          agent_sdk_split_status: splitActive ? 'active' : 'paused',
          included_agent_credits_monthly: splitActive ? included : null,
          projected_overage_usd: splitActive && included != null ? round(Math.max(0, projectedMonthly - included)) : null,
          note: splitActive ? null : AGENT_SDK_POOL_PAUSED_NOTE,
        }, null, 2), o);
        return;
      }

      const lines = ['\n  Agent-SDK spend forecast  (estimate — not plan-fit)', '  ' + '='.repeat(50)];
      lines.push('');
      if (!splitActive) {
        lines.push('  The Agent-SDK credit split announced for June 15, 2026 is PAUSED.');
        lines.push('  SDK, `claude -p` and third-party usage still draw your subscription\'s');
        lines.push('  ordinary usage limits, not a separate credit pool.');
        lines.push('');
        lines.push('  The spend below is real and billing-grade; what is paused is the');
        lines.push('  separate wallet it would have been billed to.');
      }
      lines.push('');
      if (rr.days === 0) {
        lines.push('  No turns in the look-back window were recorded against the Agent-SDK');
        lines.push('  pool, so there is nothing to forecast. Interactive Claude Code turns');
        lines.push('  draw subscription limits — and while the split is paused, so does');
        lines.push('  everything else.');
        lines.push('');
        output(lines.join('\n'), o);
        return;
      }
      lines.push(`  Look-back:        last ${lookback} days (${rr.days} with agent-pool spend)`);
      lines.push(`  Avg agent/day:    ${formatCost(rr.avgPerDay)}  (estimate)`);
      lines.push(`  Projected/month:  ${formatCost(projectedMonthly)}  (≈ avg × 30, estimate)`);
      if (splitActive && included != null) {
        const overage = projectedMonthly - included;
        lines.push(`  Included (${plan.label}): $${included}/mo (no rollover)`);
        if (overage > 0) lines.push(`  Projected overage: ${formatCost(overage)} beyond included — estimate only.`);
        else lines.push(`  Projected to stay within included credits (est. headroom ${formatCost(-overage)}).`);
      } else if (!splitActive) {
        lines.push('  No included-credit comparison is shown, because there is no separate');
        lines.push('  Agent-SDK credit allowance in effect to compare against.');
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
