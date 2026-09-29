// Local-calendar date/time helpers (QA-BUG-10).
//
// Stored turn timestamps are UTC ISO strings (the collector writes
// `new Date().toISOString()`), but the user perceives days in their LOCAL zone.
// Before this, "today" and the week/month ranges keyed on the UTC date
// (`toISOString().slice(0,10)`), so e.g. in EDT (UTC-4) anything after 20:00
// local rolled into "tomorrow" and `wtclaude today` silently dropped the
// evening's usage. We now key the usage-day boundary AND the bucketing of each
// turn on the local calendar date, and render per-turn/block clock times in
// local time, so nothing the CLI shows contradicts the local "today".
//
// (The `blocks` view stays on fixed, epoch-aligned UTC 5-hour buckets. They are
// labeled "UTC", so they do not contradict the local day — but they are NOT the
// subscription's 5-hour limit window, which starts with your first message after
// the last one expired and so resets at arbitrary times; QA-0928-62.)

function pad(n) { return String(n).padStart(2, '0'); }

// 'YYYY-MM-DD' for a Date in the host's local zone (not UTC).
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Local calendar date for a stored UTC timestamp string. Safe-fail: never throws
// (a malformed ts falls back to its leading 10 chars, matching the old behavior).
export function localDateOf(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 10);
  return localDate(d);
}

// 'HH:MM' in the host's local zone, for per-turn display so the clock matches
// the local "today" boundary instead of reading as a different (UTC) day.
export function localTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts).slice(11, 16);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Local 'YYYY-MM-DD' N days before today (replaces the UTC-based daysAgo).
export function localDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDate(d);
}

// True only for a real calendar date written YYYY-MM-DD (QA-0928-159): the shape
// alone let "2026-13-45" and "2026-02-31" through as silent string ranges.
export function isRealDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

// Calendar-day arithmetic on a 'YYYY-MM-DD' string (QA-0928-56). Pure date math
// in UTC, so no clock and no DST transition can shift the result.
export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// Local first–last calendar dates of a span, compact (QA-0928-58/160):
// "2026-09-14" (one day), "2026-09-14–15" (same month), "2026-08-31–09-01"
// (same year, or across New Year within a year: "2026-12-31–01-01" — a range
// runs forward, so the end is the next year), else both dates in full.
export function localDateRange(firstTs, lastTs) {
  const a = localDateOf(firstTs), b = localDateOf(lastTs);
  if (a === b) return a;
  if (a.slice(0, 7) === b.slice(0, 7)) return `${a}–${b.slice(8)}`;
  if (a.slice(0, 4) === b.slice(0, 4)) return `${a}–${b.slice(5)}`;
  if (Number(b.slice(0, 4)) === Number(a.slice(0, 4)) + 1 && b.slice(5) < a.slice(5)) return `${a}–${b.slice(5)}`;
  return `${a}–${b}`;
}

// 'YYYY-MM-DD HH:MM' in the host's local zone (QA-0928-61: "as of" times were
// the raw UTC slice, unlabelled, so they read hours in the future).
export function localDateTime(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 16).replace('T', ' ');
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// A rate-limit resets_at as epoch MILLISECONDS, or null when unknown
// (QA-0928-155). The payload sends epoch seconds; tolerate milliseconds (numbers
// above 1e12) and ISO strings so a format change never renders "NaNm" or a
// 20-million-day countdown.
export function normalizeResetsAt(v) {
  if (v == null || v === '') return null;
  let ms;
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()))) {
    const n = Number(v);
    ms = n > 1e12 ? n : n * 1000;
  } else if (typeof v === 'string') {
    ms = Date.parse(v);
  } else {
    return null;
  }
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

// One countdown/age format for `limit` and `watch` (QA-0928-156): "6d 9h",
// "1h 9m", "9m", "<1m". Whole minutes, floored, so it never prints "60m".
export function formatDuration(ms) {
  const totalMin = Math.floor(Math.max(0, ms) / 60000);
  if (totalMin < 1) return '<1m';
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
