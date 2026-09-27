// ─────────────────────────────────────────────────────────────────────────────
// Browser port of the CLI 3-model re-pricing (src/compare-models/compute.js +
// src/utils/cost.js + src/utils/pricing.js). The CLI modules read the pricing
// config from disk via node:fs, which can't run in the browser — so the rates
// and the token×rate method are mirrored here from config/pricing-2026-09-27.json.
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

// MIRROR of src/config/pricing-2026-09-27.json (USD per million tokens). The CLI
// modules read the rate sheet from disk via node:fs, which cannot run in the
// browser, so the rates are mirrored here — and src/compare-models/web-parity.test.js
// asserts this object still equals the shipped sheet, so the two can never drift
// silently. If that test fails, this block is stale: regenerate it, do not edit
// the test.
//
// This file reaches users at the DEPLOY, not at an npm publish. It has shipped a
// live defect before, so treat every number here as production.
//
// UPDATED 2026-09-27: added Opus 5.5 — Claude Code's default model on every paid
// plan since v2.1.280 (2026-09-22) — and with it a THIRD cache-read multiplier.
// Pricing page §Prompt caching: "Cache read (hit): 0.1x base input price (0.025x
// on Claude Fable 5.1 and Claude Mythos 5.1; 0.05x on Claude Opus 5.5)". Until
// this entry existed, every Opus 5.5 turn fell to the opus family fallback below
// and was priced at Opus 5's rates with NO flag at all — $0.50 cache reads
// against a true $0.20, silently, in every dashboard.
//
// UPDATED 2026-09-07: added Fable 5.1 and Mythos 5.1, and a PER-MODEL cache-read
// multiplier. `cache.read_multiplier` below is the DEFAULT and a model's own
// `cache.read_multiplier` wins.
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
    // Opus 5.5 — Claude Code's default model on every paid plan since v2.1.280
    // (2026-09-22). 0.05x cache reads: $0.20/MTok against Opus 5's $0.50/MTok.
    'opus-5-5': { input: 4.0, output: 20.0, cache: { read_multiplier: 0.05 }, fast_mode: { input: 8.0, output: 40.0 } },
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
// (src/compare-models/compute.js). The rule: Claude Code's CURRENT default per
// family. Opus 5.5 has been the default model on every paid plan since v2.1.280
// (2026-09-22); Fable 5.1 has been the default Fable model since v2.1.257.
//
// Opus 5 was swapped out for Opus 5.5 on 2026-09-27, and Fable 5 for Fable 5.1
// on 2026-09-07. Both are dropped from the COMPARISON only — they stay fully
// priced in the table above so historical turns recorded on them still cost
// correctly, and both remain Active on the Claude API.
export const COMPARE_MODELS = [
  { key: 'opus-5-5', label: 'Opus 5.5' },
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

// Mirror of pricing.getModelEntry: exact key → alias → opus-* family fallback.
// Returns { key, entry, fallback, provider, priceable } or null — the SAME shape
// and flags as the CLI.
//
// FIXED 2026-09-27. This used to return a bare { key, entry }. The family
// fallback fired for real when Opus 5.5 shipped: `claude-opus-5-5` resolved to
// Opus 5 and every Opus 5.5 turn was priced at Opus 5's rates in the baseline,
// with no flag, no exclusion and nothing on the tile to say so. The browser now
// carries the CLI's semantics: a fallback guess or a partner-platform id is
// priceable: false, and repriceSurface() excludes it from both sides, counts it
// and names it, so the tile can render the exclusion.
export function resolveModel(modelId) {
  const { provider, key } = parseModelId(modelId);
  if (!key) return null;
  const wrap = (k, entry, fallback) => ({
    key: k, entry, fallback, provider: provider || null, priceable: !provider && !fallback,
  });
  if (PRICING.models[key]) return wrap(key, PRICING.models[key], false);
  for (const [k, entry] of Object.entries(PRICING.models)) {
    if (Array.isArray(entry.aliases) && entry.aliases.includes(key)) return wrap(k, entry, false);
  }
  if (key.startsWith('opus')) {
    // Newest opus by sort order, never whichever key happens to come first —
    // with retired entries in the table, "first" could mean opus-4 at $15/$75.
    // Flagged: a guess is never a number we present as ours.
    const newest = Object.keys(PRICING.models).filter((k) => k.startsWith('opus')).sort().pop();
    if (newest) return wrap(newest, PRICING.models[newest], true);
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
  const resolved = resolveModel(modelId);
  if (!resolved) return null;
  return {
    ...effectiveRates(resolved.entry, today),
    key: resolved.key,
    fallback: resolved.fallback,
    provider: resolved.provider,
    priceable: resolved.priceable,
    // Mirror of pricing.getRates: per-model cache-read multiplier, sheet default
    // when the model does not override it.
    cache_read_multiplier: resolved.entry.cache?.read_multiplier ?? PRICING.cache.read_multiplier,
  };
}

// Mirror of pricing.cacheReadMultiplier. Resolution order: the model's own
// cache.read_multiplier, then the global default.
export function cacheReadMultiplier(modelId) {
  const resolved = resolveModel(modelId);
  return resolved?.entry?.cache?.read_multiplier ?? PRICING.cache.read_multiplier;
}

// Mirror of cost.priceTurn (standard tier): token×rate, cache read/write at their
// multipliers off the model's INPUT rate, plus whether the figure is one we can
// present as ours. `priceable: false` means unresolved, partner-served, or a
// family-fallback guess — the same three cases, and the same `reason` strings,
// as the CLI.
//
// The cache-read multiplier is PER-MODEL — 0.025x Fable 5.1 / Mythos 5.1, 0.05x
// Opus 5.5, 0.1x everything else. Using the global default here would over-price
// a Fable 5.1 cache read 4x and an Opus 5.5 cache read 2x, in the browser, with
// no deploy needed to make it wrong and no error to notice.
export function priceTurn(model, tokens, today = todayStr()) {
  const rates = getRates(model, today);
  if (!rates) return { usd: 0, priceable: false, reason: 'unresolved-model' };
  const t = tokens || {};
  const cache = PRICING.cache;
  const usd =
    ((t.input_tokens || 0) / 1_000_000) * rates.input +
    ((t.output_tokens || 0) / 1_000_000) * rates.output +
    ((t.cache_read_tokens || 0) / 1_000_000) * rates.input * rates.cache_read_multiplier +
    ((t.cache_write_tokens || 0) / 1_000_000) * rates.input * cache.write_multiplier;
  if (rates.provider) return { usd, priceable: false, reason: `partner-platform:${rates.provider}` };
  if (rates.fallback) return { usd, priceable: false, reason: `family-fallback:${rates.key}` };
  return { usd, priceable: true, reason: null };
}

// Mirror of cost.expectedCost: the numeric figure only. Returns 0 for an unknown
// model. Callers that need to know whether the figure is presentable use
// priceTurn() — a bare number is exactly how an unknown model used to vanish.
export function expectedCost(model, tokens, today = todayStr()) {
  return priceTurn(model, tokens, today).usd;
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
// ACTUALLY run on (the no-op reference).
//
// Turns we cannot price at first-party rates — an unresolved model, a
// partner-platform id, or a family-fallback guess — are EXCLUDED from both sides
// and counted, exactly as the CLI does (added here 2026-09-27; the mirror used to
// price them silently). The tile renders `unpriced_turn_count` /
// `unpriced_models`, so the exclusion is never invisible.
export function repriceSurface(turns, { today = todayStr(), days = 30 } = {}) {
  const all = Array.isArray(turns) ? turns : [];
  const monthFactor = days > 0 ? 30 / days : 1;

  const list = [];
  const unpriced = [];
  for (const t of all) {
    if (priceTurn(t.model, t, today).priceable) list.push(t);
    else unpriced.push(t);
  }

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
    unpriced_turn_count: unpriced.length,
    unpriced_models: [...new Set(unpriced.map((t) => t.model).filter(Boolean))],
    tokens: sumTokens(list),
    baseline_window_usd: round(baselineWindow),
    baseline_monthly_usd: round(baselineWindow * monthFactor),
    models,
  };
}

// Build the billing-grade "Code (terminal)" re-priceable turns from the synced
// dashboard payload. The payload carries session-level aggregate tokens plus
// per-session models_used turn counts (per-turn detail is not synced), so we
// attribute each session's tokens across its models by turn-share — the same
// honest attribution derive.costByModel uses. Each per-model bucket becomes ONE
// re-priceable "turn" tagged with the model the user ACTUALLY ran, so the
// baseline prices at the real mix and a no-op switch nets ~$0.
export function codeTurnsFromSessions(sessions) {
  const turns = [];
  for (const s of sessions || []) {
    const models = s.models_used || {};
    const totalTurns = Object.values(models).reduce((a, b) => a + b, 0) || 1;
    const inTok = Number(s.total_input_tokens || 0);
    const outTok = Number(s.total_output_tokens || 0);
    const cr = Number(s.total_cache_read || 0);
    const cw = Number(s.total_cache_write || 0);
    for (const [model, count] of Object.entries(models)) {
      const share = count / totalTurns;
      turns.push({
        model,
        input_tokens: inTok * share,
        output_tokens: outTok * share,
        cache_read_tokens: cr * share,
        cache_write_tokens: cw * share,
      });
    }
  }
  return turns;
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
// EXTENDED 2026-09-27 with the Opus 5.5 rate caveat, built from THIS table by
// the same function shape as the CLI's; web-parity.test.js asserts the two
// arrays are identical, string for string.
function rateCard(key) {
  const r = getRates(`claude-${key}`, todayStr());
  return { input: r.input, output: r.output, cacheRead: r.input * r.cache_read_multiplier };
}

export function opusRateCaveat(next, prev) {
  const less = (a, b) => Math.round((1 - a / b) * 100);
  const inPct = less(next.input, prev.input);
  const outPct = less(next.output, prev.output);
  const io = inPct === outPct ? `${inPct}% less in and out` : `${inPct}% less in and ${outPct}% less out`;
  const usd = (n) => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`);
  return `Opus 5.5 is priced at ${usd(next.input)}/${usd(next.output)} per MTok with cache reads at ${usd(next.cacheRead)}, against Opus 5’s ${usd(prev.input)}/${usd(prev.output)} and ${usd(prev.cacheRead)} — so identical tokens cost ${io}, and ${less(next.cacheRead, prev.cacheRead)}% less on cache reads. Re-pricing holds your token counts fixed, so it reflects that rate difference alone — not any change in how many tokens a model spends on the same work.`;
}

export const CAVEATS = [
  'Re-prices your recorded usage — not the same task run on each model. A different model emits different token counts for identical work (Sonnet 5’s tokenizer runs ~1.0–1.35× heavier than Opus), so holding tokens fixed understates the true gap. Every projected number is a labeled estimate.',
  'Fable’s row is priced at $10/$50 list. Fable is plan-conditional, not date-limited: included up to 50% of the weekly usage limit on Max, Team Premium and Enterprise Premium, and billed as usage credits on Pro and Team Standard — run `wtclaude fable` for your plan’s reading. Credits figures are at standard API list rates; bundle discounts up to 30% and promos not reflected.',
  'Fable 5.1 and Fable 5 have identical $10/$50 base rates; their cached-input rates differ. A cache read costs $0.25/MTok on Fable 5.1 against $1/MTok on Fable 5, so on a cache-heavy session that gap is most of the difference between the two rows.',
  opusRateCaveat(rateCard('opus-5-5'), rateCard('opus-5')),
  'Cost, not quality — we surface what the choice costs you; we don’t judge which model is better.',
  'Code is billing-grade (your anchored terminal tokens). Cowork is a labeled estimate (audit-log tokens × rate). Chat is excluded (no local cost data).',
];

// The under-block honesty line — VERBATIM per the build spec. Do not reword.
export const COMPARE_HONESTY_LINE =
  'Comparisons re-price your recorded usage, not the same task run on each model — every projection is a labeled estimate. We surface the cost of the choice; we don’t judge which model is "better."';
