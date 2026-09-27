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

import { expectedCost, priceTurn } from '../utils/cost.js';
import { getRates } from '../utils/pricing.js';

// The three models compared, newest-generation keys (must match pricing config keys).
// THE RULE (PMO, applied three times now): the compare set carries Claude Code's
// CURRENT default model per family.
//
// Opus 5.5 replaced Opus 5 here on 2026-09-27. Claude Code 2.1.280 (2026-09-22)
// made Opus 5.5 the default model on every paid plan — Pro and Team Standard moved
// from Sonnet to Opus, and the default Opus became Opus 5.5 — so it is the model
// most sessions now run on. The two differ on every rate: $4/$20 against $5/$25,
// and cache reads at 0.05x ($0.20/MTok) against 0.1x ($0.50/MTok). Opus 5 is
// dropped from the COMPARISON only: it stays fully priced in the rate sheet so
// historical turns still cost correctly, and it remains Active on the Claude API
// (retirement not sooner than 2027-07-24). Before that, Opus 5 replaced Opus 4.8
// on 2026-08-24 (default `opus` from v2.1.219 until v2.1.280).
//
// Fable 5.1 replaced Fable 5 here on 2026-09-07, for the same reason: it has been
// Claude Code's default Fable model since v2.1.257 (2026-09-01). The two share
// $10/$50 base rates and differ only in cache reads — $0.25 vs $1 per MTok — so a
// Fable 5 user re-pricing to Fable 5.1 sees a real, cache-driven saving rather
// than a wash. Fable 5 stays fully priced and Active (not sooner than 2027-06-09).
export const COMPARE_MODELS = [
  { key: 'opus-5-5', label: 'Opus 5.5' },
  { key: 'sonnet-5', label: 'Sonnet 5' },
  { key: 'fable-5-1', label: 'Fable 5.1' },
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

// Re-price a set of turns across the three comparison models. `today` is
// injectable so the result is deterministic in tests. (There is no dated rate
// change to resolve any more: the Sonnet-5 step-up to $3/$15 was cancelled by
// Anthropic on 2026-08-10 and removed from the rate sheet.)
export function repriceSurface(turns, { today, days = 30 } = {}) {
  const all = Array.isArray(turns) ? turns : [];
  const monthFactor = days > 0 ? 30 / days : 1;

  // Turns we cannot price at first-party rates are excluded from BOTH sides and
  // counted, exactly as `whatif` does — an unresolved model, a partner-platform
  // id (Bedrock and Google Cloud publish their own rates), or a family-fallback
  // guess. Letting them through at $0 removed real spend from the baseline and
  // made every switch look cheaper than it is.
  const list = [], unpriced = [];
  for (const t of all) {
    if (priceTurn(t.model, 'standard', t, today).priceable) list.push(t);
    else unpriced.push(t);
  }

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
    unpriced_turn_count: unpriced.length,
    unpriced_models: [...new Set(unpriced.map(t => t.model).filter(Boolean))],
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
//
// CORRECTED 2026-09-07. The Fable caveat carried a countdown — "included ... through
// ~July 19 (extended from July 7 → July 12 → July 19), then usage credits" — which
// was already false when 0.3.0 shipped: Fable became permanent and plan-conditional
// on 2026-07-20, and the rate sheet's own `fable` block says the historical boundary
// date "is NOT a future event and must never be rendered as a countdown." The
// honesty gate missed it because the string never used the word "cliff"; the gate
// has been widened to catch the countdown shape itself.
export const CAVEATS = [
  'Re-prices your recorded usage — not the same task run on each model. A different model emits different token counts for identical work (Sonnet 5’s tokenizer runs ~1.0–1.35× heavier than Opus), so holding tokens fixed understates the true gap. Every projected number is a labeled estimate.',
  'Fable’s row is priced at $10/$50 list. Fable is plan-conditional, not date-limited: included up to 50% of the weekly usage limit on Max, Team Premium and Enterprise Premium, and billed as usage credits on Pro and Team Standard — run `wtclaude fable` for your plan’s reading. Credits figures are at standard API list rates; bundle discounts up to 30% and promos not reflected.',
  'Fable 5.1 and Fable 5 have identical $10/$50 base rates; their cached-input rates differ. A cache read costs $0.25/MTok on Fable 5.1 against $1/MTok on Fable 5, so on a cache-heavy session that gap is most of the difference between the two rows.',
  opusRateCaveat(rateCard('opus-5-5'), rateCard('opus-5')),
  'Cost, not quality — we surface what the choice costs you; we don’t judge which model is better.',
  'Code is billing-grade (your anchored terminal tokens). Cowork is a labeled estimate (audit-log tokens × rate). Chat is excluded (no local cost data).',
];

// ADDED 2026-09-27 — a fact caveat, not a claim. The Opus row moved from Opus 5
// to Opus 5.5, whose rates are lower on every axis, so an Opus 5 user now sees a
// cheaper Opus row and deserves to know exactly why. Stated as rate arithmetic
// only. Anthropic's own "costs 40% less to run than Opus 5" is THEIR measurement
// from THEIR tests and includes fewer tokens per task; re-pricing holds tokens
// fixed, so it can never show more than the rate part — and the caveat says so rather
// than borrowing their number. Built from the rate sheet, never typed in: the
// browser mirror builds the same sentence from its own table, and
// web-parity.test.js asserts the two arrays are identical.
function rateCard(key) {
  const r = getRates(`claude-${key}`, 'standard');
  return { input: r.input, output: r.output, cacheRead: r.input * r.cache_read_multiplier };
}

export function opusRateCaveat(next, prev) {
  const less = (a, b) => Math.round((1 - a / b) * 100);
  const inPct = less(next.input, prev.input), outPct = less(next.output, prev.output);
  const io = inPct === outPct ? `${inPct}% less in and out` : `${inPct}% less in and ${outPct}% less out`;
  const usd = n => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
  return `Opus 5.5 is priced at ${usd(next.input)}/${usd(next.output)} per MTok with cache reads at ${usd(next.cacheRead)}, against Opus 5’s ${usd(prev.input)}/${usd(prev.output)} and ${usd(prev.cacheRead)} — so identical tokens cost ${io}, and ${less(next.cacheRead, prev.cacheRead)}% less on cache reads. Re-pricing holds your token counts fixed, so it reflects that rate difference alone — not any change in how many tokens a model spends on the same work.`;
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }
