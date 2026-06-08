import { FX_RATES, DEFAULT_CURRENCY } from './config';

// ── Cost ─────────────────────────────────────────────────────────────────────
// USD is the billing-grade source. `formatCost` formats a USD number; pass a
// currency to convert for DISPLAY ONLY (never feed the result back into math).

export function formatCost(usd, currency = DEFAULT_CURRENCY) {
  if (usd == null || isNaN(usd)) return formatCurrency(0, currency);
  return formatCurrency(usd, currency);
}

export function convertUSD(usd, currency = DEFAULT_CURRENCY) {
  const fx = FX_RATES[currency] || FX_RATES.USD;
  return Number(usd || 0) * fx.rate;
}

export function formatCurrency(usd, currency = DEFAULT_CURRENCY) {
  const fx = FX_RATES[currency] || FX_RATES.USD;
  const v = Number(usd || 0) * fx.rate;
  // JPY-style zero-decimal currencies read better without cents.
  const zeroDecimal = currency === 'JPY';
  if (zeroDecimal) return `${fx.symbol}${Math.round(v).toLocaleString()}`;
  if (v !== 0 && Math.abs(v) < 0.01) return `${fx.symbol}${v.toFixed(4)}`;
  if (Math.abs(v) < 1) return `${fx.symbol}${v.toFixed(3)}`;
  return `${fx.symbol}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ── Tokens ─────────────────────────────────────────────────────────────────
export function formatTokens(count) {
  if (count == null) return '0';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return `${count}`;
}

// ── Dates / time ─────────────────────────────────────────────────────────────
export function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDateTime(dateStr) {
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function relativeTime(dateStr) {
  const then = new Date(dateStr).getTime();
  const now = Date.now();
  const sec = Math.round((now - then) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  return formatDate(dateStr);
}

// Duration from milliseconds → compact "1h 02m" / "4m 12s" / "8s".
export function formatDuration(ms) {
  if (ms == null || isNaN(ms) || ms <= 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return rem ? `${m}m ${String(rem).padStart(2, '0')}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return `${h}h ${String(remM).padStart(2, '0')}m`;
}

export function formatPercent(n, digits = 0) {
  if (n == null || isNaN(n)) return '—';
  return `${Number(n).toFixed(digits)}%`;
}

// "resets in 3h 12m" countdown from an ISO timestamp.
export function countdownTo(isoStr) {
  if (!isoStr) return null;
  const target = new Date(isoStr).getTime();
  const ms = target - Date.now();
  if (isNaN(target)) return null;
  if (ms <= 0) return 'resetting…';
  return formatDuration(ms);
}

// Title-case a snake_case label for display (e.g. fast_mode_usage_credits).
export function humanize(key) {
  if (!key) return '';
  return String(key).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
