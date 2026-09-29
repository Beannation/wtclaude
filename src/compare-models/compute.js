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
//  • Per-surface split: Code = % differences only, beside the billing-grade total
//    for the window (see "Decision 4" below), Cowork = labeled estimate (tokens
//    from Cowork's local logs × rate), Chat = excluded (no local cost data).
//    Model choice is made per surface, and data quality differs per surface — so
//    the split is the honest unit, not one blended figure.
//  • Cost only, not quality — we surface what the choice costs; we never judge which
//    model is "better."

import { expectedCost, priceTurn, hasTokens } from '../utils/cost.js';
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
    // A turn with no tokens costs $0 on any rate, so an unrecognised model on it
    // is not an exclusion worth warning about (2026-09-27).
    else if (hasTokens(t)) unpriced.push(t);
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
      // ADDED 2026-09-27: the delta at the SAME monthly scale as monthly_usd and
      // baseline_monthly_usd. delta_vs_baseline_usd is window dollars and is kept
      // for --json compatibility; the tables render this one beside /mo figures.
      monthly_delta_vs_baseline_usd: round(deltaVsBaselineUsd * monthFactor),
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

// DECISION 4 (Peter, 2026-09-28; QA-0928-21). The Code surface's recorded
// per-turn tokens are context-window occupancy, not billed tokens (BUILD-014),
// so re-pricing them came out 3.5-7x below the billing-grade spend for the same
// window — while the table called them "billing-grade tokens" and the baseline
// "what you actually run". Until the collector re-shape, every re-priced DOLLAR
// figure on a surface built from those tokens is withheld; the percentage
// differences stand (both sides are priced on the same tokens, so the ratio is
// the honest part), and the real billed total is shown beside them.
export const USD_WITHHELD_REASON =
  'Dollar figures withheld: re-pricing uses your recorded tokens, which don’t reproduce the billed total yet.';

function withholdUsd(s) {
  return {
    ...s,
    usd_withheld: true,
    withheld_reason: USD_WITHHELD_REASON,
    baseline_window_usd: null,
    baseline_monthly_usd: null,
    models: s.models.map(m => ({
      ...m, window_usd: null, monthly_usd: null, delta_vs_baseline_usd: null, monthly_delta_vs_baseline_usd: null,
    })),
  };
}

// Assemble the full per-surface comparison. `codeTurns` are the terminal turns
// (collector ndjson); `coworkTurns` are labeled-estimate Cowork turns (empty when
// no Cowork log is present on this machine). Chat is always excluded.
//
// `days` is the requested window. `coveredDays` ({ code, cowork }) is how many of
// those days each surface's data actually covers (QA-0928-22) — the /mo figures
// scale by it, never by the window alone. `billed` is the Code surface's billed
// total for the window ({ usd, anchored_usd, estimated_usd, anchored_turns,
// estimated_turns }), shown beside its percentages.
export function computeComparison({ codeTurns = [], coworkTurns = [], today, days = 30, coveredDays = {}, billed = null } = {}) {
  const codeDays = coveredDays.code ?? days;
  const coworkDays = coveredDays.cowork ?? days;
  const code = repriceSurface(codeTurns, { today, days: codeDays });
  const cowork = repriceSurface(coworkTurns, { today, days: coworkDays });
  const combinedDays = Math.max(codeDays, coworkDays);
  const combined = repriceSurface([...codeTurns, ...coworkTurns], { today, days: combinedDays });

  return {
    days,
    today: today || new Date().toISOString().slice(0, 10),
    models: COMPARE_MODELS,
    surfaces: {
      code: withholdUsd({ key: 'code', label: 'Code (terminal)', grade: 'estimate', covered_days: codeDays, billed, ...code }),
      cowork: { key: 'cowork', label: 'Cowork', grade: 'estimate', covered_days: coworkDays, ...cowork },
      chat: {
        key: 'chat', label: 'Chat', grade: 'excluded', present: false,
        reason: 'no local cost data — Chat is not metered on this machine',
      },
    },
    // The total mixes the Code surface in, so its dollars are withheld too.
    // Per-surface rows stay visible so the Cowork estimate is never blended
    // into the Code comparison.
    total: withholdUsd({ key: 'total', label: 'All tracked surfaces', grade: 'estimate', covered_days: combinedDays, ...combined }),
    caveats: CAVEATS,
  };
}

// Honesty caveats carried on every surface (handback §C rails). No "first/only";
// Fable is framed as an allowance cap (never "free"); every projection is labeled.
//
// CORRECTED 2026-09-28 (BUILD-018) — the last line. "Code is billing-grade (your
// anchored terminal tokens)" was false: the anchor is the cost, not the tokens
// (decision 4 above). "audit-log tokens × rate" stopped being true when the
// reader started using the run transcripts (QA-0928-23), and the line now says
// what the Cowork logs leave out (QA-0928-81). PMO owns the final wording (E-7).
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
  'Fable 5.1 and Fable 5 have identical $10/$50 base rates; their cached-input rates differ. A cache read costs $0.25/MTok on Fable 5.1 against $1/MTok on Fable 5, so on a cache-heavy session that gap is most of the difference between the two models.',
  opusRateCaveat(rateCard('opus-5-5'), rateCard('opus-5')),
  'Cost, not quality — we surface what the choice costs you; we don’t judge which model is better.',
  'Code: the billed total is billing-grade (the cost Claude Code itself reports); the re-priced comparison is an estimate on your recorded tokens, shown as percentages, not dollars. Cowork is a labeled estimate (tokens from Cowork’s local logs × rate); helper-model calls such as web search and fetch, and search fees, don’t appear in those logs and are left out. Chat is excluded (no local cost data).',
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
