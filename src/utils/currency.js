// Display-only multi-currency (BUILD-015 / v1.9). USD is the billing-grade
// source of truth — these rates are approximate and exist purely so a non-US
// user can eyeball a familiar number. They are NEVER used to recompute or store
// a billing-grade cost. Users can override/extend rates via config.fx_rates.

import { loadConfig, getDisplayCurrency } from './config.js';

// Approximate static rates (USD -> X). Display only; refresh-by-config only.
const DEFAULT_FX = {
  USD: 1, EUR: 0.92, GBP: 0.79, CAD: 1.37, AUD: 1.52,
  JPY: 157, INR: 83, BRL: 5.0, CHF: 0.88, CNY: 7.2,
  MXN: 17.0, SGD: 1.34, SEK: 10.6, NOK: 10.7, ZAR: 18.5,
};

const SYMBOLS = {
  USD: '$', EUR: '€', GBP: '£', CAD: 'CA$', AUD: 'A$', JPY: '¥',
  INR: '₹', BRL: 'R$', CHF: 'CHF ', CNY: '¥', MXN: 'MX$',
  SGD: 'S$', SEK: 'kr ', NOK: 'kr ', ZAR: 'R ',
};

// Resolve the active display-currency state once per command invocation.
// Returns { code, rate, symbol, isUsd, supported }. Falls back to USD (with a
// flag) when the requested code has no known rate, so we never crash or silently
// show a wrong number.
export function resolveCurrency(opts = {}) {
  const code = getDisplayCurrency(opts);
  const cfg = loadConfig();
  const rates = { ...DEFAULT_FX, ...(cfg.fx_rates || {}) };
  if (code === 'USD') return { code: 'USD', rate: 1, symbol: '$', isUsd: true, supported: true };
  const rate = rates[code];
  if (rate == null) {
    return { code: 'USD', rate: 1, symbol: '$', isUsd: true, supported: false, requested: code };
  }
  return { code, rate, symbol: SYMBOLS[code] || `${code} `, isUsd: false, supported: true };
}

// Format a USD amount into the active display currency. USD uses the existing
// billing-grade formatter thresholds; other currencies show a `≈` to make the
// display-only nature obvious.
export function formatMoney(usd, cur) {
  const c = cur || { code: 'USD', rate: 1, symbol: '$', isUsd: true };
  // Sign before the symbol (QA-0610-07): "-$10.69" / "≈ -€9.83", never "$-10.69".
  const sign = usd < 0 ? '-' : '';
  const abs = Math.abs(usd);
  if (c.isUsd) {
    if (abs < 0.01) return `${sign}$${abs.toFixed(4)}`;
    if (abs < 1) return `${sign}$${abs.toFixed(3)}`;
    return `${sign}$${abs.toFixed(2)}`;
  }
  const v = abs * c.rate;
  const digits = v < 1 ? 3 : 2;
  return `≈ ${sign}${c.symbol}${v.toFixed(digits)}`;
}

// A one-line honesty caveat for non-USD output. Empty string for USD.
export function currencyNote(cur) {
  if (!cur || cur.isUsd) {
    if (cur && cur.supported === false) {
      return `  (unknown currency "${cur.requested}" — showing USD; set config.fx_rates to add it)`;
    }
    return '';
  }
  return `  Display currency: ${cur.code} (≈ approximate, display-only — USD is billing-grade).`;
}
