import { getSessionsForDateRange } from '../utils/sessions.js';
import { poolSpend, getExtraUsage, fastModeLabel, fastPoolText } from '../utils/agentpool.js';
import { amountWithBasis, excludedLines, costBasisJson, costBasisBadge } from '../utils/format.js';
import { loadConfig, getPlanKey, getDualPoolActivationDate, isDualPoolActive, AGENT_SDK_POOL_PAUSED_NOTE } from '../utils/config.js';
import { getLatestPricing } from '../utils/pricing.js';
import { formatCost } from '../utils/cost.js';
import { output } from './_summary.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude credits` — Agent-SDK + fast-mode credit usage (build-spec M4, M7).
// The Agent-SDK split announced for June 15, 2026 was PAUSED and never took
// effect, so that pool is shown as paused (the spend is still recorded); if
// the split is ever switched on, the same view shows balance/burn. Fast-mode
// usage credits exist today, so that pool is always shown live.
//
// CORRECTED 2026-09-28 (QA-0928-75/76/77): the description and JSON no longer
// frame the paused split as a countdown; the OAuth `extra_usage` balance is
// NOT fetched by anything (sync included), so we no longer tell users to
// "enable sync to populate" it; and inferred fast-mode spend is labelled
// inferred, as `today` labels it, never billing-grade.
//
// FIXED 2026-09-28 (RC, QA-0928-54): both pools cost each turn the way `today`
// does. "(billing-grade)" is printed only when every priced turn in the pool
// is anchored; estimates say so; unanchored turns on a model this version
// cannot price are left out and named under "Not priced".

export function registerCredits(program) {
  program
    .command('credits')
    .description('Agent-SDK + fast-mode credit usage (split paused)')
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

      const planKey = getPlanKey();
      const pricing = getLatestPricing();
      const plan = planKey && pricing.plans[planKey] ? pricing.plans[planKey] : null;
      const includedCredits = plan ? plan.agent_sdk_credits_monthly : null;

      if (o.json) {
        output(JSON.stringify({
          schema_version: SCHEMA_VERSION,
          dual_pool_active: active,
          split_status: active ? 'active' : 'paused',
          // The date the split was ANNOUNCED for — history, not a countdown
          // target, so there is no days-until figure (it read -105).
          announced_activation_date: activation,
          days_until_activation: null,
          plan: planKey, included_agent_credits_monthly: includedCredits,
          month_to_date: {
            agent_sdk_usd: round(spend.agent),
            agent_sdk_label: costBasisBadge(spend.agentBasis).label,
            agent_sdk_cost_basis: costBasisJson(spend.agentBasis),
            fast_mode_usd: round(spend.fast),
            fast_mode_label: spend.fastTurns > 0 ? fastModeLabel(spend).label : null,
            fast_mode_cost_basis: costBasisJson(spend.fastBasis),
            subscription_usd: round(spend.subscription),
          },
          oauth_extra_usage: extra,
          rate_basis: 'at standard API list rates; bundle discounts up to 30% and promos not reflected',
        }, null, 2), o);
        return;
      }

      const lines = ['\n  Credits', '  ======='];

      // ── Agent-SDK dollar-credit pool ──
      lines.push('');
      lines.push('  Agent-SDK credit pool');
      lines.push('  ---------------------');
      if (!active) {
        // NOT "coming soon on a date" — it was announced for June 15 and paused,
        // with no new date. Saying "activates <date>" would restate a schedule
        // that Anthropic withdrew.
        lines.push('  PAUSED. ' + AGENT_SDK_POOL_PAUSED_NOTE.replace(/^The Agent-SDK credit split /, 'The split ')); 
        lines.push('  Your Agent-SDK spend is still recorded, so this view is accurate if it');
        lines.push('  ever switches on.');
        lines.push(`  Recorded so far this month: ${amountWithBasis(spend.agent, spend.agentBasis)}.`);
      } else {
        lines.push(`  Spent this month: ${amountWithBasis(spend.agent, spend.agentBasis)} across ${spend.agentTurns} turn${spend.agentTurns === 1 ? '' : 's'}.`);
        if (includedCredits != null) {
          const remaining = Math.max(0, includedCredits - spend.agent);
          lines.push(`  Included with ${plan.label}: $${includedCredits}/mo · est. remaining ${formatCost(remaining)} (no rollover).`);
        } else {
          lines.push('  Set your plan at `wtclaude setup` to see remaining included credits.');
        }
      }
      lines.push(...excludedLines(spend.agentBasis));

      // ── Fast-mode usage credits (live today) ──
      lines.push('');
      lines.push('  Fast-mode usage credits');
      lines.push('  -----------------------');
      if (spend.fast > 0) {
        lines.push(`  Spent this month: ${fastPoolText(spend)}.`);
      } else if (spend.fastBasis.excluded_turns > 0 && spend.fastTurns === 0) {
        lines.push('  Spent this month: — (not priced).');
      } else {
        lines.push('  No fast-mode spend this month.');
      }
      lines.push(...excludedLines(spend.fastBasis));

      // ── OAuth extra_usage (cached aggregate) ──
      if (extra) {
        lines.push('');
        lines.push('  Reported balance (OAuth extra_usage · aggregate)');
        lines.push('  ------------------------------------------------');
        const u = extra.used_credits != null ? `${extra.currency} ${extra.used_credits}` : '—';
        const l = extra.monthly_limit != null ? `${extra.currency} ${extra.monthly_limit}` : '—';
        lines.push(`  Used ${u} of ${l}${extra.as_of ? ` · as of ${extra.as_of}` : ' · staleness unknown'}.`);
        lines.push('  (Aggregate across surfaces, not fast-isolated.)');
      } else {
        lines.push('');
        lines.push("  (WTClaude can't read your usage-credit balance yet — check it in Claude's");
        lines.push('   usage settings. The figures above are your locally recorded spend.)');
      }
      // R-27: pre-purchased usage bundles cut the effective rate by up to 30%
      // ($50->$45, $250->$200, $1000->$700) and local data cannot see which
      // bundle a user holds, so any credits figure we print at list rates can
      // overstate the real cost invisibly. Anthropic's own /usage carries the
      // same limitation and says so.
      lines.push('');
      lines.push('  Figures are at standard API list rates; bundle discounts up to 30% and');
      lines.push('  promos not reflected.');
      lines.push('');
      output(lines.join('\n'), o);
    });
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }
