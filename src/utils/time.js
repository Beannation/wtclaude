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
// (The `blocks` view stays on fixed UTC 5-hour windows by design — they model
// the subscription reset clock and are explicitly labeled "UTC", so they do not
// contradict the local day.)

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
