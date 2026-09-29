import { useDashboard } from '../lib/useDashboard';
import { useApp } from '../context/AppContext';
import { formatCost, relativeTime } from '../lib/format';
import { deviceSummary, basisBadgeProps } from '../lib/derive';
import StatCard from '../components/StatCard';
import { ErrorState } from '../components/EmptyState';
import CopyCommand from '../components/CopyCommand';
import DataStatus, { NoDataInWindow } from '../components/DataStatus';
import { LinkPrompt } from './Overview';

export default function Devices() {
  const { data, loading, error, errorInfo, linked, days: windowDays } = useDashboard();
  const { currency } = useApp();

  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!linked) return <LinkPrompt />;
  if (error) return <ErrorState info={errorInfo} fallbackTitle="Couldn't load devices" />;
  return <DevicesView data={data} windowDays={windowDays} currency={currency} />;
}

// The page for a loaded payload (exported so a unit test can render it).
export function DevicesView({ data, windowDays, currency }) {
  const fc = (v) => formatCost(v, currency);

  // QA-0928-123: short labels instead of raw ids; sessions with no device id
  // (they predate device tracking) are listed as unattributed and never count
  // as a second machine. QA-0928-89: the combined badge is derived from the
  // sessions it totals, not a billing-grade literal.
  const { attributed, unattributed, combined, basis } = deviceSummary(data.devices, data.sessions);
  const rows = unattributed ? [...attributed, unattributed] : attributed;
  const multiDevice = attributed.length > 1;

  const header = (
    <div className="space-y-2">
      <h2 className="text-2xl font-bold text-[var(--text-strong)]">Devices</h2>
      <p className="text-[var(--muted)] text-sm">ccusage can't total your machines — your synced devices combine here.</p>
      <DataStatus data={data} />
    </div>
  );

  // Empty window (QA-0928-92): the empty state only, as on Overview — not a
  // "$0.000 billing-grade" total over no data.
  if (!rows.length) {
    return (
      <div className="space-y-6">
        {header}
        <NoDataInWindow data={data} days={data.meta?.days || windowDays} what="device activity" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {/* 2nd-device conversion banner (BUILD-012) */}
      {multiDevice && (
        <div className="bg-[var(--accent-dim)] border border-[var(--accent)]/40 rounded-xl p-4 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[var(--text-strong)] font-medium">{attributed.length} devices detected</p>
            <p className="text-[var(--muted)] text-sm mt-0.5">Sync keeps your combined total accurate across machines. Enable it on every device:</p>
          </div>
          <CopyCommand command="wtclaude sync --enable" label="copy" />
        </div>
      )}

      {/* Combined */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Combined cost" value={fc(combined.cost)} accent="accent" {...basisBadgeProps(basis)} />
        <StatCard label="Devices" value={attributed.length} sub={unattributed ? `+ ${unattributed.session_count} unattributed session${unattributed.session_count === 1 ? '' : 's'}` : undefined} />
        <StatCard label="Sessions" value={combined.sessions} />
        <StatCard label="Turns" value={combined.turns} />
      </div>

      {/* Per-device */}
      <div className="space-y-2">
        {rows.map((d) => {
          const share = combined.cost > 0 ? (d.cost_usd / combined.cost) * 100 : 0;
          return (
            <div key={d.device_id} className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[var(--text-strong)] font-medium truncate" title={d === unattributed ? 'Sessions synced before device tracking — not a separate machine' : undefined}>{d.display}</p>
                  <p className="text-xs text-[var(--faint)] mt-1">
                    {d.session_count} session{d.session_count === 1 ? '' : 's'} · {d.turn_count} turns{d.last_seen ? ` · last seen ${relativeTime(d.last_seen)}` : ''}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-mono font-bold text-[var(--accent)]">{fc(d.cost_usd)}</p>
                  <p className="text-xs text-[var(--faint)]">{share.toFixed(0)}% of total</p>
                </div>
              </div>
              <div className="h-1.5 rounded-full bg-[var(--surface)] mt-3 overflow-hidden">
                <div className="h-full bg-[var(--accent)] rounded-full" style={{ width: `${share}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
