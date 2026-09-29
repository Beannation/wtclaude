import { getLatestRateLimitTurn } from '../utils/sessions.js';
import { normalizeResetsAt, formatDuration, localDateTime } from '../utils/time.js';

// `wtclaude limit` — the CLI limit gauge / burn-countdown.
//
// Billing-grade and payload-sourced: reads the `rate_limits` snapshot the
// statusline payload carries (captured per turn by the collector, BUILD-023),
// so CLI users get their limit % + reset countdown with NO OAuth /usage call.
//
// Honesty / framing (per GTM-005): this is the user's SINGLE shared subscription
// usage limit — the one bucket Claude meters. We do NOT claim a "unified
// cross-surface view" (any OAuth-reading tool can read the same shared bucket).
// The OAuth path stays the documented fallback for surfaces the statusline
// can't reach (desktop/Cowork — see R-12); it is not replaced here, only
// preferred for CLI users where the payload already carries the data.
//
// QA-0928-61: the reading is only as fresh as the last snapshot. A window whose
// resets_at has passed has reset since then, so its old percentage no longer
// applies and is not shown; the "as of" time is local, with its age.

export function bar(pct, width = 20) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round((p / 100) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

export function pctStr(pct) {
  if (pct == null || !Number.isFinite(Number(pct))) return '  —';
  return `${Math.round(Number(pct))}%`.padStart(4);
}

// Countdown and staleness kept apart (QA-0928-61), in one format shared with
// `watch` (QA-0928-156). resets_at may be epoch seconds, milliseconds or an ISO
// string (QA-0928-155). Returns { text, stale }.
export function resetPhrase(resetsAtRaw, snapshotTs, now = Date.now()) {
  const reset = normalizeResetsAt(resetsAtRaw);
  if (reset == null) return { text: 'reset time unknown', stale: false };
  if (reset <= now) {
    const taken = Date.parse(snapshotTs);
    const age = Number.isFinite(taken) ? ` (${formatDuration(now - taken)} ago)` : '';
    return { text: `window has reset since your last snapshot${age}`, stale: true };
  }
  return { text: `resets in ${formatDuration(reset - now)}`, stale: false };
}

// One gauge row. `label` arrives padded by the caller.
export function gauge(label, pct, resetsAtRaw, snapshotTs, now = Date.now()) {
  const r = resetPhrase(resetsAtRaw, snapshotTs, now);
  const shown = r.stale ? null : pct; // a reset window's old % no longer applies
  return `  ${label} ${bar(shown)} ${pctStr(shown)}   ${r.text}`;
}

// "as of your last turn (2026-09-28 09:42 local, 2h 18m ago)".
export function asOf(ts, now = Date.now()) {
  const taken = Date.parse(ts);
  if (!Number.isFinite(taken)) return '';
  return `as of your last turn (${localDateTime(ts)} local, ${formatDuration(now - taken)} ago)`;
}

// The gauge block for a reading (null → the no-data guidance). `now` injectable.
export function limitLines(turn, now = Date.now()) {
  if (!turn) {
    return [
      '\n  No limit data captured yet.',
      '  The limit gauge reads the `rate_limits` snapshot from the statusline',
      '  payload — run a Claude Code session with wtclaude-collector configured.',
      '  (Older Claude Code versions predate this field; the OAuth /usage view is',
      '  the fallback for those and for desktop/Cowork surfaces.)\n',
    ];
  }
  const when = turn.ts ? ` · ${asOf(turn.ts, now)}` : '';
  return [
    '\n  Shared overall plan limit',
    '  =========================',
    `  Billing-grade · read from the statusline payload, no OAuth needed${when}.`,
    '',
    gauge('5-hour window'.padEnd(16), turn.rate_limit_5h_pct, turn.rate_limit_5h_resets_at, turn.ts, now),
    gauge('7-day window'.padEnd(16), turn.rate_limit_7d_pct, turn.rate_limit_7d_resets_at, turn.ts, now),
    '',
    '  This is your shared overall plan limit — the single subscription bucket',
    '  Claude meters. (Not a cross-surface view.)',
    '',
  ];
}

export function registerLimit(program) {
  program
    .command('limit')
    .description('Show your shared plan usage limit + reset countdown (billing-grade, from the statusline payload)')
    .action(() => {
      console.log(limitLines(getLatestRateLimitTurn()).join('\n'));
    });
}
