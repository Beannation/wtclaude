import HonestyBadge from './HonestyBadge';
import { countdownTo, formatPercent, relativeTime } from '../lib/format';

// The Overview limit gauge. Sourced from the statusline payload's `rate_limits`
// snapshot (billing-grade — the shared 5h/7d bucket), per BUILD-023 / FEAT-029.
//
// COPY GUARDRAIL (GTM-005): this is labeled "your shared overall plan limit".
// It is NOT a "see all your limits / unified cross-surface view" — that framing
// is Wave 2 and must never appear here.

function Bar({ label, pct, resetsAt }) {
  const p = Math.max(0, Math.min(100, Number(pct || 0)));
  const color = p >= 85 ? 'var(--rose)' : p >= 60 ? 'var(--amber)' : 'var(--accent)';
  const countdown = countdownTo(resetsAt);
  return (
    <div>
      <div className="flex items-center justify-between text-sm mb-1">
        <span className="text-[var(--text)]">{label}</span>
        <span className="font-mono text-[var(--muted)]">{formatPercent(p)} used</span>
      </div>
      <div
        className="h-2.5 rounded-full bg-[var(--surface)] overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(p)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label}: ${Math.round(p)} percent used`}
      >
        <div className="h-full rounded-full transition-all" style={{ width: `${p}%`, background: color }} />
      </div>
      {countdown && (
        <p className="text-xs text-[var(--faint)] mt-1">resets in {countdown}</p>
      )}
    </div>
  );
}

export default function LimitGauge({ rateLimits }) {
  if (!rateLimits) return null;
  const billingGrade = rateLimits.source === 'payload';
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide">Your shared overall plan limit</h3>
        <HonestyBadge tier={billingGrade ? 'billing-grade' : 'estimate'} />
      </div>
      <p className="text-xs text-[var(--faint)] mb-4">
        The shared 5-hour & weekly bucket across Claude Code, Cowork, and Chat — your overall plan limit, not a Code-only number.
      </p>
      <div className="space-y-4">
        <Bar label="5-hour window" pct={rateLimits.five_hour?.used_percentage} resetsAt={rateLimits.five_hour?.resets_at} />
        <Bar label="7-day window" pct={rateLimits.seven_day?.used_percentage} resetsAt={rateLimits.seven_day?.resets_at} />
      </div>
      {rateLimits.captured_at && (
        <p className="text-xs text-[var(--faint)] mt-4">Last reading {relativeTime(rateLimits.captured_at)}</p>
      )}
    </div>
  );
}
