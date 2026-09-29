import { getSessionsForDateRange } from '../utils/sessions.js';
import { poolSpend, agentDailyRunRate } from '../utils/agentpool.js';
import { loadConfig, getPlanKey, getDualPoolActivationDate, isDualPoolActive } from '../utils/config.js';
import { getLatestPricing } from '../utils/pricing.js';
import { formatCost } from '../utils/cost.js';
import { amountWithBasis, costBasisJson, excludedLines } from '../utils/format.js';
import { output } from './_summary.js';
import { localDate } from '../utils/time.js';
import { windowStart, splitHistory, coveredDays, projectionNote } from '../utils/window.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude readiness` — BUILD-005. Billing-split readiness report: are we
// recording the right data for a billing split, and what's the
// (estimate-labeled) Agent-SDK spend picture. Narrow, no plan-fit.
//
// CORRECTED 2026-09-28 (QA-0928-75/73). This was the one-time "June-14
// Readiness Report" ahead of the June-15 split; that split was paused and
// never took effect, so the report no longer frames it as a countdown (the JSON
// carried days_until_activation: -105). Its monthly projection used the
// average over days WITH agent spend across all history since 1970; it now
// projects from a bounded 30-day look-back over the days it covers.
//
// FIXED 2026-09-28 (RC, QA-0928-54): recorded and projected agent spend count
// priced turns only, each amount carries its basis, and unanchored turns on a
// model we cannot price are named under "Not priced".
const OUTLOOK_DAYS = 30;

function fieldCoverage(turns, field) {
  let withVal = 0;
  for (const t of turns) if (t[field] != null) withVal++;
  return { withVal, total: turns.length, pct: turns.length ? Math.round((withVal / turns.length) * 100) : 0 };
}

export function registerReadiness(program) {
  program
    .command('readiness')
    .description('Billing-split readiness report (split paused; estimate-labeled)')
    .option('--json', 'Output machine-readable JSON')
    .action((opts) => {
      const o = opts || {};
      const today = localDate(); // local calendar date (QA-BUG-10)
      const allSessions = getSessionsForDateRange('0000-01-01', today);
      const turns = allSessions.flatMap(s => s.turns);
      const cfg = loadConfig();
      const activation = getDualPoolActivationDate();
      const active = isDualPoolActive(today);

      const spend = poolSpend(turns);
      const recent = splitHistory(allSessions, windowStart(OUTLOOK_DAYS), today);
      const covered = coveredDays(OUTLOOK_DAYS, recent.firstDate, today) ?? OUTLOOK_DAYS;
      const rr = agentDailyRunRate(recent.sessions.flatMap(s => s.turns), { coveredDays: covered });
      // No projection from spend that is older than the look-back.
      const projectedMonthly = rr.days > 0 ? rr.avgPerDay * 30 : null;
      const planKey = getPlanKey();
      const pricing = getLatestPricing();
      const plan = planKey && pricing.plans[planKey] ? pricing.plans[planKey] : null;
      const included = plan ? plan.agent_sdk_credits_monthly : null;

      // The day-one fields that must be flowing so no backfill would be needed
      // if a split ever takes effect (the June-15 one is paused).
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
          estimate: true, generated_for: today,
          split_status: active ? 'active' : 'paused',
          announced_activation_date: activation,
          days_until_activation: null, dual_pool_active: active,
          plan: planKey, plan_set: planSet, included_agent_credits_monthly: included,
          turns_recorded: turns.length,
          field_coverage: fields,
          agent_pool: {
            spent_total_usd: round(spend.agent),
            cost_basis: costBasisJson(spend.agentBasis),
            lookback_days: OUTLOOK_DAYS,
            covered_days: covered,
            projected_monthly_usd: round(projectedMonthly),
            projected_overage_usd: included != null && projectedMonthly != null ? round(Math.max(0, projectedMonthly - included)) : null,
          },
          fast_mode_spent_usd: round(spend.fast),
          fast_mode_cost_basis: costBasisJson(spend.fastBasis),
        }, null, 2), o);
        return;
      }

      const lines = ['\n  Billing-split readiness report  (estimate-labeled)', '  ' + '='.repeat(50)];
      lines.push('');
      if (active) lines.push(`  Billing split ${activation} is active.`);
      else lines.push('  Billing split: PAUSED (announced for ' + activation + ', never took effect).');
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
      // QA-0928-170: setup records enterprise_* plans, which the rate sheet's
      // plans block has no row for (no CLI surface prices them), so `plan` is
      // null there; name the key instead of crashing on plan.label.
      const planLabel = plan ? plan.label : String(planKey).split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      lines.push(`  Plan tier set:     ${planSet ? planLabel : 'no — run `wtclaude setup`'}`);
      lines.push('');
      lines.push('  Agent-SDK outlook (estimate):');
      const agentAmount = amountWithBasis(spend.agent, spend.agentBasis);
      if (spend.agentTurns === 0 && spend.agentBasis.excluded_turns === 0) {
        lines.push('    No agent-pool spend recorded yet — nothing to project.');
      } else if (rr.days === 0) {
        lines.push(`    Recorded agent spend:  ${agentAmount}`);
        lines.push(rr.agentTurns > 0
          ? `    No priced agent-pool spend in the last ${OUTLOOK_DAYS} days — no projection.`
          : `    No agent-pool spend in the last ${OUTLOOK_DAYS} days — no projection.`);
      } else {
        lines.push(`    Recorded agent spend:  ${agentAmount}`);
        lines.push(`    Projected/month:       ${formatCost(projectedMonthly)}  (≈ avg × 30; ${projectionNote(covered, OUTLOOK_DAYS)})`);
        if (included != null) {
          const overage = projectedMonthly - included;
          lines.push(overage > 0
            ? `    vs included $${included}: est. overage ${formatCost(overage)}`
            : `    vs included $${included}: est. within credits (headroom ${formatCost(-overage)})`);
        }
      }
      lines.push(...excludedLines(spend.agentBasis).map(l => '  ' + l));
      if (spend.fast > 0) lines.push(`    Fast-mode spend:       ${amountWithBasis(spend.fast, spend.fastBasis)}`);
      lines.push(...excludedLines(spend.fastBasis).map(l => '  ' + l));
      lines.push('');
      lines.push('  Estimate only (usage_pool is heuristic; linear run-rate). No plan-fit.');
      lines.push('');
      output(lines.join('\n'), o);
    });
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }
