// ─────────────────────────────────────────────────────────────────────────────
// Browser port of the CLI 3-model re-pricing (src/compare-models/compute.js +
// src/utils/cost.js + src/utils/pricing.js). The CLI modules read the pricing
// config from disk via node:fs, which can't run in the browser — so the rates
// and the token×rate method are mirrored here from config/pricing-2026-06-30.json.
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

// Ported from config/pricing-2026-06-30.json (USD per million tokens). Sonnet 5
// ships at the introductory $2/$10 rate through 2026-08-31, then steps up to
// $3/$15 on the scheduled date — encoded exactly as the config does so the
// browser resolves the dated step-up the same way getRates() does server-side.
export const PRICING = {
  cache: { read_multiplier: 0.1, write_multiplier: 0.25 },
  models: {
    'opus-4-8': { input: 5.0, output: 25.0, aliases: ['opus-4-7', 'opus-4-6'] },
    'sonnet-5': {
      input: 2.0,
      output: 10.0,
      scheduled: [{ effective_date: '2026-08-31', input: 3.0, output: 15.0 }],
    },
    'fable-5': { input: 10.0, output: 50.0 },
    // Carried for baseline re-pricing of legacy/other models in recorded usage.
    'sonnet-4-6': { input: 3.0, output: 15.0 },
    'haiku-4-5': { input: 1.0, output: 5.0 },
  },
};

// The three models compared — newest-generation keys, matching COMPARE_MODELS in
// the CLI (src/compare-models/compute.js) and the pricing config keys.
export const COMPARE_MODELS = [
  { key: 'opus-4-8', label: 'Opus 4.8' },
  { key: 'sonnet-5', label: 'Sonnet 5' },
  { key: 'fable-5', label: 'Fable 5' },
];

const todayStr = () => new Date().toISOString().slice(0, 10);

// Mirror of pricing.normalizeModel: drop the `claude-` prefix, a `[…]` context
// suffix (e.g. [1m]), and a trailing `-YYYYMMDD` date suffix.
function normalizeModel(id) {
  if (!id) return null;
  return String(id)
    .toLowerCase()
    .replace(/^claude-/, '')
    .replace(/\[[^\]]*\]$/, '')
    .replace(/-\d{8}$/, '');
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
    const fam = Object.entries(PRICING.models).find(([k]) => k.startsWith('opus'));
    if (fam) return { key: fam[0], entry: fam[1] };
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
  return { ...effectiveRates(resolved.entry, today), key: resolved.key };
}

// Mirror of cost.expectedCost (standard tier): token×rate, cache read/write at
// their multipliers off the model's INPUT rate. Returns 0 for an unknown model.
export function expectedCost(model, tokens, today = todayStr()) {
  const rates = getRates(model, today);
  if (!rates) return 0;
  const t = tokens || {};
  const cache = PRICING.cache;
  return (
    ((t.input_tokens || 0) / 1_000_000) * rates.input +
    ((t.output_tokens || 0) / 1_000_000) * rates.output +
    ((t.cache_read_tokens || 0) / 1_000_000) * rates.input * cache.read_multiplier +
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
export const CAVEATS = [
  'Re-prices your recorded usage — not the same task run on each model. A different model emits different token counts for identical work (Sonnet 5’s tokenizer runs ~1.0–1.35× heavier than Opus), so holding tokens fixed understates the true gap. Every projected number is a labeled estimate.',
  'Fable’s row is priced as usage credits at $10/$50. Fable is included up to 50% of the weekly limit through July 7, then usage credits at $10/$50 — run `wtclaude fable` for the July-7 forecast.',
  'Cost, not quality — we surface what the choice costs you; we don’t judge which model is better.',
  'Code is billing-grade (your anchored terminal tokens). Cowork is a labeled estimate (audit-log tokens × rate). Chat is excluded (no local cost data).',
];

// The under-block honesty line — VERBATIM per the build spec. Do not reword.
export const COMPARE_HONESTY_LINE =
  'Comparisons re-price your recorded usage, not the same task run on each model — every projection is a labeled estimate. We surface the cost of the choice; we don’t judge which model is "better."';
