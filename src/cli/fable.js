import { getSessionsForDateRange } from '../utils/sessions.js';
import { fableDailyRunRate, fableAttribution } from '../utils/fablepool.js';
import {
  getPlanKey, getFableBilling, getFablePromoCredits, getFablePermanentSince,
  isFableAvailable, getFableUnavailableNote, daysUntil,
} from '../utils/config.js';
import { formatCost, formatTokens } from '../utils/cost.js';
import { output, daysAgo } from './_summary.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude fable` — what your Fable 5 usage costs, or would cost.
//
// REWRITTEN 2026-08-24. This command used to be a countdown to a "Fable cliff":
// a date after which Fable use started billing usage credits. Since 2026-07-20
// Fable 5 is permanent and plan-conditional, so there is no cliff and no
// countdown — there is a rule that depends on which plan you are on:
//
//   Max · Team Premium · Enterprise Premium  → included, up to 50% of the weekly
//     usage limit. That is a share OF the weekly limit, not an allowance on top
//     of it, and it is not a credits wallet. No bill.
//   Pro · Team Standard                      → usage credits from token #1.
//   Enterprise Standard                      → usage credits only if the
//     organisation enabled Fable; never promo-eligible.
//
// When we do not know the plan we show BOTH readings and say which is which. We
// never guess, because the two answers differ by the entire bill.
//
// The dollar figure is ANCHORED on the payload cost field: the PART-1 capture
// proved the statusline reports a non-zero notional Fable cost at the real rates
// (cache reads and thinking tokens already baked in). Token math is only the
// fallback for anchor-less records, and it understates thinking-heavy turns.

const ESTIMATE_LABEL = 'at standard API list rates; bundle discounts up to 30% and promos not reflected';

export function registerFable(program) {
  program
    .command('fable')
    .description('What your Fable 5 usage costs — included on Max/Team-Premium, usage credits on Pro/Team-Standard (labeled estimate)')
    .option('--json', 'Output machine-readable JSON')
    .option('--days <n>', 'Look-back window for the run-rate', '7')
    .option('--plan <plan>', 'Override the configured plan (pro, max5, max20, team_standard, team_premium)')
    .action((opts) => {
      const o = opts || {};

      if (!isFableAvailable()) {
        if (o.json) {
          output(JSON.stringify({
            schema_version: SCHEMA_VERSION,
            available: false, estimate: false, message: getFableUnavailableNote(),
          }, null, 2), o);
          return;
        }
        output(['\n  Fable 5 cost forecast — paused', '  ' + '='.repeat(58), '',
          '  ' + getFableUnavailableNote(), ''].join('\n'), o);
        return;
      }

      const lookback = Math.max(1, parseInt(o.days, 10) || 7);
      const start = daysAgo(lookback - 1);
      const today = localDate(); // local calendar date (QA-BUG-10)
      const turns = getSessionsForDateRange(start, today).flatMap(s => s.turns);
      const rr = fableDailyRunRate(turns);

      const planKey = o.plan ? normalizePlanFlag(o.plan) : getPlanKey();
      const billing = getFableBilling(planKey);
      const attribution = fableAttribution(turns, planKey);
      const projectedMonthly = rr.avgPerDay * 30;
      const promo = getFablePromoCredits();
      const daysToPromoExpiry = daysUntil(promo.expiry_date, today);

      if (o.json) {
        output(JSON.stringify({
          schema_version: SCHEMA_VERSION,
          estimate: true, method: 'linear-runrate-anchored', lookback_days: lookback,
          plan: planKey, plan_known: !!planKey,
          fable_billing: billing,
          fable_permanent_since: getFablePermanentSince(),
          fable_days_with_data: rr.days,
          fable_turns: rr.fableTurns,
          anchored_turns: rr.anchoredTurns,
          estimated_turns: rr.estimatedTurns,
          fable_usd_in_window: round(rr.sum),
          avg_fable_usd_per_day: round(rr.avgPerDay),
          projected_monthly_fable_usd: round(projectedMonthly),
          usd_is_a_charge: billing === 'usage_credits',
          usd_label: billing === 'included_weekly'
            ? 'list-rate equivalent of included usage — not a charge'
            : ESTIMATE_LABEL,
          attribution_by_billing: attribution.byBilling,
          fable_tokens: {
            input: rr.tokens.input, output: rr.tokens.output,
            cache_read: rr.tokens.cacheRead, cache_write: rr.tokens.cacheWrite,
          },
          included_share_of_weekly_limit: 0.5,
          promo_credits: { ...promo, days_until_expiry: daysToPromoExpiry },
          pricing_assumption: 'Fable 5 list rates: $10/MTok in, $1 cached, $50/MTok out',
        }, null, 2), o);
        return;
      }

      const lines = ['\n  Fable 5 — what your usage costs  (estimate)', '  ' + '='.repeat(58), ''];

      // ── the rule, stated per plan ──
      if (billing === 'included_weekly') {
        lines.push('  On your plan, Fable 5 is included — up to 50% of your weekly usage');
        lines.push('  limit. That is a share of the weekly limit, not an allowance on top of');
        lines.push('  it, and it is not a credits wallet. Fable use does not produce a bill.');
      } else if (billing === 'usage_credits') {
        lines.push('  On your plan, Fable 5 bills usage credits from the first token, at');
        lines.push('  $10/MTok in ($1 cached) and $50/MTok out.');
      } else if (billing === 'org_conditional') {
        lines.push('  On Enterprise Standard, Fable 5 bills usage credits only if your');
        lines.push('  organisation has enabled it. Enterprise Standard seats are never');
        lines.push('  eligible for Fable promotional credits.');
      } else {
        lines.push('  Fable 5 has been permanent and plan-conditional since July 20, 2026,');
        lines.push('  so what it costs you depends on your plan — and no plan is configured,');
        lines.push('  so both readings are shown below. Set one with `wtclaude setup`.');
        lines.push('');
        lines.push('    Max · Team Premium · Ent Premium  included, up to 50% of the weekly');
        lines.push('                                      limit — no bill');
        lines.push('    Pro · Team Standard               usage credits from token #1');
      }
      lines.push('');

      if (rr.fableTurns === 0) {
        lines.push('  No Fable 5 turns in the look-back window, so there is nothing to');
        lines.push('  measure yet. Select it with /model fable (Claude Code 2.1.170+).');
        lines.push('');
        pushPromo(lines, promo, daysToPromoExpiry);
        output(lines.join('\n'), o);
        return;
      }

      lines.push(`  Look-back:         last ${lookback} days (${rr.days} with Fable use, ${rr.fableTurns} turns)`);
      lines.push('');

      // Money, split by how each turn ACTUALLY billed. A single blended figure
      // would be wrong here: a window can contain turns from before the
      // 2026-07-20 permanence change (included for everyone under the old rule)
      // and turns after it (plan-conditional). Labelling the whole window with
      // today's plan rule would call historically-included usage a charge.
      const BILLING_LINES = {
        included_weekly:     'included on your plan (up to 50% of the weekly limit) — not a charge',
        included_historical: 'included under the pre-Jul-20 mechanic — not a charge',
        usage_credits:       'usage credits (estimate)',
        org_conditional:     'usage credits IF your org enabled Fable (estimate)',
      };
      const order = ['usage_credits', 'org_conditional', 'included_weekly', 'included_historical', 'unknown'];
      let charged = 0;
      for (const kind of order) {
        const b = attribution.byBilling[kind];
        if (!b || b.turns === 0) continue;
        if (kind === 'unknown') {
          lines.push(`  ${formatCost(b.usd).padEnd(10)} ${b.turns} turn${b.turns === 1 ? '' : 's'} after Jul-20 — depends on your plan:`);
          lines.push('               · Max / Team Premium / Ent Premium: included, no charge');
          lines.push('               · Pro / Team Standard: that much in usage credits');
          continue;
        }
        if (kind === 'usage_credits' || kind === 'org_conditional') charged += b.usd;
        lines.push(`  ${formatCost(b.usd).padEnd(10)} ${b.turns} turn${b.turns === 1 ? '' : 's'} — ${BILLING_LINES[kind]}`);
      }
      lines.push('');
      if (charged > 0) {
        lines.push(`  Billed in window:  ${formatCost(charged)} in usage credits,`);
        lines.push(`                     ${ESTIMATE_LABEL}.`);
      }
      lines.push(`  Run-rate:          ${formatCost(rr.avgPerDay)}/day · ${formatCost(projectedMonthly)}/month at Fable list`);
      lines.push('                     rates (≈ avg × 30, estimate). Whether that is a bill');
      lines.push('                     or included usage is the plan question above.');
      lines.push(`  Fable tokens:      ${formatTokens(rr.tokens.input)} in · ${formatTokens(rr.tokens.output)} out · ${formatTokens(rr.tokens.cacheRead)} cache-read`);

      if (rr.estimatedTurns > 0) {
        lines.push('');
        lines.push(`  ${rr.estimatedTurns} of ${rr.fableTurns} turns had no cost anchor — those use token × rate math,`);
        lines.push('  which understates thinking-heavy turns. Thinking cannot be disabled on');
        lines.push('  Fable 5.');
      }

      lines.push('');
      pushPromo(lines, promo, daysToPromoExpiry);
      output(lines.join('\n'), o);
    });
}

// Fable promotional credits. Facts only: claiming closed, the expiry is fixed
// regardless of claim date, and they are spent ahead of other credits silently.
// We do NOT say anything about credits consumed or refunded during the Fable
// mis-gating episode — that has never had an Anthropic-primary source.
function pushPromo(lines, promo, daysToExpiry) {
  lines.push('  Fable promotional credits');
  lines.push(`    Claiming closed ${promo.claiming_closed}. Credits expire ${promo.expiry_date} at 11:59 PM PT,`);
  lines.push('    regardless of when they were claimed' + (daysToExpiry != null && daysToExpiry >= 0
    ? ` — ${daysToExpiry} day${daysToExpiry === 1 ? '' : 's'} from today.` : '.'));
  lines.push('    They are spent before your other credits, including auto-reload, and');
  lines.push('    that happens silently.');
  lines.push('');
}

function normalizePlanFlag(raw) {
  const norm = String(raw).toLowerCase().replace(/[\s-]/g, '_');
  const map = {
    pro: 'pro', max5: 'max_5x', max_5x: 'max_5x', max20: 'max_20x', max_20x: 'max_20x',
    team: 'team_standard', team_standard: 'team_standard',
    team_premium: 'team_premium',
    enterprise_standard: 'enterprise_standard', enterprise_premium: 'enterprise_premium',
  };
  return map[norm] || norm;
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }
