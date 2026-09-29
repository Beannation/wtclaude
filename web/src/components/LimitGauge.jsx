import HonestyBadge from './HonestyBadge';
import { formatPercent, formatDateTime, relativeTime, resetInfo } from '../lib/format';
import { limitReadingIsLatest } from '../lib/derive';

// The Overview limit gauge. Sourced from the statusline payload's `rate_limits`
// snapshot (the shared 5h/7d bucket), per BUILD-023 / FEAT-029.
//
// COPY GUARDRAIL (GTM-005): this is labeled "your shared overall plan limit".
// It is NOT a "see all your limits / unified cross-surface view" — that framing
// is Wave 2 and must never appear here.
//
// FIXED 2026-09-28 (QA-0928-90): a reset that has already happened read
// "resets in resetting…" with the old percentage in full colour, long waits
// read "147h 29m", and the badge said the percentages were anchored on
// cost.total_cost_usd. A past reset now says when the window reset and greys
// the (no longer current) percentage; waits over a day read "6d 3h"; the badge
// says where the numbers come from. It says "latest" only when the payload
// comes from the 0.3.2 get-dashboard, whose reading is the newest synced status
// update by time (QA-0928-31); the older function's may not be the newest.
//
// The newest update is not always `wtclaude limit`'s reading (QA-0928-61): a
// lagging concurrent session's newer row can carry an older, lower percentage.
// The gauge shows the reading get-dashboard sends — one reading, so the page
// can't re-derive it. The CLI rule is ported in lib/rateLimits.js (pinned to
// the CLI) and handed to the server stream for dashboard_rate_limits (RC 0.3.2).

// A limit with no reading (null) is not 0% used: it shows "—", as `wtclaude
// limit` does (QA-0928-61: a null reading stays null, never 0; RC 0.3.2).
function Bar({ label, pct, resetsAt, now }) {
  const known = pct != null && pct !== '' && Number.isFinite(Number(pct));
  const p = known ? Math.max(0, Math.min(100, Number(pct))) : 0;
  const reset = known ? resetInfo(resetsAt, now) : null;
  const stale = reset?.past;
  const color = stale ? 'var(--faint)' : p >= 85 ? 'var(--rose)' : p >= 60 ? 'var(--amber)' : 'var(--accent)';
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-[var(--text)]">{label}</span>
        {known ? (
          <span className={`font-mono ${stale ? 'text-[var(--faint)] line-through' : 'text-[var(--muted)]'}`}>{formatPercent(p)} used</span>
        ) : (
          <span className="text-[var(--faint)]"><span className="font-mono">—</span> no reading</span>
        )}
      </div>
      <div
        className="h-2.5 rounded-full bg-[var(--surface)] overflow-hidden"
        role="progressbar"
        aria-valuenow={known ? Math.round(p) : undefined}
        aria-valuetext={known ? undefined : 'no reading'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={known
          ? `${label}: ${Math.round(p)} percent used${stale ? ' at the last reading, before the window reset' : ''}`
          : `${label}: no reading in your synced status updates`}
      >
        <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, background: color }} />
      </div>
      {reset && <p className="text-xs text-[var(--faint)] mt-1">{reset.text}{stale ? ' — this reading is from before the reset' : ''}</p>}
    </div>
  );
}

export default function LimitGauge({ rateLimits, meta, now }) {
  if (!rateLimits) return null;
  const reported = rateLimits.source === 'payload';
  const latest = limitReadingIsLatest(meta);
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-1">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide">Your shared overall plan limit</h3>
        <HonestyBadge
          tier={reported ? 'reported' : 'estimate'}
          title={reported && latest ? 'From your latest synced Claude Code status update — the percentages Claude Code reports, as of that reading. Not a cost figure.' : undefined}
        />
      </div>
      <p className="text-xs text-[var(--faint)] mb-4">
        The shared 5-hour & weekly bucket across Claude Code, Cowork, and Chat — your overall plan limit, not a Code-only number.
      </p>
      <div className="space-y-4">
        <Bar label="5-hour window" pct={rateLimits.five_hour?.used_percentage} resetsAt={rateLimits.five_hour?.resets_at} now={now} />
        <Bar label="7-day window" pct={rateLimits.seven_day?.used_percentage} resetsAt={rateLimits.seven_day?.resets_at} now={now} />
      </div>
      {rateLimits.captured_at && (
        <p className="text-xs text-[var(--faint)] mt-4">
          As of {formatDateTime(rateLimits.captured_at)} ({relativeTime(rateLimits.captured_at, now)}) — {latest ? 'your latest synced Claude Code status update.' : 'a synced status reading (may not be the newest).'}
        </p>
      )}
    </div>
  );
}
