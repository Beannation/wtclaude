import { getLatestPricing, getRates } from '../utils/pricing.js';

// Pure dead-weight computation (feature D — `wtclaude waste`). Inventory + evidence
// are injected so this is fully unit-testable without touching disk.
//
// The honest wedge (scope + build prompt):
//  • Cost is grounded in BILLING-GRADE mechanics: your real per-turn cache-read count
//    (from the transcript), the model's real input rate, and its exact cache-read
//    multiplier (PER-MODEL since 2026-09-07: 0.025x on Fable 5.1 / Mythos 5.1,
//    0.1x on every other model). Dead weight is re-read at cache-read rates on
//    every turn after the first — that's the real mechanism (NOT a "cache hit
//    rate" story).
//  • The only ESTIMATE is the token SIZE of each item's prose (labeled everywhere).
//    So the dollar is an estimate of MAGNITUDE built on billing-grade mechanics —
//    not a crude chars/3.7 guess paraded as exact.
//  • Recommend-only: verdicts are KEEP / REVIEW. Never a destructive "remove," never
//    "never used = useless." A rarely-but-critically-used skill (deploy, incident
//    response) stays REVIEW, not condemned.
export function computeWaste({ items = [], usedIds = new Set(), turns = 0, days = 30, model, today } = {}) {
  const pricing = getLatestPricing();
  const rates = model ? getRates(model, 'standard', today) : null;
  const inputRate = rates ? rates.input : (pricing.models['sonnet-5']?.input ?? 2);
  // PER-MODEL cache-read multiplier (2026-09-07 sheet): 0.025x on Fable 5.1 /
  // Mythos 5.1, 0.1x everywhere else. Dead weight is re-read at the CACHE-READ
  // rate on every turn, so this multiplier is the whole dollar figure — using
  // the sheet-wide default on a Fable 5.1 session would overstate that user's
  // dead weight 4x. The default only applies when no model was supplied.
  const cacheReadMultiplier = rates
    ? rates.cache_read_multiplier
    : (pricing.cache.read_multiplier ?? 0.10);

  const used = usedIds instanceof Set ? usedIds : new Set(usedIds);
  const scored = items.map(it => {
    const isUsed = used.has(it.id);
    return {
      id: it.id, type: it.type, name: it.name, source: it.source,
      tokens: it.tokens, chars: it.chars,
      used: isUsed,
      verdict: isUsed ? 'KEEP' : 'REVIEW',
      why: isUsed
        ? 'invoked in the look-back window'
        : `loaded every session, no invocation in ${days}d — review whether it earns its context (never used ≠ never useful)`,
    };
  });

  const dead = scored.filter(s => !s.used);
  const deadTokens = dead.reduce((a, s) => a + (s.tokens || 0), 0);
  const perTurnUsd = deadTokens / 1_000_000 * inputRate * cacheReadMultiplier;
  const windowUsd = perTurnUsd * turns;
  const monthlyUsd = days > 0 ? windowUsd * (30 / days) : windowUsd;

  return {
    days, turns,
    loaded_count: items.length,
    used_count: scored.length - dead.length,
    dead_count: dead.length,
    dead_tokens: deadTokens,
    input_rate: inputRate,
    cache_read_multiplier: cacheReadMultiplier,
    model: rates ? rates.key : (model || null),
    per_turn_usd: round(perTurnUsd),
    window_usd: round(windowUsd),
    monthly_usd: round(monthlyUsd),
    items: scored,
    // Per-number honesty labels (build prompt: --json carries a label per figure).
    labels: {
      dead_tokens: 'estimate',            // token size of prose is estimated
      per_turn_usd: 'estimate',
      window_usd: 'estimate',
      monthly_usd: 'estimate',
      turns: 'billing-grade',             // real, from your transcript
      cache_read_multiplier: 'billing-grade',
      input_rate: 'billing-grade',
    },
  };
}

function round(n) { return Math.round(n * 1e6) / 1e6; }
