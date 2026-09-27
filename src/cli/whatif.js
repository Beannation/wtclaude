import { getSessionsForDateRange, summarizeSessions } from '../utils/sessions.js';
import { getLatestPricing, getModelEntry } from '../utils/pricing.js';
import { priceTurn, formatCost, hasTokens } from '../utils/cost.js';
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
    console.log(`\n  "${targetModel}" ${why} — no figure shown. Try: haiku, sonnet, opus, fable.\n`);
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
      // Same rule as compare-models (2026-09-27): a zero-token turn is $0 on any
      // rate, so it is not an exclusion.
      if (!hasTokens(t)) continue;
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

  // Everything excluded: say so, instead of printing $0 against $0 — which is
  // the "no data" shape compare-models stopped using in 0.3.1.
  const excludedTotal = [...unpriced.values()].reduce((a, b) => a + b, 0);
  if (priced === 0 && excludedTotal > 0) {
    console.log(excludedTotal === 1
      ? '  The one turn in this window was excluded, so there is nothing to compare'
      : `  All ${excludedTotal} turns in this window were excluded, so there is nothing to compare`);
    console.log('  yet — this is not the same as having no usage:');
    for (const [label, n] of unpriced) console.log(`    ${String(n).padStart(5)} x ${label}`);
    console.log('  We do not have first-party rates we can stand behind for these. Your');
    console.log('  headline cost is unaffected — it is the cost figure Claude Code itself');
    console.log('  reports, and `wtclaude today` still counts it.\n');
    return;
  }

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
    console.log('  Your headline cost is unaffected — it is the cost figure Claude Code');
    console.log('  itself reports, and `wtclaude today` still counts it.');
  }
  console.log('');
}
