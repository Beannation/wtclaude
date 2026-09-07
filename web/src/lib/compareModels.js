// ─────────────────────────────────────────────────────────────────────────────
// Browser port of the CLI 3-model re-pricing (src/compare-models/compute.js +
// src/utils/cost.js + src/utils/pricing.js). The CLI modules read the pricing
// config from disk via node:fs, which can't run in the browser — so the rates
// and the token×rate method are mirrored here from config/pricing-2026-09-07.json.
// Keep this in lock-step with the CLI so the dashboard tile can never drift.
//
// Honesty rails (identical to the CLI, handback §C):
//  • Re-prices your RECORDED usage — NOT the same task re-run on each model. A
//    different model emits different token counts for identical work (Sonnet 5's
//    tokenizer runs ~1.0–1.35× heavier than Opus), so holding tokens fixed
//    UNDERSTATES the true gap. Every projected number is a labeled estimate.
//  • Both the baseline AND each hypothetical are priced with the SAME token×rate
//    method on the SAME tokens, so re-pricing a model already in your mix nets
//    ~$0 — never a magically-cheaper number than your bill.
//  • Cost only, not quality — we surface what the choice costs; we never judge
//    which model is "better."
// ─────────────────────────────────────────────────────────────────────────────

// MIRROR of src/config/pricing-2026-09-07.json (USD per million tokens). The CLI
// modules read the rate sheet from disk via node:fs, which cannot run in the
// browser, so the rates are mirrored here — and src/compare-models/web-parity.test.js
// asserts this object still equals the shipped sheet, so the two can never drift
// silently. If that test fails, this block is stale: regenerate it, do not edit
// the test.
//
// This file reaches users at the DEPLOY, not at an npm publish. It has shipped a
// live defect before, so treat every number here as production.
//
// UPDATED 2026-09-07: added Fable 5.1 and Mythos 5.1, and a PER-MODEL cache-read
// multiplier. Anthropic's pricing footnote: "Cache hits and refreshes on Claude
// Fable 5.1 and Claude Mythos 5.1 are priced at 0.025x the base input price. All
// other models use the standard 0.1x multiplier." Fable 5 and Fable 5.1 share a
// $10 base input and differ ONLY in cache reads, so `cache.read_multiplier`
// below is the DEFAULT and a model's own `cache.read_multiplier` wins.
//
// CORRECTED 2026-08-24, two independent defects:
//  1. This table carried `scheduled: [{ effective_date: '2026-08-31', input: 3.0,
//     output: 15.0 }]` for Sonnet 5. Anthropic CANCELLED that increase on
//     2026-08-10 ("The previously scheduled increase to $3/$15 per million
//     input/output tokens on September 1, 2026 will not occur" — platform pricing
//     docs). Left alone, this dashboard would have stepped every Sonnet 5 estimate
//     up to a dead price on 2026-08-31, in the browser, with no deploy.
//  2. `write_multiplier: 0.25` under-priced every cache write. Anthropic bills
//     cache writes at 1.25x (5-minute) or 2x (1-hour) of base input.
export const PRICING = {
  cache: {
    // DEFAULT read multiplier. A model entry's own cache.read_multiplier wins.
    read_multiplier: 0.1,
    write_multiplier_5m: 1.25,
    write_multiplier_1h: 2.0,
    write_multiplier: 2.0,
  },
  models: {
    'opus-5': { input: 5.0, output: 25.0, fast_mode: { input: 10.0, output: 50.0 } },
    'opus-4-8': { input: 5.0, output: 25.0, fast_mode: { input: 10.0, output: 50.0 } },
    'opus-4-7': { input: 5.0, output: 25.0 },
    'opus-4-6': { input: 5.0, output: 25.0 },
    'opus-4-5': { input: 5.0, output: 25.0 },
    'opus-4-1': { input: 15.0, output: 75.0, retired: true },
    'opus-4': { input: 15.0, output: 75.0, retired: true },
    'sonnet-5': { input: 2.0, output: 10.0 },
    'sonnet-4-6': { input: 3.0, output: 15.0 },
    'sonnet-4-5': { input: 3.0, output: 15.0 },
    'sonnet-4': { input: 3.0, output: 15.0, retired: true },
    'haiku-4-5': { input: 1.0, output: 5.0 },
    'haiku-3-5': { input: 0.8, output: 4.0, retired: true },
    // Fable 5.1 — Claude Code's default Fable model since v2.1.257 (2026-09-01).
    // 0.025x cache reads: $0.25/MTok against Fable 5's $1/MTok, on the same base.
    'fable-5-1': { input: 10.0, output: 50.0, cache: { read_multiplier: 0.025 } },
    'fable-5': { input: 10.0, output: 50.0 },
    'mythos-5-1': { input: 10.0, output: 50.0, cache: { read_multiplier: 0.025 } },
    'mythos-5': { input: 10.0, output: 50.0 },
  },
};

// The three models compared — must match COMPARE_MODELS in the CLI
// (src/compare-models/compute.js). Opus 5 has been Claude Code's default `opus`
// since v2.1.219; Fable 5.1 has been the default Fable model since v2.1.257.
//
// Fable 5 was swapped out for Fable 5.1 on 2026-09-07. It is dropped from the
// COMPARISON only — it stays fully priced in the table above so historical turns
// recorded on it still cost correctly, and it remains Active on the Claude API.
export const COMPARE_MODELS = [
  { key: 'opus-5', label: 'Opus 5' },
  { key: 'sonnet-5', label: 'Sonnet 5' },
  { key: 'fable-5-1', label: 'Fable 5.1' },
];

const todayStr = () => new Date().toISOString().slice(0, 10);

// Mirror of pricing.parseModelId: split a raw model id into { provider, key }.
// Drops a leading `<provider>/` segment and an `anthropic.` namespace (the
// provider-prefixed shapes Claude Code started emitting in v2.1.223 —
// `vertex_ai/claude-sonnet-5`, `bedrock/anthropic.claude-opus-5-20260724`),
// then the `claude-` prefix, a `[…]` context suffix (e.g. [1m]), and a trailing
// `-YYYYMMDD` date suffix.
//
// Without the provider handling these ids missed every key AND every alias, fell
// through the opus-only family fallback, and resolved to null — so the dashboard
// priced them at $0 and silently dropped them out of the comparison.
export function parseModelId(id) {
  if (!id) return { provider: null, key: null };
  let s = String(id).toLowerCase().trim();
  let provider = null;
  const slash = s.indexOf('/');
  if (slash > 0) { provider = s.slice(0, slash); s = s.slice(slash + 1); }
  if (s.startsWith('anthropic.')) { provider = provider || 'bedrock'; s = s.slice('anthropic.'.length); }
  const key = s
    .replace(/^claude-/, '')
    .replace(/\[[^\]]*\]$/, '')
    .replace(/-\d{8}$/, '');
  return { provider, key: key || null };
}

function normalizeModel(id) {
  return parseModelId(id).key;
}

// Mirror of pricing.getModelEntry: exact key → alias → opus-* family fallback.
function getModelEntry(modelId) {
  const key = normalizeModel(modelId);
  if (!key) return null;
  if (PRICING.models[key]) return { key, entry: PRICING.models[key] };
  for (const [k, entry] of Object.entries(PRICING.models)) {
    if (Array.isArray(entry.aliases) && entry.aliases.includes(key)) return { key: k, entry };
  }
  if (key.startsWith('opus')) {
    // Newest opus by sort order, never whichever key happens to come first —
    // with retired entries in the table, "first" could mean opus-4 at $15/$75.
    const newest = Object.keys(PRICING.models).filter((k) => k.startsWith('opus')).sort().pop();
    if (newest) return { key: newest, entry: PRICING.models[newest] };
  }
  return null;
}

// Mirror of pricing.effectiveRates: honor a `scheduled` rate array — the newest
// scheduled entry whose effective_date <= today wins (Sonnet 5's Aug-31 step-up).
function effectiveRates(entry, today) {
  let input = entry.input;
  let output = entry.output;
  if (Array.isArray(entry.scheduled)) {
    const due = entry.scheduled
      .filter((s) => s && typeof s.effective_date === 'string' && s.effective_date <= today)
      .sort((a, b) => a.effective_date.localeCompare(b.effective_date));
    const active = due[due.length - 1];
    if (active) {
      if (typeof active.input === 'number') input = active.input;
      if (typeof active.output === 'number') output = active.output;
    }
  }
  return { input, output };
}

function getRates(modelId, today) {
  const resolved = getModelEntry(modelId);
  if (!resolved) return null;
  return {
    ...effectiveRates(resolved.entry, today),
    key: resolved.key,
    // Mirror of pricing.getRates: per-model cache-read multiplier, sheet default
    // when the model does not override it.
    cache_read_multiplier: resolved.entry.cache?.read_multiplier ?? PRICING.cache.read_multiplier,
  };
}

// Mirror of pricing.cacheReadMultiplier. Resolution order: the model's own
// cache.read_multiplier, then the global default.
export function cacheReadMultiplier(modelId) {
  const resolved = getModelEntry(modelId);
  return resolved?.entry?.cache?.read_multiplier ?? PRICING.cache.read_multiplier;
}

// Mirror of cost.expectedCost (standard tier): token×rate, cache read/write at
// their multipliers off the model's INPUT rate. Returns 0 for an unknown model.
//
// The cache-read multiplier is PER-MODEL (2026-09-07). Using the global default
// here would over-price every Fable 5.1 cache read by 4x in the browser, with no
// deploy needed to make it wrong and no error to notice.
export function expectedCost(model, tokens, today = todayStr()) {
  const rates = getRates(model, today);
  if (!rates) return 0;
  const t = tokens || {};
  const cache = PRICING.cache;
  return (
    ((t.input_tokens || 0) / 1_000_000) * rates.input +
    ((t.output_tokens || 0) / 1_000_000) * rates.output +
    ((t.cache_read_tokens || 0) / 1_000_000) * rates.input * rates.cache_read_multiplier +
    ((t.cache_write_tokens || 0) / 1_000_000) * rates.input * cache.write_multiplier
  );
}

function round(n) {
  return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n;
}

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

// Re-price a set of turns across the three comparison models (mirror of the CLI
// repriceSurface). Baseline = the same turns priced at the model each turn was
// ACTUALLY run on (the no-op reference). `today` threads the Sonnet-5 step-up.
export function repriceSurface(turns, { today = todayStr(), days = 30 } = {}) {
  const list = Array.isArray(turns) ? turns : [];
  const monthFactor = days > 0 ? 30 / days : 1;

  let baselineWindow = 0;
  for (const t of list) baselineWindow += expectedCost(t.model, t, today);

  const models = COMPARE_MODELS.map((m) => {
    let windowUsd = 0;
    for (const t of list) windowUsd += expectedCost(m.key, t, today);
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

// Assemble the per-surface comparison for the dashboard tile. `codeTurns` are
// billing-grade terminal turns; `coworkTurns` are labeled-estimate Cowork turns
// (empty when the dashboard has no per-surface Cowork breakdown). Chat is always
// excluded (no local cost data). Mirrors the CLI computeComparison contract.
export function computeComparison({ codeTurns = [], coworkTurns = [], today = todayStr(), days = 30 } = {}) {
  const code = repriceSurface(codeTurns, { today, days });
  const cowork = repriceSurface(coworkTurns, { today, days });

  return {
    days,
    today,
    models: COMPARE_MODELS,
    surfaces: {
      code: { key: 'code', label: 'Code (terminal)', grade: 'billing-grade', ...code },
      cowork: {
        key: 'cowork',
        label: 'Cowork',
        grade: 'estimate',
        // Honest placeholder: the synced dashboard payload carries no per-surface
        // Cowork breakdown, so we render the label + how to get it, never a number.
        available: cowork.present,
        ...cowork,
      },
      chat: {
        key: 'chat',
        label: 'Chat',
        grade: 'excluded',
        present: false,
        reason: 'no local cost data — Chat is not metered on this machine',
      },
    },
    caveats: CAVEATS,
  };
}

// Honesty caveats carried on the tile (mirror of the CLI CAVEATS). No "first/only";
// Fable framed as an allowance cap (never "free"); every projection labeled.
// CORRECTED 2026-09-07 — mirror of the CLI CAVEATS. This copy carried an even
// staler countdown than the CLI's ("through July 7"), live on the dashboard.
// Fable has been permanent and plan-conditional since 2026-07-20.
export const CAVEATS = [
  'Re-prices your recorded usage — not the same task run on each model. A different model emits different token counts for identical work (Sonnet 5’s tokenizer runs ~1.0–1.35× heavier than Opus), so holding tokens fixed understates the true gap. Every projected number is a labeled estimate.',
  'Fable’s row is priced at $10/$50 list. Fable is plan-conditional, not date-limited: included up to 50% of the weekly usage limit on Max, Team Premium and Enterprise Premium, and billed as usage credits on Pro and Team Standard — run `wtclaude fable` for your plan’s reading. Credits figures are at standard API list rates; bundle discounts up to 30% and promos not reflected.',
  'Fable 5.1 and Fable 5 have identical $10/$50 base rates; their cached-input rates differ. A cache read costs $0.25/MTok on Fable 5.1 against $1/MTok on Fable 5, so on a cache-heavy session that gap is most of the difference between the two rows.',
  'Cost, not quality — we surface what the choice costs you; we don’t judge which model is better.',
  'Code is billing-grade (your anchored terminal tokens). Cowork is a labeled estimate (audit-log tokens × rate). Chat is excluded (no local cost data).',
];

// The under-block honesty line — VERBATIM per the build spec. Do not reword.
export const COMPARE_HONESTY_LINE =
  'Comparisons re-price your recorded usage, not the same task run on each model — every projection is a labeled estimate. We surface the cost of the choice; we don’t judge which model is "better."';
