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
//
// Turns come PER MODEL (`modelTurns`, QA-0928-20): each model's turns are priced
// at that model's own rate and multiplier. Callers with one model for every turn
// may still pass `model` + `turns`.

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
//
// QA-0928-20 (2026-09-28): that check ran on the dominant model only, and every
// turn — unknown and partner-served ones included — was priced at the dominant
// model's rate. It now runs per model: an unpriceable model's turns are left out
// of the figure and returned in `excluded_models` for the CLI to name. The
// figure is withheld only when no turn at all can be priced.
function unpricedReasonFor(model, rates) {
  if (!model) return 'no-model';
  if (!rates) return 'unresolved-model';
  if (rates.provider) return `partner-platform:${rates.provider}`;
  if (rates.fallback) return `family-fallback:${rates.key}`;
  return null;
}

// QA-0928-71 (2026-09-28): CLAUDE.md files are read every turn and cannot be
// invoked, so "no invocation in 30d" was true of them by construction and their
// tokens always landed in the dead-weight dollar figure. They are listed, with
// their size, but never judged and never counted as dead weight.
const NOT_JUDGED_WHY = 'always loaded — not invocable, so no invocation evidence';

// `coveredDays` (RC 2026-09-28, QA-0928-22 in waste): the days of transcript
// data the window covers (utils/window.js coveredDays). The /mo figure scales
// the window's cost by 30 / coveredDays, as every other projection does;
// without it the requested window is the basis.
export function computeWaste({ items = [], usedIds = new Set(), turns = 0, modelTurns, days = 30, coveredDays = null, model, today } = {}) {
  const covered = coveredDays > 0 ? Math.min(coveredDays, days) : days;
  const mix = modelTurns && typeof modelTurns === 'object' ? modelTurns : (model ? { [model]: turns } : {});
  const resolved = Object.entries(mix)
    .map(([id, n]) => {
      const rates = getRates(id, 'standard', today);
      return { id, turns: n || 0, rates, reason: unpricedReasonFor(id, rates) };
    })
    .sort((a, b) => b.turns - a.turns);
  const pricedModels = resolved.filter(m => m.reason === null);
  const unpricedModels = resolved.filter(m => m.reason !== null);
  const priced = pricedModels.length > 0;

  // Turns the evidence could not attribute to any model are excluded too.
  const knownTurns = resolved.reduce((a, m) => a + m.turns, 0);
  const noModelTurns = Math.max(0, turns - knownTurns);
  const excluded = unpricedModels.filter(m => m.turns > 0).map(m => ({ model: m.id, turns: m.turns, reason: m.reason }));
  if (noModelTurns > 0 && Object.keys(mix).length > 0) excluded.push({ model: null, turns: noModelTurns, reason: 'no-model' });

  // The dominant model (most turns) keeps the single-model fields meaningful.
  const top = resolved[0] || null;
  const unpricedReason = priced ? null : (top ? top.reason : 'no-model');

  // PER-MODEL cache-read multiplier: 0.025x on Fable 5.1 / Mythos 5.1, 0.05x on
  // Opus 5.5, 0.1x everywhere else. Dead weight is re-read at the CACHE-READ
  // rate on every turn, so this multiplier is the whole dollar figure — using
  // the sheet-wide default would overstate a Fable 5.1 user's dead weight 4x and
  // an Opus 5.5 user's 2x. With one priced model its rate and multiplier are
  // reported; a mixed window reports them per model in `models`.
  const single = pricedModels.length === 1 ? pricedModels[0] : null;
  const inputRate = single ? single.rates.input : null;
  const cacheReadMultiplier = single ? single.rates.cache_read_multiplier : null;

  const used = usedIds instanceof Set ? usedIds : new Set(usedIds);
  const scored = items.map(it => {
    if (it.type === 'rule') {
      return {
        id: it.id, type: it.type, name: it.name, source: it.source,
        tokens: it.tokens, chars: it.chars,
        used: null,
        verdict: 'ALWAYS-LOADED',
        why: NOT_JUDGED_WHY,
      };
    }
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

  const instructions = scored.filter(s => s.used === null);
  const judged = scored.filter(s => s.used !== null);
  const dead = judged.filter(s => !s.used);
  const deadTokens = dead.reduce((a, s) => a + (s.tokens || 0), 0);

  const models = pricedModels.map(m => {
    const perTurn = deadTokens / 1_000_000 * m.rates.input * m.rates.cache_read_multiplier;
    return {
      model_id: m.id, model: m.rates.key, turns: m.turns,
      input_rate: m.rates.input, cache_read_multiplier: m.rates.cache_read_multiplier,
      per_turn_usd: round(perTurn), window_usd: round(perTurn * m.turns),
    };
  });
  const pricedTurns = pricedModels.reduce((a, m) => a + m.turns, 0);

  // With nothing to re-read (no dead tokens, or no turns) the figure is $0 on
  // any rate, so it is safe to state even when the rate is withheld.
  const nothingToPrice = deadTokens === 0 || !turns;
  let perTurnUsd = null, windowUsd = null, monthlyUsd = null;
  if (priced) {
    windowUsd = pricedModels.reduce((a, m) => a + deadTokens / 1_000_000 * m.rates.input * m.rates.cache_read_multiplier * m.turns, 0);
    // One model: its per-turn cost. A mix: the average over the priced turns.
    perTurnUsd = single
      ? deadTokens / 1_000_000 * single.rates.input * single.rates.cache_read_multiplier
      : (pricedTurns > 0 ? windowUsd / pricedTurns : 0);
    monthlyUsd = covered > 0 ? windowUsd * (30 / covered) : windowUsd;
  } else if (nothingToPrice) {
    perTurnUsd = 0; windowUsd = 0; monthlyUsd = 0;
  }
  const usdLabel = perTurnUsd === null ? 'withheld' : 'estimate';
  // A mixed window has no single rate (both fields are null): 'per-model' points
  // at `models`, rather than labelling a null 'billing-grade'.
  const rateLabel = !priced ? 'unavailable' : (single ? 'billing-grade' : 'per-model');

  // Never name the fallback's guess as the model (2026-09-27): on a family
  // fallback `rates.key` is the nearest Opus, not what the user ran.
  let modelKey = null;
  if (single) modelKey = single.rates.key;
  else if (!priced && top) modelKey = top.rates ? (top.rates.fallback ? null : top.rates.key) : top.id;

  return {
    days, covered_days: covered, turns,
    loaded_count: items.length,
    judged_count: judged.length,
    used_count: judged.length - dead.length,
    dead_count: dead.length,
    dead_tokens: deadTokens,
    instructions,
    instruction_tokens: instructions.reduce((a, s) => a + (s.tokens || 0), 0),
    input_rate: inputRate,
    cache_read_multiplier: cacheReadMultiplier,
    model: modelKey,
    model_id: top ? top.id : (model || null),
    priced,
    unpriced_reason: unpricedReason,
    models,
    priced_turns: pricedTurns,
    excluded_turns: excluded.reduce((a, m) => a + m.turns, 0),
    excluded_models: excluded,
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
