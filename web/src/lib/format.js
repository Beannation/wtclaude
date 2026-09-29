import { FX_RATES, DEFAULT_CURRENCY } from './config.js';

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

// Converted figures carry '≈' (QA-0928-91): the rates are a fixed display-only
// table, so a EUR or JPY figure is approximate even when the USD source is
// billing-grade. Sign before the symbol, as the CLI does: "-$10.69", "≈ -€9.83".
export function formatCurrency(usd, currency = DEFAULT_CURRENCY) {
  const fx = FX_RATES[currency] || FX_RATES.USD;
  const converted = fx !== FX_RATES.USD;
  const v = Number(usd || 0) * fx.rate;
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  const approx = converted ? '≈ ' : '';
  let body;
  // JPY-style zero-decimal currencies read better without cents.
  if (currency === 'JPY') body = Math.round(abs).toLocaleString('en-US');
  // Nothing spent reads "$0.00", as the CLI's formatCost prints it (QA-0928-164),
  // not "$0.000".
  else if (abs === 0) body = '0.00';
  else if (abs < 0.01) body = abs.toFixed(4);
  else if (abs < 1) body = abs.toFixed(3);
  else body = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${approx}${sign}${fx.symbol}${body}`;
}

// Compact chart-axis tick in the display currency (QA-0928-91). The '≈' lives
// in the chart heading rather than on every tick.
export function formatAxisCost(usd, currency = DEFAULT_CURRENCY) {
  const fx = FX_RATES[currency] || FX_RATES.USD;
  const v = Number(usd || 0) * fx.rate;
  const body = Math.abs(v) >= 10 ? Math.round(v).toLocaleString('en-US') : String(+v.toFixed(2));
  return `${fx.symbol}${body}`;
}

// ── Tokens ─────────────────────────────────────────────────────────────────
export function formatTokens(count) {
  if (count == null) return '0';
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(0)}K`;
  return `${count}`;
}

// ── Dates / time ─────────────────────────────────────────────────────────────
// A bare 'YYYY-MM-DD' is a calendar day, not an instant. new Date('2026-05-25')
// parses it as UTC midnight, which is May 24 anywhere west of UTC — every
// Daily-cost bar was labelled a day early (QA-0928-103). Parse it as local.
export function parseDay(dateStr) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return new Date(dateStr);
}

// 'Jul 7', or 'Jul 7, 2026' with { year: true } (an axis that crosses a year
// boundary needs it, RC 0.3.2).
export function formatDate(dateStr, { year = false } = {}) {
  return parseDay(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(year ? { year: 'numeric' } : {}) });
}

// Newer ICU puts a narrow no-break space before AM/PM; keep a plain space so
// the text reads (and tests) the same everywhere.
const nbsp = (s) => s.replace(/\u202f/g, ' ');

export function formatDateTime(dateStr) {
  return nbsp(new Date(dateStr).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }));
}

export function formatClock(dateStr) {
  return nbsp(new Date(dateStr).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }));
}

export function relativeTime(dateStr, now = Date.now()) {
  const then = new Date(dateStr).getTime();
  const sec = Math.round((now - then) / 1000);
  // A future time is never "just now" (QA-0928-177): show it as a date instead.
  if (sec < -60) return formatDateTime(dateStr);
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

// "resets in 3h 12m" countdown from an ISO timestamp; days past 24 hours
// ("6d 3h", QA-0928-90). A time already past is not a countdown: null.
export function countdownTo(isoStr, now = Date.now()) {
  if (!isoStr) return null;
  const target = new Date(isoStr).getTime();
  if (isNaN(target)) return null;
  const ms = target - now;
  if (ms <= 0) return null;
  if (ms >= 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    return `${Math.floor(h / 24)}d ${h % 24}h`;
  }
  return formatDuration(ms);
}

// Limit-gauge reset line (QA-0928-90): a future reset counts down; a past one
// says when the window reset, in local time, because the reading no longer
// describes the current window.
export function resetInfo(isoStr, now = Date.now()) {
  if (!isoStr) return null;
  const target = new Date(isoStr);
  if (isNaN(target.getTime())) return null;
  const left = countdownTo(isoStr, now);
  if (left) return { past: false, text: `resets in ${left}` };
  const sameDay = target.toDateString() === new Date(now).toDateString();
  return {
    past: true,
    text: sameDay ? `window reset at ${formatClock(isoStr)}` : `window reset ${formatDateTime(isoStr)}`,
  };
}

// A model id for a legend or list row: the 'claude-' every id shares is
// dropped so rows can be told apart on a phone ('opus-4-8[1m]' vs 'opus-4-8',
// RC 0.3.2). Show the full id as the row's title.
export function modelLabel(id) {
  const s = String(id ?? '');
  return /^claude-./.test(s) ? s.slice('claude-'.length) : s;
}

// Title-case a snake_case label for display (e.g. fast_mode_usage_credits).
export function humanize(key) {
  if (!key) return '';
  return String(key).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
