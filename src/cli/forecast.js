import { getSessionsForDateRange } from '../utils/sessions.js';
import { agentDailyRunRate } from '../utils/agentpool.js';
import { loadConfig, getPlanKey, isDualPoolActive, AGENT_SDK_POOL_PAUSED_NOTE } from '../utils/config.js';
import { getLatestPricing } from '../utils/pricing.js';
import { formatCost } from '../utils/cost.js';
import { costBasisBadge, costBasisJson, excludedLines } from '../utils/format.js';
import { output } from './_summary.js';
import { localDate } from '../utils/time.js';
import { parseDaysOption, windowStart, splitHistory, coveredDays, projectionNote, windowLabel } from '../utils/window.js';
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
// the recent agent-pool daily average across the month; only if a split ever
// takes effect (agent_sdk_pool.activated) is that compared with an included
// credit allowance (QA-0928-118). No recommendations, no anomaly detection.
//
// FIXED 2026-09-28 (RC, QA-0928-54): the run-rate sums priced agent turns only
// (agentpool.js), the recorded spend carries the basis `today` would give it,
// and unanchored turns on a model we cannot price are named, never projected.

export function registerForecast(program) {
  program
    .command('forecast')
    .description('Agent-SDK spend forecast (split paused; labeled estimate)')
    .option('--json', 'Output machine-readable JSON')
    .option('--days <n>', 'Look-back window for the run-rate', parseDaysOption, 7)
    .action((opts) => {
      const o = opts || {};
      const lookback = o.days; // validated: a bad value is a usage error, never a silent clamp (QA-0928-74)
      const today = localDate(); // local calendar date (QA-BUG-10)
      // The look-back plus the first tracked day: the run-rate divides by the
      // days the data covers, not the days with agent spend (QA-0928-73).
      const history = splitHistory(getSessionsForDateRange('0000-01-01', today), windowStart(lookback), today);
      const turns = history.sessions.flatMap(s => s.turns);
      const covered = coveredDays(lookback, history.firstDate, today) ?? lookback;
      const rr = agentDailyRunRate(turns, { coveredDays: covered });

      const projectedMonthly = (rr.avgPerDay ?? 0) * 30;
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
          covered_days: covered,
          agent_days_with_data: rr.days,
          agent_turns: rr.agentTurns,
          agent_cost_basis: costBasisJson(rr.basis),
          avg_agent_usd_per_day: round(rr.avgPerDay ?? 0),
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
      }
      lines.push('');
      if (rr.days === 0 && rr.basis.excluded_turns > 0 && rr.basis.anchored_turns + rr.basis.estimated_turns === 0) {
        const n = rr.basis.excluded_turns;
        lines.push(`  ${n} agent-pool turn${n === 1 ? '' : 's'} in the look-back could not be priced, so there is nothing`);
        lines.push('  to forecast.');
        lines.push(...excludedLines(rr.basis));
        lines.push('');
        output(lines.join('\n'), o);
        return;
      }
      if (rr.days === 0) {
        lines.push('  No turns in the look-back window were recorded against the Agent-SDK');
        lines.push('  pool, so there is nothing to forecast. Interactive Claude Code turns');
        lines.push('  draw subscription limits — and while the split is paused, so does');
        lines.push('  everything else.');
        lines.push('');
        output(lines.join('\n'), o);
        return;
      }
      // FIXED 2026-09-28 (QA-0928-171): "The spend below is real and
      // billing-grade" printed above lines marked (estimate) — and above
      // "No turns …" when nothing followed. One label, only when there is spend.
      // RC 2026-09-28: the sentence states the recorded spend's real basis.
      const badge = costBasisBadge(rr.basis);
      if (badge.label === 'billing-grade') {
        lines.push('  Recorded agent-pool spend is billing-grade; the per-day average and');
        lines.push('  monthly projection are estimates.');
      } else if (badge.label === 'estimated') {
        lines.push('  Recorded agent-pool spend is a list-rate estimate (Claude Code sent no');
        lines.push('  cost for these turns); the per-day average and monthly projection are');
        lines.push('  estimates too.');
      } else {
        lines.push(`  Recorded agent-pool spend is ${badge.label} at list rates;`);
        lines.push('  the per-day average and monthly projection are estimates.');
      }
      lines.push('');
      lines.push(`  Look-back:        ${windowLabel(lookback)} (${rr.days} with agent-pool spend)`);
      lines.push(`  Recorded spend:   ${badge.tilde ? '~' : ''}${formatCost(rr.sum)}`);
      lines.push(`  Avg agent/day:    ${formatCost(rr.avgPerDay)}  (estimate; ${projectionNote(covered, lookback)})`);
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
      lines.push(...excludedLines(rr.basis));
      lines.push('');
      lines.push('  Estimate only — simple linear run-rate; usage_pool is heuristic.');
      lines.push('');
      output(lines.join('\n'), o);
    });
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }
