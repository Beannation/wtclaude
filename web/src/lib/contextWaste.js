// ─────────────────────────────────────────────────────────────────────────────
// Browser port of the CLI dead-weight computation (src/waste/compute.js). The
// CLI reads pricing from disk via node:fs; here the rates + the exact cache-read
// mechanics are mirrored from config/pricing-2026-06-30.json. Keep in lock-step
// with the CLI so the dashboard tile can never drift.
//
// The honest wedge (identical to the CLI):
//  • Cost is grounded in BILLING-GRADE mechanics: your real per-turn cache-read
//    count, the model's real input rate, and the EXACT 10% cache-read multiplier.
//    Dead weight is re-read at cache-read rates on every turn after the first —
//    that's the real mechanism (NOT a "cache hit rate" story). It also bloats the
//    context window and degrades tool selection.
//  • The only ESTIMATE is the token SIZE of each item's prose (labeled). So the
//    dollar is an estimate of MAGNITUDE built on billing-grade mechanics.
//  • Recommend-only: verdicts are KEEP / REVIEW. Never a destructive verdict,
//    never "never used = useless." A rarely-but-critically-used skill (deploy,
//    incident response) stays REVIEW, not condemned.
// ─────────────────────────────────────────────────────────────────────────────

// Mirror of the input rates in src/config/pricing-2026-08-24.json. Pinned to the
// shipped sheet by src/compare-models/web-parity.test.js — if that test fails,
// this table is stale; regenerate it rather than editing the test.
const CACHE_READ_MULTIPLIER = 0.1;
// Default input rate when no model is supplied — Sonnet 5's rate, matching the
// CLI fallback (pricing.models['sonnet-5'].input).
const DEFAULT_INPUT_RATE = 2.0;

// COMPLETED 2026-08-24. This table previously held five models and, crucially,
// no `opus-5`. Opus 5 has been Claude Code's default `opus` since v2.1.219, so
// every Opus 5 user fell through to DEFAULT_INPUT_RATE — Sonnet's $2 against a
// real $5, a 2.5x under-estimate of their context-waste cost, on the dashboard
// tile whose entire job is to size that cost.
export const INPUT_RATE_BY_MODEL = {
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
  'fable-5': 10.0,
  'mythos-5': 10.0,
};

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}

// Pure dead-weight computation (mirror of computeWaste). Inventory + evidence are
// injected so this is fully testable and driven by fixture data when present.
//   items:   [{ id, type, name, source, tokens, chars }]
//   usedIds: Set|Array of item ids invoked in the look-back window
//   turns:   billing-grade turn count from the transcript
export function computeWaste({ items = [], usedIds = new Set(), turns = 0, days = 30, model } = {}) {
  const inputRate =
    (model && INPUT_RATE_BY_MODEL[model]) != null ? INPUT_RATE_BY_MODEL[model] : DEFAULT_INPUT_RATE;

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
  // Re-read at cache-read rates on every turn AFTER the first — the real mechanism.
  const perTurnUsd = (deadTokens / 1_000_000) * inputRate * CACHE_READ_MULTIPLIER;
  const windowUsd = perTurnUsd * turns;
  const monthlyUsd = days > 0 ? windowUsd * (30 / days) : windowUsd;

  return {
    days,
    turns,
    loaded_count: items.length,
    used_count: scored.length - dead.length,
    dead_count: dead.length,
    dead_tokens: deadTokens,
    input_rate: inputRate,
    cache_read_multiplier: CACHE_READ_MULTIPLIER,
    model: model || null,
    per_turn_usd: round(perTurnUsd),
    window_usd: round(windowUsd),
    monthly_usd: round(monthlyUsd),
    items: scored,
    // Per-number honesty labels (mirror of the CLI): token SIZE is an estimate;
    // turns / rate / multiplier are billing-grade.
    labels: {
      dead_tokens: 'estimate',
      per_turn_usd: 'estimate',
      window_usd: 'estimate',
      monthly_usd: 'estimate',
      turns: 'billing-grade',
      cache_read_multiplier: 'billing-grade',
      input_rate: 'billing-grade',
    },
  };
}

// The three ways dead weight costs you — surfaced on the tile so the mechanism is
// explicit and it never collapses to a "cache hit rate" story.
export const WASTE_MECHANISMS = [
  {
    title: 'Re-read every turn',
    body: 'Always-loaded items you never invoke are re-sent on every turn after the first, billed at the cache-read rate (10% of the input rate). Small per turn, compounding across a month.',
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
