import { getSessionsForDateRange, summarizeSessions } from '../utils/sessions.js';
import { getLatestPricing, getModelPricing } from '../utils/pricing.js';
import { priceTurn, formatCost } from '../utils/cost.js';
import { localDate } from '../utils/time.js';

export function registerWhatIf(program) {
  program
    .command('whatif')
    .description('Estimate costs under different plans or models')
    .option('--plan [plan]', 'Compare plan costs: pro, max5, max20')
    .option('--model [model]', 'What if you used a different model: haiku, sonnet, opus')
    .option('--days <n>', 'Number of days to look back', '1')
    .action((opts) => {
      const days = parseInt(opts.days, 10);
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - (days - 1));

      const startStr = localDate(start); // local calendar range (QA-BUG-10)
      const endStr = localDate(end);
      const sessions = getSessionsForDateRange(startStr, endStr);

      if (sessions.length === 0) {
        console.log('\n  No usage data found.\n');
        return;
      }

      if (opts.plan) {
        showPlanComparison(sessions, days);
      } else if (opts.model) {
        showModelComparison(sessions, opts.model, days);
      } else {
        showPlanComparison(sessions, days);
      }
    });
}

function showPlanComparison(sessions, days) {
  const summary = summarizeSessions(sessions);
  const pricing = getLatestPricing();
  const dailyCost = summary.cost / days;
  const monthlyCost = dailyCost * 30;

  console.log(`\n  What-If: Plan Comparison (${days} day${days > 1 ? 's' : ''} of data)  (estimate)`);
  console.log('  ==========================================');
  console.log(`  Your estimated API cost: ${formatCost(monthlyCost)}/month`);
  console.log('');

  for (const [key, plan] of Object.entries(pricing.plans)) {
    if (!plan.price_monthly) continue;
    const diff = monthlyCost - plan.price_monthly;
    const verdict = diff > 0 ? `saving you ${formatCost(diff)}` : `costs ${formatCost(Math.abs(diff))} more than API`;
    console.log(`  ${plan.label.padEnd(12)} $${plan.price_monthly}/mo — ${verdict}`);
  }
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

  const families = { haiku: 'haiku', sonnet: 'sonnet', opus: 'opus', fable: 'fable' };
  const fam = families[String(targetModel).toLowerCase()];
  const resolved = fam ? currentModelKey(fam, targetModel) : targetModel;
  if (!getModelPricing(resolved)) {
    console.log(`\n  Unknown model "${targetModel}". Try: haiku, sonnet, opus.\n`);
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
  const unpriced = new Map();
  for (const t of allTurns) {
    const actual = priceTurn(t.model, 'standard', t);
    if (!actual.priceable) {
      const label = `${t.model || 'unknown'} (${actual.reason})`;
      unpriced.set(label, (unpriced.get(label) || 0) + 1);
      continue;
    }
    baseline += actual.usd;
    hypothetical += priceTurn(resolved, 'standard', t).usd;
    priced++;
  }

  const diff = hypothetical - baseline;
  const pct = baseline > 0 ? ((diff / baseline) * 100).toFixed(0) : 0;

  console.log(`\n  What-If: all ${resolved} (${days} day${days > 1 ? 's' : ''})  (estimate)`);
  console.log('  ==========================================');
  console.log('  Estimated on the same tokens (token x rate, not billing-grade):');
  console.log(`    Current models:  ${formatCost(baseline)}`);
  console.log(`    If all ${resolved}: ${formatCost(hypothetical)}`);
  console.log(`    Difference:      ${diff > 0 ? '+' : ''}${formatCost(diff)} (${pct}%)`);

  if (unpriced.size > 0) {
    const total = [...unpriced.values()].reduce((a, b) => a + b, 0);
    console.log('');
    console.log(`  ${total} turn${total === 1 ? '' : 's'} unpriced and excluded from both sides above`);
    console.log(`  (${priced} priced). We do not have first-party rates we can stand behind`);
    console.log('  for these, and counting them as $0 would quietly flatter the comparison:');
    for (const [label, n] of unpriced) console.log(`    ${String(n).padStart(5)} x ${label}`);
    console.log('  Their real cost is unaffected — it comes from the billing-grade anchor.');
  }
  console.log('');
}
