import { getSessionsForDateRange, summarizeSessions } from '../utils/sessions.js';
import { getLatestPricing, getModelPricing } from '../utils/pricing.js';
import { expectedCost, formatCost } from '../utils/cost.js';
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
  let baseline = 0, hypothetical = 0;
  for (const t of allTurns) {
    baseline += expectedCost(t.model, 'standard', t);
    hypothetical += expectedCost(resolved, 'standard', t);
  }

  const diff = hypothetical - baseline;
  const pct = baseline > 0 ? ((diff / baseline) * 100).toFixed(0) : 0;

  console.log(`\n  What-If: all ${resolved} (${days} day${days > 1 ? 's' : ''})  (estimate)`);
  console.log('  ==========================================');
  console.log('  Estimated on the same tokens (token x rate, not billing-grade):');
  console.log(`    Current models:  ${formatCost(baseline)}`);
  console.log(`    If all ${resolved}: ${formatCost(hypothetical)}`);
  console.log(`    Difference:      ${diff > 0 ? '+' : ''}${formatCost(diff)} (${pct}%)`);
  console.log('');
}
