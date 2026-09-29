// ─────────────────────────────────────────────────────────────────────────────
// Browser port of the CLI dead-weight computation (src/waste/compute.js). The
// CLI reads pricing from disk via node:fs; here the rates + the exact cache-read
// mechanics are mirrored from config/pricing-2026-09-27.json. Keep in lock-step
// with the CLI so the dashboard tile can never drift.
//
// The honest wedge (identical to the CLI):
//  • Cost is grounded in BILLING-GRADE mechanics: your real per-turn cache-read
//    count, the model's real input rate, and its exact cache-read multiplier
//    (per-model: 0.025x on Fable 5.1 / Mythos 5.1, 0.05x on Opus 5.5, 0.1x on
//    everything else).
//    Dead weight is re-read at cache-read rates on every turn after the first —
//    that's the real mechanism (NOT a "cache hit rate" story). It also bloats the
//    context window and degrades tool selection.
//  • The only ESTIMATE is the token SIZE of each item's prose (labeled). So the
//    dollar is an estimate of MAGNITUDE built on billing-grade mechanics.
//  • Recommend-only: verdicts are KEEP / REVIEW. Never a destructive verdict,
//    never "never used = useless." A rarely-but-critically-used skill (deploy,
//    incident response) stays REVIEW, not condemned.
// ─────────────────────────────────────────────────────────────────────────────

import { resolveModel } from './compareModels.js';

// Mirror of the input rates in src/config/pricing-2026-09-27.json. Pinned to the
// shipped sheet by src/compare-models/web-parity.test.js — if that test fails,
// this table is stale; regenerate it rather than editing the test.
//
// DEFAULT cache-read multiplier. Per-model since 2026-09-07 and three-valued
// since 2026-09-27: Fable 5.1 and Mythos 5.1 price cache hits at 0.025x base
// input, Opus 5.5 at 0.05x, every other model at 0.1x (Anthropic pricing page,
// §Prompt caching). Dead weight is re-read at the CACHE-READ rate on every turn,
// so this multiplier IS the dollar figure on this tile — applying 0.1x to a
// Fable 5.1 session overstates that user's dead weight 4x, an Opus 5.5 session's
// 2x. Resolution order: CACHE_READ_MULTIPLIER_BY_MODEL, then this default.
const CACHE_READ_MULTIPLIER = 0.1;

// REMOVED 2026-09-27: DEFAULT_INPUT_RATE (Sonnet 5's $2). A model this table did
// not know was priced at Sonnet's rate and the rate labelled "billing-grade".
// For Opus 5.5 the dollar figure landed on the true $0.20/MTok by coincidence
// ($2 x 0.1 = $4 x 0.05) while the tile named a wrong input rate and a wrong
// multiplier as billing-grade. An unknown model now withholds the figure —
// exactly as the CLI's computeWaste() does.

// Per-model cache-read overrides. Only models that DIFFER from the default
// appear here, mirroring the rate sheet's own shape (a model with no `cache`
// block inherits the global multiplier).
export const CACHE_READ_MULTIPLIER_BY_MODEL = {
  'opus-5-5': 0.05,
  'fable-5-1': 0.025,
  'mythos-5-1': 0.025,
};

// COMPLETED 2026-08-24. This table previously held five models and, crucially,
// no `opus-5`. Opus 5 was Claude Code's default `opus` from v2.1.219 (until v2.1.280), so
// every Opus 5 user fell through to DEFAULT_INPUT_RATE — Sonnet's $2 against a
// real $5, a 2.5x under-estimate of their context-waste cost, on the dashboard
// tile whose entire job is to size that cost.
//
// EXTENDED 2026-09-07 with fable-5-1 / mythos-5-1. Same failure shape: Fable 5.1
// is Claude Code's default Fable model, so without these rows every Fable 5.1
// user would fall through to Sonnet's $2 against a real $10.
//
// EXTENDED 2026-09-27 with opus-5-5 — Claude Code's default model on every paid
// plan since v2.1.280. Without it, every Opus 5.5 user fell through to the
// Sonnet default and the tile labelled that guess billing-grade.
export const INPUT_RATE_BY_MODEL = {
  'opus-5-5': 4.0,
  'opus-5': 5.0,
  'opus-4-8': 5.0,
  'opus-4-7': 5.0,
  'opus-4-6': 5.0,
  'opus-4-5': 5.0,
  'opus-4-1': 15.0,
  'opus-4': 15.0,
  'sonnet-5': 2.0,
  'sonnet-4-6': 3.0,
  'sonnet-4-5': 3.0,
  'sonnet-4': 3.0,
  'haiku-4-5': 1.0,
  'haiku-3-5': 0.8,
  'fable-5-1': 10.0,
  'fable-5': 10.0,
  'mythos-5-1': 10.0,
  'mythos-5': 10.0,
};

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

function nullableRound(n) {
  return n === null ? null : round(n);
}

// Pure dead-weight computation (mirror of computeWaste). Inventory + evidence are
// injected so this is fully testable and driven by fixture data when present.
//   items:   [{ id, type, name, source, tokens, chars }]
//   usedIds: Set|Array of item ids invoked in the look-back window
//   turns:   billing-grade turn count from the transcript
//   model:   a raw model id (`claude-opus-5-5[1m]`) or a rate-table key
//            (`opus-5-5`) — both resolve the same way the CLI's getRates() does.
//
// Withhold, don't guess (mirror of the CLI, 2026-09-27): no model, an unknown
// model, a partner-platform id or a family-fallback guess returns null dollar
// figures with `unpriced_reason` in the CLI's vocabulary. The inventory and token
// sizes do not depend on the rate and are still returned.
export function computeWaste({ items = [], usedIds = new Set(), turns = 0, days = 30, model } = {}) {
  const resolved = model ? resolveModel(model) : null;
  const key = resolved ? resolved.key : null;
  let unpricedReason = null;
  if (!model) unpricedReason = 'no-model';
  else if (!resolved || INPUT_RATE_BY_MODEL[key] == null) unpricedReason = 'unresolved-model';
  else if (resolved.provider) unpricedReason = `partner-platform:${resolved.provider}`;
  else if (resolved.fallback) unpricedReason = `family-fallback:${key}`;
  const priced = unpricedReason === null;

  const inputRate = priced ? INPUT_RATE_BY_MODEL[key] : null;
  // Per-model cache-read multiplier, default when the model does not override it.
  const cacheReadMultiplier = priced
    ? (CACHE_READ_MULTIPLIER_BY_MODEL[key] ?? CACHE_READ_MULTIPLIER)
    : null;

  const used = usedIds instanceof Set ? usedIds : new Set(usedIds);
  const scored = items.map((it) => {
    const isUsed = used.has(it.id);
    return {
      id: it.id,
      type: it.type,
      name: it.name,
      source: it.source,
      tokens: it.tokens,
      chars: it.chars,
      used: isUsed,
      // Verdicts are KEEP / REVIEW only — never a destructive verdict.
      verdict: isUsed ? 'KEEP' : 'REVIEW',
      why: isUsed
        ? 'invoked in the look-back window'
        : `loaded every session, no invocation in ${days}d — review whether it earns its context (never used ≠ never useful)`,
    };
  });

  const dead = scored.filter((s) => !s.used);
  const deadTokens = dead.reduce((a, s) => a + (s.tokens || 0), 0);
  // Nothing to re-read => $0 on any rate, so it is safe to state even withheld.
  const nothingToPrice = deadTokens === 0 || !turns;
  let perTurnUsd = null;
  let windowUsd = null;
  let monthlyUsd = null;
  if (priced) {
    // Re-read at cache-read rates on every turn AFTER the first — the real mechanism.
    perTurnUsd = (deadTokens / 1_000_000) * inputRate * cacheReadMultiplier;
    windowUsd = perTurnUsd * turns;
    monthlyUsd = days > 0 ? windowUsd * (30 / days) : windowUsd;
  } else if (nothingToPrice) {
    perTurnUsd = 0;
    windowUsd = 0;
    monthlyUsd = 0;
  }
  const usdLabel = perTurnUsd === null ? 'withheld' : 'estimate';
  const rateLabel = priced ? 'billing-grade' : 'unavailable';

  return {
    days,
    turns,
    loaded_count: items.length,
    used_count: scored.length - dead.length,
    dead_count: dead.length,
    dead_tokens: deadTokens,
    input_rate: inputRate,
    cache_read_multiplier: cacheReadMultiplier,
    model: resolved && resolved.fallback ? null : (key || model || null),
    model_id: model || null,
    priced,
    unpriced_reason: unpricedReason,
    per_turn_usd: nullableRound(perTurnUsd),
    window_usd: nullableRound(windowUsd),
    monthly_usd: nullableRound(monthlyUsd),
    items: scored,
    // Per-number honesty labels (mirror of the CLI): token SIZE is an estimate;
    // turns are billing-grade; rate and multiplier are billing-grade only when
    // the model resolved to a rate we can stand behind.
    labels: {
      dead_tokens: 'estimate',
      per_turn_usd: usdLabel,
      window_usd: usdLabel,
      monthly_usd: usdLabel,
      turns: 'billing-grade',
      cache_read_multiplier: rateLabel,
      input_rate: rateLabel,
    },
  };
}

// The three ways dead weight costs you — surfaced on the tile so the mechanism is
// explicit and it never collapses to a "cache hit rate" story.
export const WASTE_MECHANISMS = [
  {
    title: 'Re-read every turn',
    body: "Always-loaded items you never invoke are re-sent on every turn after the first, billed at the cache-read rate of the model that ran the turn — a fraction of its input rate. Small per turn, compounding across a month.",
  },
  {
    title: 'Context-window bloat',
    body: 'Unused prose occupies the window, crowding out room for the code and files that actually matter to the task at hand.',
  },
  {
    title: 'Worse tool selection',
    body: 'More always-on tools and skills means more for the model to disambiguate — a longer menu makes the right choice harder, not easier.',
  },
];

// Pull a waste-shaped inventory out of the dashboard payload if one is present.
// The synced payload has no ~/.claude scan (the browser can't read the filesystem),
// so this returns null unless a fixture explicitly carries `context_inventory`.
// When null, the tile renders the honest "run `wtclaude waste`" explanatory state.
export function wasteFromDashboard(data) {
  const inv = data && data.context_inventory;
  if (!inv || !Array.isArray(inv.items) || inv.items.length === 0) return null;
  return computeWaste({
    items: inv.items,
    usedIds: inv.used_ids || [],
    turns: inv.turns || 0,
    days: inv.days || 30,
    model: inv.model,
  });
}
