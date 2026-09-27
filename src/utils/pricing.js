import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = join(__dirname, '..', 'config');

let _cached = null;

// Load the newest versioned pricing config. Adding a new rate sheet is just
// dropping a `pricing-YYYY-MM-DD.json` file — newest filename wins.
export function getLatestPricing() {
  if (_cached) return _cached;

  const files = readdirSync(CONFIG_DIR)
    .filter(f => f.startsWith('pricing-') && f.endsWith('.json'))
    .sort();

  const latest = files[files.length - 1];
  _cached = JSON.parse(readFileSync(join(CONFIG_DIR, latest), 'utf8'));
  return _cached;
}

// Split a raw payload model id into { provider, key }.
//
// `provider` is non-null only for the provider-prefixed shapes Claude Code
// started emitting in v2.1.223 (`vertex_ai/claude-sonnet-5`,
// `bedrock/anthropic.claude-opus-5-20260724`). Those name a real Anthropic
// model, so we can still recover the right rate sheet entry — but the model is
// being served by a partner-operated platform that publishes its own pricing
// (Bedrock and Google Cloud regional endpoints carry a 10% premium over global,
// for one), so first-party rates are NOT authoritative for it. Callers get the
// provider back so they can flag the turn instead of quietly implying our rate
// applies.
//
// `key` drops the `claude-` prefix, any `[…]` context-window suffix (e.g.
// `[1m]`), and any `-YYYYMMDD` date suffix.
//
// The `[1m]` long-context alias (live payload: `claude-opus-5[1m]`) carries NO
// long-context premium — Claude 4.6 and later include the full 1M window at
// standard rates — so we strip the suffix and resolve to the same entry.
export function parseModelId(id) {
  if (!id) return { provider: null, key: null };
  let s = String(id).toLowerCase().trim();

  let provider = null;
  const slash = s.indexOf('/');
  if (slash > 0) {
    provider = s.slice(0, slash);
    s = s.slice(slash + 1);
  }
  // Bedrock-style vendor namespace, with or without a provider prefix.
  if (s.startsWith('anthropic.')) {
    provider = provider || 'bedrock';
    s = s.slice('anthropic.'.length);
  }

  const key = s
    .replace(/^claude-/, '')
    .replace(/\[[^\]]*\]$/, '')   // drop context-window suffix, e.g. [1m]
    .replace(/-\d{8}$/, '');

  return { provider, key: key || null };
}

// Normalize a raw payload model id to a pricing key. Back-compat surface:
// callers that only want the key (fablepool's isFableTurn, the collector's
// Fable check) keep using this. Matches verification/verify-cost-anchor.js.
export function normalizeModel(id) {
  return parseModelId(id).key;
}

// Resolve a raw model id to a pricing entry.
//
// Returns { key, entry, fallback, provider, priceable } or null.
//   • fallback: true  — matched by the opus-* family rather than an exact key,
//                       so the rate is a near-miss guess. Caller should log.
//   • provider: non-null — served by a partner-operated platform; the entry's
//                       first-party rates are indicative only.
//   • priceable: false — do NOT use this rate in a counterfactual (whatif).
//                       The turn's real cost still comes from the payload anchor.
//
// We NEVER silently return an arbitrary model (the old sonnet default was a bug:
// it would mis-cost an unknown model). Cost itself is anchored on the payload's
// cost.total_cost_usd regardless, so an unknown id still costs correctly — only
// the label and the whatif counterfactual depend on this map.
export function getModelEntry(modelId) {
  const pricing = getLatestPricing();
  const { provider, key } = parseModelId(modelId);
  if (!key) return null;

  const wrap = (k, entry, fallback) => ({
    key: k,
    entry,
    fallback,
    provider: provider || null,
    // A partner-served or family-guessed rate is not something we should hand to
    // a counterfactual and present as our number.
    priceable: !provider && !fallback,
  });

  if (pricing.models[key]) return wrap(key, pricing.models[key], false);

  for (const [k, entry] of Object.entries(pricing.models)) {
    if (Array.isArray(entry.aliases) && entry.aliases.includes(key)) {
      return wrap(k, entry, false);
    }
  }

  // Family fallback, last resort. If Anthropic ships an opus we haven't added
  // yet, resolve to the NEWEST opus key (sort order), never to whichever key
  // happens to be first in the object — with retired entries in the sheet,
  // "first" would have meant pricing a brand-new Opus at Opus 4's $15/$75.
  //
  // It is a GUESS, and it is flagged as one (fallback: true, priceable: false).
  // It fired for real on 2026-09-22: Opus 5.5 shipped as Claude Code's default
  // model and `claude-opus-5-5` resolved here to Opus 5's rates — cache reads at
  // $0.50 against a true $0.20, because the two Opus rows no longer share a
  // cache-read multiplier. So no consumer may present a fallback rate as our
  // number: compare-models and whatif exclude the turn and say so, and waste
  // withholds its dollar figure. The next Opus will land on this path on day one.
  if (key.startsWith('opus')) {
    const newest = Object.keys(pricing.models).filter(k => k.startsWith('opus')).sort().pop();
    if (newest) return wrap(newest, pricing.models[newest], true);
  }

  return null;
}

// Resolve the effective base {input, output} for an entry at a given date,
// honoring an optional `scheduled` rate array (a future-dated rate change). The
// newest scheduled entry whose `effective_date` <= today wins; before any
// scheduled date the base rate holds.
//
// No model uses `scheduled` as of the 2026-09-07 sheet — Sonnet 5's step-up was
// cancelled by Anthropic on 2026-08-10 and removed here. The mechanism is kept
// because it is the only correct way to encode a genuinely announced future
// rate change (the loader sorts by FILENAME, so a future-dated file would
// activate the moment it landed). If you ever add one back, add a test that
// pins both sides of the date.
export function effectiveRates(entry, today = new Date().toISOString().slice(0, 10)) {
  let input = entry.input, output = entry.output;
  if (Array.isArray(entry.scheduled)) {
    const due = entry.scheduled
      .filter(s => s && typeof s.effective_date === 'string' && s.effective_date <= today)
      .sort((a, b) => a.effective_date.localeCompare(b.effective_date));
    const active = due[due.length - 1];
    if (active) {
      if (typeof active.input === 'number') input = active.input;
      if (typeof active.output === 'number') output = active.output;
    }
  }
  return { input, output };
}

// Per-MTok rates for a model id at a given speed tier ('standard' | 'fast').
// Fast mode exists only on Opus 5.5 ($8/$40), Opus 5 and Opus 4.8 ($10/$50); a
// model without a fast_mode block is billed at standard rates even if the turn
// is stamped 'fast'. On a fast turn `input` is the FAST input rate, and the
// pricing page states "Prompt caching multipliers apply on top of fast mode
// pricing" — so cost.js multiplies that fast input by the model's own
// cache-read multiplier (a fast Opus 5.5 cache read: 0.05 x $8 = $0.40/MTok,
// derived by that rule; the page does not print the figure).
// `today` (YYYY-MM-DD) is injectable for testing dated step-ups; defaults to now.
export function getRates(modelId, speedTier = 'standard', today = new Date().toISOString().slice(0, 10)) {
  const resolved = getModelEntry(modelId);
  if (!resolved) return null;
  const { entry } = resolved;
  const meta = {
    key: resolved.key,
    fallback: resolved.fallback,
    provider: resolved.provider,
    priceable: resolved.priceable,
    // Carried on the rates so a caller that has already resolved the model does
    // not resolve it a second time — and, more importantly, so no caller can
    // reach for the global multiplier by habit and silently mis-price a cache
    // read (4x on Fable 5.1, 2x on Opus 5.5). Per-model override first, sheet
    // default second.
    cache_read_multiplier:
      entry.cache?.read_multiplier ?? (getLatestPricing().cache?.read_multiplier ?? 0.10),
  };
  if (speedTier === 'fast' && entry.fast_mode) {
    const fast = effectiveRates(entry.fast_mode, today);
    return { input: fast.input, output: fast.output, ...meta };
  }
  const base = effectiveRates(entry, today);
  return { input: base.input, output: base.output, ...meta };
}

// The cache-write multiplier for a TTL. Anthropic prices cache writes relative
// to base input: 1.25x for the 5-minute cache, 2x for the 1-hour cache. When the
// payload cannot tell us which TTL was in play we use the sheet's default, which
// is the 1-hour rate — that is what Claude Code subscription sessions bill.
//
// Cache WRITES have no per-model override: the live table shows 1.25x / 2x of
// base input for every row, including the 5.1s. Cache READS do — see below.
export function cacheWriteMultiplier(ttl) {
  const cache = getLatestPricing().cache || {};
  if (ttl === '5m') return cache.write_multiplier_5m ?? cache.write_multiplier ?? 1.25;
  if (ttl === '1h') return cache.write_multiplier_1h ?? cache.write_multiplier ?? 2.00;
  return cache.write_multiplier ?? cache.write_multiplier_1h ?? 2.00;
}

// The cache-READ multiplier for a model. PER-MODEL since the 2026-09-07 sheet,
// and THREE-valued since 2026-09-27.
//
// Resolution order: the model entry's own `cache.read_multiplier`, then the
// sheet's global `cache.read_multiplier` as the default.
//
// Anthropic's pricing page, §Prompt caching: "Cache read (hit): 0.1x base input
// price (0.025x on Claude Fable 5.1 and Claude Mythos 5.1; 0.05x on Claude Opus
// 5.5)". Fable 5 and Fable 5.1 share a $10 base input and differ ONLY here — $1
// vs $0.25 per MTok — and Opus 5.5's $0.20 cache read is 0.05x of $4, not 0.1x.
// A model missing its override over-prices every one of its cache reads (4x on
// Fable 5.1, 2x on Opus 5.5), and cache reads dominate agentic sessions. It
// fails silently: nothing throws, the number is just wrong.
//
// An unresolvable model falls back to the global default. That is deliberate and
// safe: a turn we cannot resolve is already flagged unpriceable by priceTurn(),
// so this value never reaches a presented figure on its own.
export function cacheReadMultiplier(modelId) {
  const pricing = getLatestPricing();
  const globalMult = pricing.cache?.read_multiplier ?? 0.10;
  const resolved = getModelEntry(modelId);
  return resolved?.entry?.cache?.read_multiplier ?? globalMult;
}

// Back-compat shim for existing CLI code. Robust: resolves via alias/family,
// returns null instead of silently mis-costing an unknown model.
export function getModelPricing(modelName) {
  const resolved = getModelEntry(modelName);
  return resolved ? resolved.entry : null;
}
