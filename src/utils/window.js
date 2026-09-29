// Look-back windows for the analysis commands (BUILD-018, QA-0928-22/73/74).
//
// Two rules every "/month" projection shares, kept in one place so the commands
// cannot drift apart again:
//  • `--days` is validated once, here. A non-numeric, zero or negative value is a
//    usage error — never a "NaN-NaN-NaN" date, an inverted range, or a silent
//    clamp to some other number.
//  • A projection scales by the days the data actually COVERS: the requested
//    window when tracking began on or before its first day, otherwise the days
//    since the first tracked turn. Never the window alone (one day of data in a
//    30-day window understated a first-day user 30x) and never the days that
//    happen to have usage (30 ÷ active days overstated a part-time user 3.5x).

import { InvalidArgumentError } from 'commander';
import { localDate, localDateOf } from './time.js';

// The longest `--days` window any command accepts.
export const MAX_DAYS = 365;

// commander argParser for `--days <n>`: a whole number of days from 1 to
// MAX_DAYS. The one validator for every `--days` (compare, waste, whatif,
// forecast, compare-models, fable): one maximum, one message.
export function parseDaysOption(value) {
  const s = String(value ?? '').trim();
  if (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > MAX_DAYS) {
    throw new InvalidArgumentError(`--days must be a whole number of days, 1 or more, up to ${MAX_DAYS} (got "${value}").`);
  }
  return Number(s);
}

// First local day of an N-day window ending today (N = 1 is today alone).
export function windowStart(days, now = new Date()) {
  return localDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)));
}

// Whole calendar days from `from` to `to`, inclusive (both local YYYY-MM-DD).
// Computed on the Y-M-D itself, so a DST day still counts as one day.
function daysInclusive(from, to) {
  const utc = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(to) - utc(from)) / 86_400_000) + 1;
}

// The days a window's data covers — see the header. null when nothing has been
// tracked at all (there is no basis for a projection).
export function coveredDays(windowDays, firstTrackedDate, today) {
  if (!firstTrackedDate) return null;
  return Math.max(1, Math.min(windowDays, daysInclusive(firstTrackedDate, today)));
}

// Split a full-history session list into the window [start, end] (local days)
// and the first tracked local day, in one pass over the turns.
export function splitHistory(allSessions, start, end) {
  let firstDate = null;
  const sessions = [];
  for (const s of allSessions || []) {
    const turns = [];
    for (const t of s.turns) {
      const d = localDateOf(t.ts);
      if (d > end) continue;
      if (!firstDate || d < firstDate) firstDate = d;
      if (d >= start) turns.push(t);
    }
    if (turns.length > 0) sessions.push({ session_id: s.session_id, turns });
  }
  return { sessions, firstDate };
}

// "last 1 day" / "last 7 days" — one wording for every look-back label
// (RC 2026-09-28: fable, forecast and waste printed "last 1 days").
export function windowLabel(days) {
  return `last ${days} day${days === 1 ? '' : 's'}`;
}

// Which basis a projection used, in words (every projection says so).
export function projectionNote(covered, windowDays) {
  if (covered >= windowDays) return `projected from the full ${windowDays}-day window`;
  return `projected from ${covered} day${covered === 1 ? '' : 's'} of data — tracking began inside the ${windowDays}-day window`;
}
