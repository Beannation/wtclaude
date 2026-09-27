import { getSessionsForDateRange } from '../utils/sessions.js';
import { fableDailyRunRate, fableAttribution } from '../utils/fablepool.js';
import {
  getPlanKey, getFableBilling, getFablePromoCredits, getFablePermanentSince,
  isFableAvailable, getFableUnavailableNote, daysUntil,
} from '../utils/config.js';
import { formatCost, formatTokens } from '../utils/cost.js';
import { getRates, cacheReadMultiplier } from '../utils/pricing.js';
import { output, daysAgo } from './_summary.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude fable` — what your Fable usage costs, or would cost.
//
// FAMILY-SCOPED as of 2026-09-07. This command reports on Fable as a family, not
// on Fable 5 specifically: the plan mechanic is stated generically as "Fable" by
// Anthropic, so Fable 5.1 (Claude Code's default Fable model since v2.1.257)
// inherits it unchanged. Where a RATE is printed it is resolved per model from
// the rate sheet, never hard-coded — Fable 5 and Fable 5.1 share $10/$50 base
// rates but their cached input differs 4x ($1 vs $0.25 per MTok), so a single
// literal cached rate is wrong for one of them.
//
// REWRITTEN 2026-08-24. This command used to be a countdown to a "Fable cliff":
// a date after which Fable use started billing usage credits. Since 2026-07-20
// Fable is permanent and plan-conditional, so there is no cliff and no
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
    .description('What your Fable usage costs — included on Max/Team-Premium, usage credits on Pro/Team-Standard (labeled estimate)')
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
        output(['\n  Fable cost forecast — paused', '  ' + '='.repeat(58), '',
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
      const promoStatus = promo.status(new Date());
      // Clamped at 0: east of Pacific time the local date can already read
      // Sep 18 while the credits are still live until 11:59 PM PT on Sep 17.
      const daysToPromoExpiry = promoStatus === 'active' ? Math.max(0, daysUntil(promo.expiry_date, today)) : null;

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
          promo_credits: {
            status: promoStatus,
            expiry_date: promo.expiry_date, expires_at: promo.expires_at,
            claiming_closed: promo.claiming_closed,
            // The sheet's note is written in the past tense, so it is emitted only
            // once the instant has passed; before it, `status` + `expiry_date` say it.
            expiry_note: promoStatus === 'expired' ? promo.expiry_note : null,
            scope: promo.scope,
            applies_to_this_window: promo.appliesTo(Object.keys(rr.models)),
            // null once expired — a negative countdown is not a useful number.
            days_until_expiry: daysToPromoExpiry,
          },
          fable_models_in_window: rr.models,
          pricing_assumption: fableRateAssumption(rr.models),
          pricing_assumption_by_model: fableRateTable(rr.models),
        }, null, 2), o);
        return;
      }

      const lines = ['\n  Fable — what your usage costs  (estimate)', '  ' + '='.repeat(58), ''];

      // ── the rule, stated per plan ──
      if (billing === 'included_weekly') {
        lines.push('  On your plan, Fable is included — up to 50% of your weekly usage');
        lines.push('  limit. That is a share of the weekly limit, not an allowance on top of');
        lines.push('  it, and it is not a credits wallet. Fable use does not produce a bill.');
      } else if (billing === 'usage_credits') {
        lines.push('  On your plan, Fable bills usage credits from the first token, at');
        for (const line of fableRateLines(rr.models)) lines.push('  ' + line);
      } else if (billing === 'org_conditional') {
        lines.push('  On Enterprise Standard, Fable bills usage credits only if your');
        lines.push('  organisation has enabled it. Enterprise Standard seats are never');
        lines.push('  eligible for Fable promotional credits.');
      } else {
        lines.push('  Fable has been permanent and plan-conditional since July 20, 2026,');
        lines.push('  so what it costs you depends on your plan — and no plan is configured,');
        lines.push('  so both readings are shown below. Set one with `wtclaude setup`.');
        lines.push('');
        lines.push('    Max · Team Premium · Ent Premium  included, up to 50% of the weekly');
        lines.push('                                      limit — no bill');
        lines.push('    Pro · Team Standard               usage credits from token #1');
      }
      lines.push('');

      if (rr.fableTurns === 0) {
        lines.push('  No Fable turns in the look-back window, so there is nothing to');
        lines.push('  measure yet. Select it with /model fable (Claude Code 2.1.170+).');
        lines.push('');
        lines.push(...promoLines(promo, new Date(), Object.keys(rr.models), today));
        output(lines.join('\n'), o);
        return;
      }

      lines.push(`  Look-back:         last ${lookback} days (${rr.days} with Fable use, ${rr.fableTurns} turn${rr.fableTurns === 1 ? '' : 's'})`);
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
        lines.push('  which understates thinking-heavy turns. Thinking cannot be disabled');
        lines.push('  on Fable.');
      }

      lines.push('');
      lines.push(...promoLines(promo, new Date(), Object.keys(rr.models), today));
      output(lines.join('\n'), o);
    });
}

// Fable promotional credits. Facts only: claiming closed, the expiry was fixed
// regardless of claim date, and while live they were spent ahead of other
// credits silently. We do NOT say anything about credits consumed or refunded
// during the Fable mis-gating episode — that has never had an Anthropic-primary
// source.
//
// Pure (clock injected) so both sides of the expiry instant are pinned by test.
//
// PAST THE EXPIRY (2026-09-17 11:59 PM PT) — decision, 2026-09-27: keep ONE
// past-tense line for a window that could have held the credits, and drop the
// block entirely for a Fable-5.1-only window. Why not drop it for everyone: a
// Pro / Team Standard Fable 5 user whose promo balance was covering usage sees
// credits start to draw down after Sep 17, and the one line says why; stated in
// the past tense it stays true indefinitely. Why drop it for a 5.1-only window:
// those credits never applied to Fable 5.1, and once expired there is nothing
// left to explain. The present-tense block ("Credits expire ...", "N days from
// today") must never print after the instant — 0.3.1 sat unshipped across it.
export function promoLines(promo, now, modelKeys, today) {
  const applies = promo.appliesTo ? promo.appliesTo(modelKeys) : true;
  const status = promo.status ? promo.status(now) : 'active';
  if (status === 'expired') {
    if (!applies) return [];
    return [
      '  Fable promotional credits',
      `    Expired ${promo.expiry_date} at 11:59 PM PT. They covered Fable 5 only;`,
      '    nothing in this report counts them.',
      '',
    ];
  }
  const lines = ['  Fable promotional credits'];
  if (!applies) {
    // SCOPED 2026-09-07. The promotional credits were Fable 5 only — Anthropic
    // states plainly that there is no equivalent credit for Fable 5.1 — so a
    // window containing only Fable 5.1 usage must not be shown a countdown to
    // an expiry the user has nothing riding on.
    lines.push('    Not applicable to your usage. The promotional credits covered');
    lines.push('    Fable 5 only; there is no equivalent credit for Fable 5.1, and');
    lines.push('    your Fable usage in this window is Fable 5.1.');
    lines.push('');
    return lines;
  }
  const days = daysUntil(promo.expiry_date, today);
  const when = days == null ? '.'
    : days <= 0 ? ' — that is today.'
    : ` — ${days} day${days === 1 ? '' : 's'} from today.`;
  lines.push(`    Claiming closed ${promo.claiming_closed}. Credits expire ${promo.expiry_date} at 11:59 PM PT,`);
  lines.push('    regardless of when they were claimed' + when);
  lines.push('    They cover Fable 5 only — there is no equivalent credit for Fable 5.1.');
  lines.push('    They are spent before your other credits, including auto-reload, and');
  lines.push('    that happens silently.');
  lines.push('');
  return lines;
}

// The Fable models this window actually contains, newest first. Falls back to
// the current default Fable model when the window holds no Fable turns (or only
// unrecognised Fable ids), so the rate line is never blank and never invented.
function fableModelKeys(models) {
  const seen = Object.keys(models || {}).filter(k => getRates(`claude-${k}`));
  return seen.length > 0 ? seen.sort().reverse() : ['fable-5-1'];
}

const MODEL_LABEL = { 'fable-5-1': 'Fable 5.1', 'fable-5': 'Fable 5' };
const labelFor = k => MODEL_LABEL[k] || k;

// Rate lines, resolved from the rate sheet per model. Never a literal: Fable 5
// and Fable 5.1 share $10/$50 base rates but cached input differs 4x, so a
// hard-coded "$1 cached" overstates a Fable 5.1 user's cached input by 4x.
function fableRateLines(models) {
  const keys = fableModelKeys(models);
  return keys.map(k => {
    const r = getRates(`claude-${k}`, 'standard');
    const cached = r.input * cacheReadMultiplier(`claude-${k}`);
    const rate = `$${r.input}/MTok in ($${cached}/MTok cached) and $${r.output}/MTok out`;
    return keys.length === 1 ? `${rate}.` : `${labelFor(k).padEnd(10)} ${rate}`;
  });
}

function fableRateTable(models) {
  const out = {};
  for (const k of fableModelKeys(models)) {
    const r = getRates(`claude-${k}`, 'standard');
    out[k] = {
      input_per_mtok: r.input,
      output_per_mtok: r.output,
      cache_read_per_mtok: r.input * cacheReadMultiplier(`claude-${k}`),
      cache_read_multiplier: cacheReadMultiplier(`claude-${k}`),
    };
  }
  return out;
}

function fableRateAssumption(models) {
  return 'Fable list rates, per model: ' + fableModelKeys(models).map(k => {
    const t = fableRateTable(models)[k];
    return `${labelFor(k)} $${t.input_per_mtok}/MTok in, $${t.cache_read_per_mtok}/MTok cached, $${t.output_per_mtok}/MTok out`;
  }).join('; ');
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
