import { getSessionsForDateRange, summarizeSessions } from '../utils/sessions.js';
import { getLatestPricing, getModelPricing } from '../utils/pricing.js';
import { computeTurnCost, formatCost } from '../utils/cost.js';

export function registerWhatIf(program) {
  program
    .command('whatif')
    .description('Estimate costs under different plans or models')
    .option('--plan <plan>', 'Compare plan costs: pro, max5, max20')
    .option('--model <model>', 'What if you used a different model: haiku, sonnet, opus')
    .option('--days <n>', 'Number of days to look back', '1')
    .action((opts) => {
      const days = parseInt(opts.days, 10);
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - (days - 1));

      const startStr = start.toISOString().slice(0, 10);
      const endStr = end.toISOString().slice(0, 10);
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

  console.log(`\n  What-If: Plan Comparison (${days} day${days > 1 ? 's' : ''} of data)`);
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

function showModelComparison(sessions, targetModel, days) {
  const allTurns = sessions.flatMap(s => s.turns);
  const actualCost = allTurns.reduce((sum, t) => sum + computeTurnCost(t), 0);

  const modelMap = { haiku: 'haiku-4-5', sonnet: 'sonnet-4-6', opus: 'opus-4-7' };
  const resolved = modelMap[targetModel] || targetModel;
  const targetPricing = getModelPricing(resolved);
  const cachePricing = getLatestPricing().cache;

  let hypotheticalCost = 0;
  for (const t of allTurns) {
    hypotheticalCost += (t.input_tokens / 1_000_000) * targetPricing.input;
    hypotheticalCost += (t.output_tokens / 1_000_000) * targetPricing.output;
    hypotheticalCost += (t.cache_read_tokens / 1_000_000) * targetPricing.input * cachePricing.read_multiplier;
    hypotheticalCost += (t.cache_write_tokens / 1_000_000) * targetPricing.input * cachePricing.write_multiplier;
  }

  const diff = hypotheticalCost - actualCost;
  const pct = actualCost > 0 ? ((diff / actualCost) * 100).toFixed(0) : 0;

  console.log(`\n  What-If: All ${resolved} (${days} day${days > 1 ? 's' : ''})`);
  console.log('  ==========================================');
  console.log(`  Actual cost:       ${formatCost(actualCost)}`);
  console.log(`  If all ${resolved}: ${formatCost(hypotheticalCost)}`);
  console.log(`  Difference:        ${diff > 0 ? '+' : ''}${formatCost(diff)} (${pct}%)`);
  console.log('');
}
