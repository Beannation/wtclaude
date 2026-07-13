// Shared 3-model comparison computation (feature C). ONE computation, consumed by
// the CLI (`wtclaude compare-models`), the dashboard tile, and the companion card,
// so the three surfaces can never drift. Extends the honest `whatif --model`
// re-pricing (QA-0610-03): both the baseline AND every hypothetical are priced with
// the SAME token×rate method on the SAME captured turns, so re-pricing a model you
// already run nets ~$0 instead of making it look magically cheaper than your bill —
// the exact undercount this product exists to expose.
//
// Honesty rails (binding, handback §C):
//  • This re-prices your RECORDED usage — not "the same task on each model." A
//    different model emits different token counts for identical work (Sonnet 5's
//    tokenizer runs ~1.0–1.35× heavier than Opus), so holding tokens fixed
//    UNDERSTATES the true gap. Every projected number is a labeled estimate.
//  • Per-surface split: Code = billing-grade tokens (anchored terminal capture),
//    Cowork = labeled estimate (audit.jsonl token counts × rate), Chat = excluded
//    (no local cost data). Model choice is made per surface, and data quality
//    differs per surface — so the split is the honest unit, not one blended figure.
//  • Cost only, not quality — we surface what the choice costs; we never judge which
//    model is "better."

import { expectedCost } from '../utils/cost.js';

// The three models compared, newest-generation keys (must match pricing config keys).
export const COMPARE_MODELS = [
  { key: 'opus-4-8', label: 'Opus 4.8' },
  { key: 'sonnet-5', label: 'Sonnet 5' },
  { key: 'fable-5', label: 'Fable 5' },
];

function sumTokens(turns) {
  const t = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
  for (const x of turns) {
    t.input += x.input_tokens || 0;
    t.output += x.output_tokens || 0;
    t.cache_read += x.cache_read_tokens || 0;
    t.cache_write += x.cache_write_tokens || 0;
  }
  return t;
}

// Re-price a set of turns across the three comparison models. `today` is injectable
// so the Sonnet-5 Aug-31 step-up ($2/$10 -> $3/$15) resolves deterministically in
// tests and correctly in production (it threads through getRates' schedule).
export function repriceSurface(turns, { today, days = 30 } = {}) {
  const list = Array.isArray(turns) ? turns : [];
  const monthFactor = days > 0 ? 30 / days : 1;

  // Baseline: the same turns priced at the models you ACTUALLY ran (token×rate).
  // The no-op reference — re-pricing to a model already in your mix nets ~$0.
  let baselineWindow = 0;
  for (const t of list) baselineWindow += expectedCost(t.model, 'standard', t, today);

  const models = COMPARE_MODELS.map(m => {
    let windowUsd = 0;
    for (const t of list) windowUsd += expectedCost(m.key, 'standard', t, today);
    const deltaVsBaselineUsd = windowUsd - baselineWindow;
    const deltaPct = baselineWindow > 0 ? (deltaVsBaselineUsd / baselineWindow) * 100 : 0;
    return {
      key: m.key,
      label: m.label,
      window_usd: round(windowUsd),
      monthly_usd: round(windowUsd * monthFactor),
      delta_vs_baseline_usd: round(deltaVsBaselineUsd),
      delta_pct: Math.round(deltaPct),
    };
  });

  return {
    present: list.length > 0,
    turn_count: list.length,
    tokens: sumTokens(list),
    baseline_window_usd: round(baselineWindow),
    baseline_monthly_usd: round(baselineWindow * monthFactor),
    models,
  };
}

// Assemble the full per-surface comparison. `codeTurns` are billing-grade terminal
// turns (collector ndjson); `coworkTurns` are labeled-estimate Cowork audit turns
// (empty when no Cowork log is present on this machine). Chat is always excluded.
export function computeComparison({ codeTurns = [], coworkTurns = [], today, days = 30 } = {}) {
  const code = repriceSurface(codeTurns, { today, days });
  const cowork = repriceSurface(coworkTurns, { today, days });
  const combined = repriceSurface([...codeTurns, ...coworkTurns], { today, days });

  return {
    days,
    today: today || new Date().toISOString().slice(0, 10),
    models: COMPARE_MODELS,
    surfaces: {
      code: { key: 'code', label: 'Code (terminal)', grade: 'billing-grade', ...code },
      cowork: { key: 'cowork', label: 'Cowork', grade: 'estimate', ...cowork },
      chat: {
        key: 'chat', label: 'Chat', grade: 'excluded', present: false,
        reason: 'no local cost data — Chat is not metered on this machine',
      },
    },
    // The total inherits the LOWEST label present (billing-grade Code tokens +
    // estimate Cowork tokens => estimate-tinted). Per-surface rows stay visible so
    // the billing-grade Code number is never diluted by the Cowork estimate.
    total: { key: 'total', label: 'All tracked surfaces', grade: 'estimate', ...combined },
    caveats: CAVEATS,
  };
}

// Honesty caveats carried on every surface (handback §C rails). No "first/only";
// Fable is framed as an allowance cap (never "free"); every projection is labeled.
export const CAVEATS = [
  'Re-prices your recorded usage — not the same task run on each model. A different model emits different token counts for identical work (Sonnet 5’s tokenizer runs ~1.0–1.35× heavier than Opus), so holding tokens fixed understates the true gap. Every projected number is a labeled estimate.',
  'Fable’s row is priced as usage credits at $10/$50. Fable is included up to 50% of your weekly limit through ~July 19 (extended from July 7 → July 12 → July 19), then usage credits — run `wtclaude fable` for the forecast.',
  'Cost, not quality — we surface what the choice costs you; we don’t judge which model is better.',
  'Code is billing-grade (your anchored terminal tokens). Cowork is a labeled estimate (audit-log tokens × rate). Chat is excluded (no local cost data).',
];

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }
