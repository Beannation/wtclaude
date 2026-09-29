import { dataFreshness } from '../lib/derive';
import { formatDateTime, relativeTime } from '../lib/format';

// Freshness + window line for the data pages (QA-0928-92 / 127 / 32). Stale
// cloud data used to look exactly like "no usage": nothing said when the cloud
// copy was last updated or that the days were UTC. meta.last_activity_at is the
// newest synced turn (any window); when the server does not send it the line
// says nothing it cannot back.
export default function DataStatus({ data, view, now = new Date() }) {
  const f = dataFreshness(data?.meta, now);
  const days = view?.days || data?.meta?.days;
  // Older get-dashboard: no last_activity_at. Say only what the payload backs —
  // the newest session activity inside this window.
  const newestInWindow = !f.known
    ? (data?.sessions || []).reduce((a, s) => (s.ended_at && s.ended_at > a ? s.ended_at : a), '')
    : '';
  const dayBasis = view ? (view.local ? `days in your time zone (${view.tz})` : 'days are UTC') : null;
  return (
    <div className="space-y-2">
      {f.stale && (
        <div role="status" className="border border-[var(--amber)] rounded-lg px-4 py-3 text-sm text-[var(--text)]">
          <span className="text-[var(--amber)] font-medium">Cloud data may be out of date.</span>{' '}
          Your newest synced activity is from {formatDateTime(f.lastActivityAt)} ({relativeTime(f.lastActivityAt, now.getTime())}).
          If you have used Claude Code since, run <code className="text-[var(--accent)]">wtclaude sync --status</code> in your terminal.
        </div>
      )}
      <p className="text-xs text-[var(--faint)]">
        {f.known && <>Last synced activity: {formatDateTime(f.lastActivityAt)} · </>}
        {newestInWindow && <>Newest activity in this window: {formatDateTime(newestInWindow)} · </>}
        {days ? `Last ${days} days` : null}
        {dayBasis && <> · {dayBasis}</>}
      </p>
    </div>
  );
}

// Empty window (QA-0928-92): name the window, point at the sync status, and
// say where the data actually ends when the server tells us.
export function NoDataInWindow({ data, days, what = 'activity', now = new Date() }) {
  const f = dataFreshness(data?.meta, now);
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center">
      <h3 className="text-[var(--text-strong)] font-semibold mb-2">Nothing synced in the last {days} days</h3>
      <p className="text-[var(--muted)] text-sm max-w-md mx-auto mb-3">
        No {what} in this window.
        {f.known ? ` Your newest synced activity is from ${formatDateTime(f.lastActivityAt)} — widen the window at the top of the page, or` : ' Widen the window at the top of the page, or'}
        {' '}check that sync is on and up to date:
      </p>
      <code className="inline-block bg-[var(--bg)] text-[var(--accent)] px-4 py-2 rounded-lg text-sm">wtclaude sync --status</code>
    </div>
  );
}
