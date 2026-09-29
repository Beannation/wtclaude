// Calendar-day helpers for the dashboard (QA-0928-88 / 32 / 103). Browser port
// of src/utils/time.js localDate / localDateOf, plus zone-aware variants: a
// dashboard day is either the viewer's local day (when get-dashboard sends
// daily_local in meta.tz) or, on an older payload, a UTC day — never a mix.

function pad(n) { return String(n).padStart(2, '0'); }

// 'YYYY-MM-DD' for a Date in the host's local zone (not UTC).
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Local calendar date for a stored UTC timestamp string. Never throws.
export function localDateOf(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 10);
  return localDate(d);
}

// 'YYYY-MM-DD' for an instant in an IANA zone ('UTC', 'America/New_York').
// Falls back to the local zone if the zone is unknown to this browser.
export function dateInZone(d = new Date(), tz) {
  if (!tz) return localDate(d);
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return localDate(d);
  }
}

// Calendar arithmetic on 'YYYY-MM-DD' strings (zone-free: noon UTC anchor).
export function addDays(ymd, n) {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Inclusive list of dates from `start` to `end`.
export function dateRange(start, end) {
  const out = [];
  for (let d = start; d <= end && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

// The browser's IANA zone, for the get-dashboard `tz` query (contract B).
export function browserTimeZone() {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; }
}
