// ─────────────────────────────────────────────────────────────────────────────
// Dashboard runtime config — single source of truth for launch gating.
//
// CRITICAL DATA-LAYER RULE (SEC Phase C): the dashboard NEVER reads tables
// directly with a key. Every cloud read goes through an edge function with the
// PUBLISHABLE key only (sb_publishable_…) + an x-anonymous-id header. Until Phase
// C is deployed (migration 002 + the edge functions), the dashboard renders
// against local fixtures so it is fully demoable now and correct the moment
// Peter flips DATA_MODE to 'live'.
//
//   VITE_DATA_MODE = 'mock' (default) → render from src/lib/fixtures.js
//   VITE_DATA_MODE = 'live'           → call the get-* edge functions
// ─────────────────────────────────────────────────────────────────────────────

export const DATA_MODE = (import.meta.env.VITE_DATA_MODE || 'mock').toLowerCase();
export const IS_MOCK = DATA_MODE !== 'live';

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
// Browser-safe publishable key ONLY. A secret/service key must never reach here.
export const SUPABASE_PUBLISHABLE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

// June-15 Agent-SDK / usage-credit dual-pool flip. Credits views sit in a
// "coming soon" state before this date and flip automatically after it.
export const DUAL_POOL_ACTIVATION_DATE = '2026-06-15';

export function dualPoolActive(now = new Date()) {
  return now >= new Date(DUAL_POOL_ACTIVATION_DATE + 'T00:00:00Z');
}

// Display-only currency. Cost is ALWAYS captured/stored in USD (billing-grade);
// conversion is a presentation layer that must never contaminate the source
// number. FX is a bundled, cached snapshot labeled as approximate.
export const DEFAULT_CURRENCY = 'USD';

// Cached FX snapshot (USD base). Display-only, labeled "approx · cached".
// Mirrors the CLI's display-only conversion (ECB/Frankfurter-style, USD source).
export const FX_SNAPSHOT_DATE = '2026-06-06';
export const FX_RATES = {
  USD: { rate: 1, symbol: '$', label: 'US Dollar' },
  EUR: { rate: 0.93, symbol: '€', label: 'Euro' },
  GBP: { rate: 0.79, symbol: '£', label: 'British Pound' },
  CAD: { rate: 1.37, symbol: 'CA$', label: 'Canadian Dollar' },
  AUD: { rate: 1.51, symbol: 'A$', label: 'Australian Dollar' },
  JPY: { rate: 157, symbol: '¥', label: 'Japanese Yen' },
  INR: { rate: 83.4, symbol: '₹', label: 'Indian Rupee' },
  BRL: { rate: 5.42, symbol: 'R$', label: 'Brazilian Real' },
};

// Anonymous-id storage key (set by `wtclaude dashboard` → ?link= → Settings).
export const ANON_ID_KEY = 'wtclaude_anonymous_id';
export const CURRENCY_KEY = 'wtclaude_display_currency';
export const THEME_KEY = 'wtclaude_theme';
