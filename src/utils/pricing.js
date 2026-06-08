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

// Normalize a raw payload model id to a pricing key: drop the `claude-` prefix,
// any `[…]` context-window suffix (e.g. `[1m]`), and any `-YYYYMMDD` date suffix.
// Matches verification/verify-cost-anchor.js.
//
// The `[1m]` long-context alias (live payload: `claude-opus-4-7[1m]`,
// `claude-opus-4-8[1m]`) carries NO long-context premium — it bills at the
// standard $5/$25 Opus rates — so we strip the suffix and resolve to the same
// pricing entry. Without this, `opus-4-7[1m]` misses the alias list and only
// matches via the opus-* family fallback (correct cost, but noisy breadcrumb).
export function normalizeModel(id) {
  if (!id) return null;
  return String(id)
    .toLowerCase()
    .replace(/^claude-/, '')
    .replace(/\[[^\]]*\]$/, '')   // drop context-window suffix, e.g. [1m]
    .replace(/-\d{8}$/, '');
}

// Resolve a raw model id to a pricing entry.
// Returns { key, entry, fallback } or null. `fallback: true` means we matched
// by the opus-* family rather than an exact key/alias — caller should log.
// We NEVER silently return an arbitrary model (the old sonnet default was a bug:
// it would mis-cost an unknown model). Cost itself is anchored on the payload's
// cost.total_cost_usd regardless, so an unknown id still costs correctly — only
// the label and whatif counterfactual depend on this map.
export function getModelEntry(modelId) {
  const pricing = getLatestPricing();
  const key = normalizeModel(modelId);
  if (!key) return null;

  if (pricing.models[key]) return { key, entry: pricing.models[key], fallback: false };

  for (const [k, entry] of Object.entries(pricing.models)) {
    if (Array.isArray(entry.aliases) && entry.aliases.includes(key)) {
      return { key: k, entry, fallback: false };
    }
  }

  // Family fallback: any opus-* -> the configured opus entry.
  if (key.startsWith('opus')) {
    const fam = Object.entries(pricing.models).find(([k]) => k.startsWith('opus'));
    if (fam) return { key: fam[0], entry: fam[1], fallback: true };
  }

  return null;
}

// Per-MTok rates for a model id at a given speed tier ('standard' | 'fast').
// Fast mode is Opus-only; falls back to standard rates if the model has none.
export function getRates(modelId, speedTier = 'standard') {
  const resolved = getModelEntry(modelId);
  if (!resolved) return null;
  const { entry } = resolved;
  if (speedTier === 'fast' && entry.fast_mode) {
    return { input: entry.fast_mode.input, output: entry.fast_mode.output, key: resolved.key, fallback: resolved.fallback };
  }
  return { input: entry.input, output: entry.output, key: resolved.key, fallback: resolved.fallback };
}

// Back-compat shim for existing CLI code. Robust: resolves via alias/family,
// returns null instead of silently mis-costing an unknown model.
export function getModelPricing(modelName) {
  const resolved = getModelEntry(modelName);
  return resolved ? resolved.entry : null;
}
