import { getRates } from '../utils/pricing.js';

// Pure dead-weight computation (feature D — `wtclaude waste`). Inventory + evidence
// are injected so this is fully unit-testable without touching disk.
//
// The honest wedge (scope + build prompt):
//  • Cost is grounded in BILLING-GRADE mechanics: your real per-turn cache-read count
//    (from the transcript), the model's real input rate, and its exact cache-read
//    multiplier (PER-MODEL: 0.025x on Fable 5.1 / Mythos 5.1, 0.05x on Opus 5.5,
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
  const rates = model ? getRates(model, 'standard', today) : null;

  // THE FAMILY-FALLBACK CLASS (fixed 2026-09-27). This used to take getRates()
  // at face value. When Opus 5.5 shipped as Claude Code's default model, its id
  // missed the rate sheet, fell to the opus family fallback, and this function
  // priced an Opus 5.5 user's dead weight at Opus 5's cache read — $0.50/MTok
  // against a true $0.20, 2.5x — and labelled the rate and multiplier
  // "billing-grade". A family-fallback rate is a guess; so is a first-party rate
  // for a partner-served id, and so is a default rate for a model we could not
  // read at all. None of them may produce a dollar figure presented as ours.
  //
  // Decision: WITHHOLD, not label. Every dollar on this surface is rate x
  // multiplier x tokens, so a guessed rate is a guessed figure end to end, and
  // an "approximately" label on it would still put our number on it. The item
  // inventory and token sizes do not depend on the rate and are still returned.
  // `unpriced_reason` says why, in the same vocabulary priceTurn() uses.
  let unpricedReason = null;
  if (!model) unpricedReason = 'no-model';
  else if (!rates) unpricedReason = 'unresolved-model';
  else if (rates.provider) unpricedReason = `partner-platform:${rates.provider}`;
  else if (rates.fallback) unpricedReason = `family-fallback:${rates.key}`;
  const priced = unpricedReason === null;

  const inputRate = priced ? rates.input : null;
  // PER-MODEL cache-read multiplier: 0.025x on Fable 5.1 / Mythos 5.1, 0.05x on
  // Opus 5.5, 0.1x everywhere else. Dead weight is re-read at the CACHE-READ
  // rate on every turn, so this multiplier is the whole dollar figure — using
  // the sheet-wide default would overstate a Fable 5.1 user's dead weight 4x and
  // an Opus 5.5 user's 2x.
  const cacheReadMultiplier = priced ? rates.cache_read_multiplier : null;

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
  // With nothing to re-read (no dead tokens, or no turns) the figure is $0 on
  // any rate, so it is safe to state even when the rate is withheld.
  const nothingToPrice = deadTokens === 0 || !turns;
  let perTurnUsd = null, windowUsd = null, monthlyUsd = null;
  if (priced) {
    perTurnUsd = deadTokens / 1_000_000 * inputRate * cacheReadMultiplier;
    windowUsd = perTurnUsd * turns;
    monthlyUsd = days > 0 ? windowUsd * (30 / days) : windowUsd;
  } else if (nothingToPrice) {
    perTurnUsd = 0; windowUsd = 0; monthlyUsd = 0;
  }
  const usdLabel = perTurnUsd === null ? 'withheld' : 'estimate';
  const rateLabel = priced ? 'billing-grade' : 'unavailable';

  return {
    days, turns,
    loaded_count: items.length,
    used_count: scored.length - dead.length,
    dead_count: dead.length,
    dead_tokens: deadTokens,
    input_rate: inputRate,
    cache_read_multiplier: cacheReadMultiplier,
    // Never name the fallback's guess as the model (2026-09-27): on a
    // family fallback `rates.key` is the nearest Opus, not what the user ran.
    model: rates ? (rates.fallback ? null : rates.key) : (model || null),
    model_id: model || null,
    priced,
    unpriced_reason: unpricedReason,
    per_turn_usd: nullableRound(perTurnUsd),
    window_usd: nullableRound(windowUsd),
    monthly_usd: nullableRound(monthlyUsd),
    items: scored,
    // Per-number honesty labels (build prompt: --json carries a label per figure).
    labels: {
      dead_tokens: 'estimate',            // token size of prose is estimated
      per_turn_usd: usdLabel,
      window_usd: usdLabel,
      monthly_usd: usdLabel,
      turns: 'billing-grade',             // real, from your transcript
      cache_read_multiplier: rateLabel,
      input_rate: rateLabel,
    },
  };
}

function round(n) { return Math.round(n * 1e6) / 1e6; }
function nullableRound(n) { return n === null ? null : round(n); }
