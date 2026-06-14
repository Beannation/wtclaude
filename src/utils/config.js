// Shared config access for the CLI commands (M4). Thin wrapper over the sync
// config reader that supplies safe Phase-0 defaults so a command never crashes
// just because `setup` hasn't written the v1.9 fields yet (M6 is still partial).
// Read-only: these helpers never write config.

import { getConfig } from '../sync/index.js';
import { getLatestPricing } from './pricing.js';

export function loadConfig() {
  return getConfig() || {};
}

// Display currency: --currency flag > config.display_currency > USD.
// USD always stays the billing-grade source of truth (BUILD-015).
export function getDisplayCurrency(opts = {}) {
  if (opts && opts.currency) return String(opts.currency).toUpperCase();
  const c = loadConfig();
  return (c.display_currency || 'USD').toUpperCase();
}

// The date the dual-pool (Agent-SDK credits) split goes live. Config override
// first, then the active pricing sheet, then the documented launch date.
export function getDualPoolActivationDate() {
  const c = loadConfig();
  if (c.dual_pool_activation_date) return c.dual_pool_activation_date;
  const p = getLatestPricing();
  return p.dual_pool_activation_date || '2026-06-15';
}

// Progressive-disclosure flag (build-spec §8). `dual_pool_override` forces the
// flip early/late for testing or if Anthropic moves the date.
export function isDualPoolActive(todayStr = new Date().toISOString().slice(0, 10)) {
  const c = loadConfig();
  if (typeof c.dual_pool_override === 'boolean') return c.dual_pool_override;
  return todayStr >= getDualPoolActivationDate();
}

// FABLE MASTER GATE (PM, June 14, 2026). Claude Fable 5 (and Mythos 5) was suspended
// worldwide on June 12, 2026 under a US export-control directive. While FABLE_SUSPENDED
// is true, `wtclaude fable` prints a suspension notice instead of a live forecast — the
// command, the fable-5 rate entry, and ALL the forecast logic stay intact; only the
// output is gated. Restore path: flip FABLE_SUSPENDED = false and patch-republish.
export const FABLE_SUSPENDED = true;

// One-line user-facing notice shown while FABLE_SUSPENDED is true. GTM may refine.
export const FABLE_SUSPENDED_NOTICE =
  'Claude Fable 5 is temporarily suspended (US export-control directive, June 12, 2026); the cliff forecast is paused and will resume if Fable returns.';

// The date interactive Fable 5 use starts drawing usage credits (the announced
// June-23 "Fable cliff" — removed from subscription inclusion on June 22 EOD).
// Config override first (Anthropic may extend the window / restore inclusion),
// then the active pricing sheet, then the announced date.
export function getFableCliffDate() {
  const c = loadConfig();
  if (c.fable_cliff_date) return c.fable_cliff_date;
  const p = getLatestPricing();
  return p.fable_cliff_date || '2026-06-23';
}

// Plan key (pro | max_5x | max_20x) if the user set one at setup; else null.
export function getPlanKey() {
  const c = loadConfig();
  const raw = c.plan || c.plan_tier || null;
  if (!raw) return null;
  const norm = String(raw).toLowerCase().replace(/[\s-]/g, '_');
  const map = { pro: 'pro', max5: 'max_5x', max_5x: 'max_5x', max5x: 'max_5x', max20: 'max_20x', max_20x: 'max_20x', max20x: 'max_20x' };
  return map[norm] || raw;
}

// Whole-day countdown to a YYYY-MM-DD target. Negative once past.
export function daysUntil(targetDateStr, fromStr = new Date().toISOString().slice(0, 10)) {
  const a = Date.parse(fromStr + 'T00:00:00Z');
  const b = Date.parse(targetDateStr + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}
