import { getSessionsForDateRange } from '../utils/sessions.js';
import { poolSpend, agentDailyRunRate } from '../utils/agentpool.js';
import { loadConfig, getPlanKey, getDualPoolActivationDate, daysUntil, isDualPoolActive } from '../utils/config.js';
import { getLatestPricing } from '../utils/pricing.js';
import { formatCost } from '../utils/cost.js';
import { output } from './_summary.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude readiness` — BUILD-005, launch-critical. The one-time "June 14
// Readiness Report": are we recording the right data ahead of the billing split,
// and what's the (estimate-labeled) Agent-SDK spend picture. Narrow, no plan-fit.

function fieldCoverage(turns, field) {
  let withVal = 0;
  for (const t of turns) if (t[field] != null) withVal++;
  return { withVal, total: turns.length, pct: turns.length ? Math.round((withVal / turns.length) * 100) : 0 };
}

export function registerReadiness(program) {
  program
    .command('readiness')
    .description('The one-time June-14 Readiness Report (estimate-labeled, launch-critical)')
    .option('--json', 'Output machine-readable JSON')
    .action((opts) => {
      const o = opts || {};
      const today = localDate(); // local calendar date (QA-BUG-10)
      const turns = getSessionsForDateRange('1970-01-01', today).flatMap(s => s.turns);
      const cfg = loadConfig();
      const activation = getDualPoolActivationDate();
      const countdown = daysUntil(activation, today);
      const active = isDualPoolActive(today);

      const spend = poolSpend(turns);
      const rr = agentDailyRunRate(turns);
      const projectedMonthly = rr.avgPerDay * 30;
      const planKey = getPlanKey();
      const pricing = getLatestPricing();
      const plan = planKey && pricing.plans[planKey] ? pricing.plans[planKey] : null;
      const included = plan ? plan.agent_sdk_credits_monthly : null;

      // The day-one fields that must be flowing so no backfill is needed June 15.
      const fields = {
        usage_pool: fieldCoverage(turns, 'usage_pool'),
        billing_basis: fieldCoverage(turns, 'billing_basis'),
        rate_limit_5h_pct: fieldCoverage(turns, 'rate_limit_5h_pct'),
        device_id: fieldCoverage(turns, 'device_id'),
        git_branch: fieldCoverage(turns, 'git_branch'),
        task_category: fieldCoverage(turns, 'task_category'),
        edit_target_hash: fieldCoverage(turns, 'edit_target_hash'),
      };
      const planSet = !!planKey;

      if (o.json) {
        output(JSON.stringify({
          schema_version: SCHEMA_VERSION,
          estimate: true, generated_for: today, activation_date: activation,
          days_until_activation: countdown, dual_pool_active: active,
          plan: planKey, plan_set: planSet, included_agent_credits_monthly: included,
          turns_recorded: turns.length,
          field_coverage: fields,
          agent_pool: {
            spent_total_usd: round(spend.agent),
            projected_monthly_usd: round(projectedMonthly),
            projected_overage_usd: included != null ? round(Math.max(0, projectedMonthly - included)) : null,
          },
          fast_mode_spent_usd: round(spend.fast),
        }, null, 2), o);
        return;
      }

      const lines = ['\n  June-14 Readiness Report  (estimate-labeled)', '  ' + '='.repeat(44)];
      lines.push('');
      if (countdown != null && countdown >= 0) lines.push(`  Billing split ${activation} — ${countdown} day${countdown === 1 ? '' : 's'} away.`);
      else lines.push(`  Billing split ${activation} is now active.`);
      lines.push(`  Turns recorded to date: ${turns.length}`);
      lines.push('');
      lines.push('  Are we recording the right data? (captured day-one, no backfill)');
      const flag = (c) => c.total === 0 ? '—  (no data yet)' : c.withVal === 0 ? '○  null on current payloads' : `✓  ${c.pct}% of turns`;
      lines.push(`    usage_pool       ${flag(fields.usage_pool)}`);
      lines.push(`    billing_basis    ${flag(fields.billing_basis)}`);
      lines.push(`    rate_limits      ${flag(fields.rate_limit_5h_pct)}`);
      lines.push(`    device_id        ${flag(fields.device_id)}`);
      lines.push(`    git_branch       ${flag(fields.git_branch)}`);
      lines.push(`    task_category    ${flag(fields.task_category)}`);
      lines.push(`    edit_target_hash ${flag(fields.edit_target_hash)}`);
      lines.push('');
      lines.push(`  Plan tier set:     ${planSet ? plan.label : 'no — run `wtclaude setup`'}`);
      lines.push('');
      lines.push('  Agent-SDK outlook (estimate):');
      if (rr.days === 0) {
        lines.push('    No agent-pool spend recorded yet — nothing to project.');
      } else {
        lines.push(`    Recorded agent spend:  ${formatCost(spend.agent)}`);
        lines.push(`    Projected/month:       ${formatCost(projectedMonthly)}  (≈ avg × 30)`);
        if (included != null) {
          const overage = projectedMonthly - included;
          lines.push(overage > 0
            ? `    vs included $${included}: est. overage ${formatCost(overage)}`
            : `    vs included $${included}: est. within credits (headroom ${formatCost(-overage)})`);
        }
      }
      if (spend.fast > 0) lines.push(`    Fast-mode spend:       ${formatCost(spend.fast)}`);
      lines.push('');
      lines.push('  Estimate only (usage_pool is heuristic; linear run-rate). No plan-fit.');
      lines.push('');
      output(lines.join('\n'), o);
    });
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }
