import { getSessionsForDateRange } from '../utils/sessions.js';
import { poolSpend, getExtraUsage } from '../utils/agentpool.js';
import { loadConfig, getPlanKey, getDualPoolActivationDate, isDualPoolActive, daysUntil } from '../utils/config.js';
import { getLatestPricing } from '../utils/pricing.js';
import { formatCost } from '../utils/cost.js';
import { output } from './_summary.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude credits` — Agent-SDK + fast-mode credit balance/burn (build-spec M4,
// M7). Follows the June-15 progressive disclosure (§8): pre-activation the
// Agent-SDK pool shows a "coming soon" + countdown state (data is still recorded
// in the background); post-activation it shows balance/burn. Fast-mode usage
// credits already exist today, so that pool is shown live in both phases.
//
// The OAuth `extra_usage` figure (the readable balance) is captured by sync as a
// cached aggregate; when present we show it with a staleness label, else we
// degrade to the local billing-grade spend and say so.

export function registerCredits(program) {
  program
    .command('credits')
    .description('Agent-SDK + fast-mode credit balance/burn (June-15 progressive disclosure)')
    .option('--json', 'Output machine-readable JSON')
    .action((opts) => {
      const o = opts || {};
      const cfg = loadConfig();
      const today = localDate(); // local calendar date (QA-BUG-10)
      const monthStart = today.slice(0, 8) + '01';
      const turns = getSessionsForDateRange(monthStart, today).flatMap(s => s.turns);
      const spend = poolSpend(turns);
      const extra = getExtraUsage(cfg);
      const activation = getDualPoolActivationDate();
      const active = isDualPoolActive(today);
      const countdown = daysUntil(activation, today);

      const planKey = getPlanKey();
      const pricing = getLatestPricing();
      const plan = planKey && pricing.plans[planKey] ? pricing.plans[planKey] : null;
      const includedCredits = plan ? plan.agent_sdk_credits_monthly : null;

      if (o.json) {
        output(JSON.stringify({
          schema_version: SCHEMA_VERSION,
          dual_pool_active: active,
          activation_date: activation,
          days_until_activation: countdown,
          plan: planKey, included_agent_credits_monthly: includedCredits,
          month_to_date: {
            agent_sdk_usd: round(spend.agent),
            fast_mode_usd: round(spend.fast),
            subscription_usd: round(spend.subscription),
          },
          oauth_extra_usage: extra,
        }, null, 2), o);
        return;
      }

      const lines = ['\n  Credits', '  ======='];

      // ── Agent-SDK dollar-credit pool ──
      lines.push('');
      lines.push('  Agent-SDK credit pool');
      lines.push('  ---------------------');
      if (!active) {
        const badge = countdown != null && countdown >= 0 ? `${countdown} day${countdown === 1 ? '' : 's'}` : 'soon';
        lines.push(`  Coming soon — activates ${activation} (in ${badge}).`);
        lines.push('  Your Agent-SDK spend is being recorded in the background now, so the');
        lines.push('  balance/burn view is accurate the moment it switches on.');
        lines.push(`  Recorded so far this month: ${formatCost(spend.agent)} (billing-grade).`);
      } else {
        lines.push(`  Spent this month: ${formatCost(spend.agent)} (billing-grade, ${spend.agentTurns} turns).`);
        if (includedCredits != null) {
          const remaining = Math.max(0, includedCredits - spend.agent);
          lines.push(`  Included with ${plan.label}: $${includedCredits}/mo · est. remaining ${formatCost(remaining)} (no rollover).`);
        } else {
          lines.push('  Set your plan at `wtclaude setup` to see remaining included credits.');
        }
      }

      // ── Fast-mode usage credits (live today) ──
      lines.push('');
      lines.push('  Fast-mode usage credits');
      lines.push('  -----------------------');
      if (spend.fast > 0) {
        lines.push(`  Spent this month: ${formatCost(spend.fast)} (billing-grade, ${spend.fastTurns} fast turns).`);
      } else {
        lines.push('  No fast-mode spend this month.');
      }

      // ── OAuth extra_usage (cached aggregate) ──
      if (extra) {
        lines.push('');
        lines.push('  Reported balance (OAuth extra_usage · aggregate)');
        lines.push('  ------------------------------------------------');
        const u = extra.used_credits != null ? `${extra.currency} ${extra.used_credits}` : '—';
        const l = extra.monthly_limit != null ? `${extra.currency} ${extra.monthly_limit}` : '—';
        lines.push(`  Used ${u} of ${l}${extra.as_of ? ` · as of ${extra.as_of}` : ' · staleness unknown'}.`);
        lines.push('  (Aggregate across surfaces, not fast-isolated; refreshed by sync.)');
      } else {
        lines.push('');
        lines.push('  (OAuth extra_usage balance not cached yet — enable sync to populate it;');
        lines.push('   the figures above are local billing-grade spend.)');
      }
      lines.push('');
      output(lines.join('\n'), o);
    });
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }
