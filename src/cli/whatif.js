import { getSessionsForDateRange, summarizeSessions } from '../utils/sessions.js';
import { getLatestPricing, getModelEntry } from '../utils/pricing.js';
import { priceTurn, formatCost, hasTokens, turnCostBasis } from '../utils/cost.js';
import { costBasisBadge, excludedLines, headlineExclusionNote, wrapWords } from '../utils/format.js';
import { localDate } from '../utils/time.js';
import { normalizePlanKey } from '../utils/config.js';
import { parseDaysOption, windowStart, splitHistory, coveredDays, projectionNote, windowLabel } from '../utils/window.js';
import { USD_WITHHELD_REASON } from '../compare-models/compute.js';

// Model families `--model` accepts as shorthand for the newest key in each.
const FAMILIES = { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus', fable: 'fable' };

// The rate sheet's priced plans, in sheet order — the one list for the table,
// the help text and `--plan` validation (QA-0928-172). Never typed in here.
function pricedPlans() {
  return Object.entries(getLatestPricing().plans)
    .filter(([, p]) => p && typeof p === 'object' && p.price_monthly);
}

export function registerWhatIf(program) {
  const planKeys = pricedPlans().map(([k]) => k).join(', ');
  program
    .command('whatif')
    .description('Estimate costs under different plans or models')
    .option('--plan [plan]', `Compare plan costs: all plans, or one of ${planKeys}`)
    .option('--model <model>', `What if you used a single model: ${Object.keys(FAMILIES).join(', ')}`)
    .option('--days <n>', 'Number of days to look back', parseDaysOption, 1)
    .action((opts) => {
      const days = opts.days;
      const endStr = localDate(); // local calendar range (QA-BUG-10)
      const startStr = windowStart(days);

      // `--plan pro` shows Pro; a bare `--plan` shows every plan (QA-0928-172).
      let planFilter = null;
      if (typeof opts.plan === 'string') {
        planFilter = normalizePlanKey(opts.plan);
        if (!planFilter || !pricedPlans().some(([k]) => k === planFilter)) {
          console.error(`\n  Unknown plan "${opts.plan}". Try one of: ${planKeys}.\n`);
          process.exitCode = 1;
          return;
        }
      }

      // All history in one read: the window, plus the first tracked day for the
      // projection basis (QA-0928-22).
      const history = splitHistory(getSessionsForDateRange('0000-01-01', endStr), startStr, endStr);
      const sessions = history.sessions;

      if (sessions.length === 0) {
        console.log(`\n  No usage data found in the last ${days} day${days === 1 ? '' : 's'}.\n`);
        return;
      }

      const covered = coveredDays(days, history.firstDate, endStr) ?? days;
      if (opts.model) {
        showModelComparison(sessions, opts.model, days);
      } else {
        showPlanComparison(sessions, days, covered, planFilter);
      }
    });
}


// The window's billed total, labelled by its basis (billing-grade where the
// anchor was recorded). Both views print it, so the command has one basis.
// "— (not priced)" when every turn was excluded (RC 2026-09-28): $0.00 there
// read as a real, empty bill.
function billedLine(summary) {
  if (nothingPriced(summary)) return '  Billed in this window:  — (not priced)';
  const b = costBasisBadge(summary);
  return `  Billed in this window:  ${formatCost(summary.cost)}${b.label ? ` (${b.label})` : ''}`;
}

// Every turn with tokens was excluded (QA-0928-54): no figure at all.
function nothingPriced(s) {
  return (s.anchored_turns || 0) + (s.estimated_turns || 0) === 0 && (s.excluded_turns || 0) > 0;
}

// The "nothing to compare" block both views use when every turn was excluded.
function allExcludedLines(n, end = ':') {
  return [
    n === 1
      ? '  The one turn in this window was excluded, so there is nothing to compare'
      : `  All ${n} turns in this window were excluded, so there is nothing to compare`,
    `  yet — this is not the same as having no usage${end}`,
  ];
}

// REWORDED 2026-09-28 (QA-0928-80). "Pro $20/mo — saving you $<difference>" read as
// a promise: plan usage limits are not modelled, so a plan may not carry the
// workload at all, and the Team prices are per seat against one person's
// spend. The comparison is now stated as what it is — the plan price against
// API list rates — with both caveats, and the projection says its basis.
function showPlanComparison(sessions, days, covered, planFilter) {
  const summary = summarizeSessions(sessions);
  const monthlyCost = (summary.cost / covered) * 30;

  console.log(`\n  What-If: Plan Comparison (${windowLabel(days)})  (estimate)`);
  console.log('  ==========================================');
  console.log(billedLine(summary));
  // Turns the billed total leaves out (QA-0928-54: unanchored, on a model we
  // can't price) are named, not dropped silently from the projection below.
  for (const l of excludedLines(summary)) console.log(l);
  // RC 2026-09-28: everything excluded — no $0 projection and no plan
  // verdicts ("every plan costs more than API") built on a bill of nothing.
  if (nothingPriced(summary)) {
    console.log('');
    for (const l of allExcludedLines(summary.excluded_turns, '.')) console.log(l);
    console.log('  Claude Code sent no cost for these turns and this version has no');
    console.log('  first-party rate it can stand behind for their models, so no projection');
    console.log('  or plan comparison is shown.');
    console.log('');
    return;
  }
  if (summary.excluded_turns > 0) {
    const n = summary.excluded_turns;
    console.log(`  The projection and plan comparison below leave ${n === 1 ? 'that turn' : `those ${n} turns`} out.`);
  }
  console.log(`  Projected to a month:   ${formatCost(monthlyCost)}/month  (${projectionNote(covered, days)})`);
  // One partial day. Suggest a longer window only when the user asked for one
  // day; with a longer window, tracking simply began today.
  if (covered === 1 && days === 1) {
    console.log('  Projected from today alone, a partial day — try --days 30 for a steadier figure.');
  } else if (covered === 1) {
    console.log('  Tracking began today, so this projects one partial day — it steadies as days are tracked.');
  }
  console.log('');
  console.log("  Against API list rates. Plan usage limits aren't modelled — a plan may");
  console.log('  not carry this workload.');
  console.log('');

  let perSeat = false;
  for (const [key, plan] of pricedPlans()) {
    if (planFilter && key !== planFilter) continue;
    const price = `$${plan.price_monthly}/mo${plan.per_seat ? '/seat' : ''}`;
    if (plan.per_seat) perSeat = true;
    const diff = monthlyCost - plan.price_monthly;
    const verdict = diff >= 0
      ? `${formatCost(diff)} less than API list rates`
      : `${formatCost(-diff)} more than API list rates`;
    console.log(`  ${plan.label.padEnd(14)} ${price.padEnd(14)} ${verdict}`);
  }
  if (perSeat) console.log('\n  Team prices are per seat; the spend above is yours alone.');
  console.log('');
}

// Newest pricing-config key for a model family (e.g. 'opus' -> 'opus-4-8'), so
// the counterfactual never hardcodes a stale version (QA-0610-06).
function currentModelKey(family, fallback) {
  const keys = Object.keys(getLatestPricing().models).filter(k => k.startsWith(family));
  return keys.sort().pop() || fallback || family;
}

function showModelComparison(sessions, targetModel, days) {
  const allTurns = sessions.flatMap(s => s.turns);

  const fam = FAMILIES[String(targetModel).toLowerCase()];
  const resolved = fam ? currentModelKey(fam, targetModel) : targetModel;
  // FIXED 2026-09-27 (BUILD-017): the TARGET must be a model we can price at
  // first-party rates, not just one that resolves. An unknown opus id used to
  // resolve by the family fallback, so `--model opus-6` printed "If all opus-6:"
  // at Opus 5.5's rates under the new name — exactly how 0.3.0 would have
  // answered `--model opus-5-5`, at Opus 5's rates. A partner-platform id was
  // priced at first-party rates with no flag. Refuse both, and say why.
  const target = getModelEntry(resolved);
  if (!target || !target.priceable) {
    const why = !target
      ? 'is not a model we recognise'
      : target.provider
        ? `is served by ${target.provider}, which publishes its own rates, so a first-party figure would not be yours`
        : 'is not in this version\'s rate sheet, so any figure would be a guess (if it is new: npm i -g wtclaude@latest)';
    console.log(`\n  "${targetModel}" ${why} — no figure shown. Try: ${Object.keys(FAMILIES).join(', ')}.\n`);
    process.exitCode = 1; // an input error, like an unknown --plan (RC 2026-09-28)
    return;
  }

  // QA-0610-03: estimate BOTH sides with the same token x rate method on the
  // same turns. Comparing a token x rate hypothetical against the billing-grade
  // anchor made a model you ALREADY use look dramatically cheaper than your bill
  // (the very undercount the tool exists to expose). The baseline is now your
  // turns priced at the models you actually ran, so a no-op switch nets ~$0.
  //
  // A3 (2026-08-24): a turn we cannot price at first-party rates is EXCLUDED from
  // both sides and counted, instead of silently contributing $0 to the baseline.
  // Pricing it at $0 made the counterfactual look better than it is, and said so
  // without ever telling the user a turn had gone missing. Unpriceable means: an
  // unresolved model id, a partner-platform id (Bedrock and Google Cloud publish
  // their own rates), or a family-fallback guess.
  let baseline = 0, hypothetical = 0, priced = 0;
  let unanchoredUnpriced = 0; // of those, turns the headline leaves out too
  const unpriced = new Map();
  for (const t of allTurns) {
    const actual = priceTurn(t.model, 'standard', t);
    if (!actual.priceable) {
      // Same rule as compare-models (2026-09-27): a zero-token turn is $0 on any
      // rate, so it is not an exclusion.
      if (!hasTokens(t)) continue;
      const label = `${t.model || 'unknown'} (${plainReason(actual.reason)})`;
      unpriced.set(label, (unpriced.get(label) || 0) + 1);
      if (turnCostBasis(t).basis === 'excluded') unanchoredUnpriced++;
      continue;
    }
    baseline += actual.usd;
    hypothetical += priceTurn(resolved, 'standard', t).usd;
    priced++;
  }

  const diff = hypothetical - baseline;
  const pct = baseline > 0 ? Math.round((diff / baseline) * 100) : 0;

  console.log(`\n  What-If: all ${resolved} (${windowLabel(days)})  (estimate)`);
  console.log('  ==========================================');

  // Everything excluded: say so, instead of printing $0 against $0 — which is
  // the "no data" shape compare-models stopped using in 0.3.1.
  const excludedTotal = [...unpriced.values()].reduce((a, b) => a + b, 0);
  if (priced === 0 && excludedTotal === 0) {
    // Only zero-token turns: nothing to price on either side (same as
    // compare-models' "no usage" case) — never a $0-vs-$0 comparison.
    console.log('  Nothing to compare in this window — no turns with tokens.\n');
    return;
  }
  if (priced === 0 && excludedTotal > 0) {
    for (const l of allExcludedLines(excludedTotal)) console.log(l);
    for (const [label, n] of unpriced) console.log(`    ${String(n).padStart(5)} x ${label}`);
    console.log('  We do not have first-party rates we can stand behind for these.');
    for (const l of wrapWords(headlineExclusionNote(excludedTotal, unanchoredUnpriced), 70)) console.log(`  ${l}`);
    console.log('');
    return;
  }

  // DECISION 4 (Peter, 2026-09-28; QA-0928-21). The "Current models: $X"
  // figure sat about 7x below what this same window billed: the recorded per-turn
  // tokens are context occupancy (BUILD-014), so re-pricing them undercounts.
  // The % difference stands (both sides priced on the same tokens); the
  // re-priced dollars are withheld, and the billed total is printed instead.
  console.log(billedLine(summarizeSessions(sessions)));
  console.log('  Re-priced on your recorded tokens (token x rate, estimate):');
  console.log(`    If all ${resolved}:  ${pct > 0 ? '+' : ''}${pct}% vs your mix, re-priced`);
  console.log(`  ${USD_WITHHELD_REASON.replace(', which ', ', which\n  ')}`);

  if (unpriced.size > 0) {
    const total = [...unpriced.values()].reduce((a, b) => a + b, 0);
    console.log('');
    console.log(`  ${total} turn${total === 1 ? '' : 's'} unpriced and excluded from both sides above`);
    console.log(`  (${priced} priced). We do not have first-party rates we can stand behind`);
    console.log('  for these, and counting them as $0 would quietly flatter the comparison:');
    for (const [label, n] of unpriced) console.log(`    ${String(n).padStart(5)} x ${label}`);
    for (const l of wrapWords(headlineExclusionNote(total, unanchoredUnpriced), 70)) console.log(`  ${l}`);
  }
  console.log('');
}

// Plain words for priceTurn()'s reason codes (user-facing; never name the
// fallback's guess as though it were the model).
function plainReason(reason) {
  if (!reason) return 'not priced';
  if (reason.startsWith('family-fallback:')) return "not in this version's rate sheet";
  if (reason.startsWith('partner-platform:')) return `served by ${reason.slice('partner-platform:'.length)}, which sets its own rates`;
  if (reason === 'unresolved-model') return 'not a model we recognise';
  return 'not priced';
}
