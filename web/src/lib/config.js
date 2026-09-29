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

// Vite replaces import.meta.env at build time; under `node --test` it is
// undefined, so the lib modules stay importable by the unit tests.
const ENV = import.meta.env || {};

export const DATA_MODE = (ENV.VITE_DATA_MODE || 'mock').toLowerCase();
export const IS_MOCK = DATA_MODE !== 'live';

export const SUPABASE_URL = ENV.VITE_SUPABASE_URL || '';
// Browser-safe publishable key ONLY. A secret/service key must never reach here.
export const SUPABASE_PUBLISHABLE_KEY = ENV.VITE_SUPABASE_PUBLISHABLE_KEY || '';

// The Agent-SDK credit-pool split announced for 2026-06-15 was PAUSED and has
// not taken effect. REPLACED 2026-09-28 (QA-0928-24): this used to be a
// date-based dualPoolActive() that returned true for every day after June 15,
// which is how the Overview tile came to say the split "sharpens this". Mirrors
// the rate sheet's agent_sdk_pool block and the CLI's AGENT_SDK_POOL_PAUSED_NOTE
// (web/src/lib/config.test.js pins both), so it can only flip with the sheet.
export const AGENT_SDK_POOL = { activated: false };
export const AGENT_SDK_POOL_PAUSED_NOTE =
  'The Agent-SDK credit split announced for June 15, 2026 is paused — SDK, `claude -p` '
  + 'and third-party usage still draw your subscription\'s ordinary usage limits, not a '
  + 'separate credit pool.';

// Display-only currency. Cost is ALWAYS captured/stored in USD (billing-grade);
// conversion is a presentation layer that must never contaminate the source
// number. FX is a bundled, fixed table labeled as approximate.
export const DEFAULT_CURRENCY = 'USD';

// Fixed FX table (USD base). Display-only; every converted figure carries '≈'.
// The rates are the CLI's built-in table (src/utils/currency.js DEFAULT_FX, last
// changed 2026-06-10) — web/src/lib/format.test.js fails if they drift apart.
// A CLI config.fx_rates override is local to that machine and is not seen here.
export const FX_SNAPSHOT_DATE = '2026-06-10';
export const FX_RATES = {
  USD: { rate: 1, symbol: '$', label: 'US Dollar' },
  EUR: { rate: 0.92, symbol: '€', label: 'Euro' },
  GBP: { rate: 0.79, symbol: '£', label: 'British Pound' },
  CAD: { rate: 1.37, symbol: 'CA$', label: 'Canadian Dollar' },
  AUD: { rate: 1.52, symbol: 'A$', label: 'Australian Dollar' },
  JPY: { rate: 157, symbol: '¥', label: 'Japanese Yen' },
  INR: { rate: 83, symbol: '₹', label: 'Indian Rupee' },
  BRL: { rate: 5.0, symbol: 'R$', label: 'Brazilian Real' },
};

// Dashboard window (QA-0928-92): the get-dashboard `days` query. The selector
// lives in the header; the choice is remembered per browser.
export const WINDOW_OPTIONS = [7, 30, 90, 365];
export const DEFAULT_WINDOW_DAYS = 30;

// Anonymous-id storage key (set by `wtclaude dashboard` → #link= → Settings).
export const ANON_ID_KEY = 'wtclaude_anonymous_id';
export const CURRENCY_KEY = 'wtclaude_display_currency';
export const THEME_KEY = 'wtclaude_theme';
export const WINDOW_KEY = 'wtclaude_window_days';
