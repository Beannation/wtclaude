import { useDashboard } from '../lib/useDashboard';
import { useApp } from '../context/AppContext';
import { formatCost, relativeTime } from '../lib/format';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import CopyCommand from '../components/CopyCommand';
import { LinkPrompt } from './Overview';

export default function Devices() {
  const { data, loading, error, linked } = useDashboard();
  const { currency } = useApp();
  const fc = (v) => formatCost(v, currency);

  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!linked) return <LinkPrompt />;
  if (error) return <EmptyState title="Couldn't load devices" body={error} />;

  const devices = [...(data.devices || [])].sort((a, b) => b.cost_usd - a.cost_usd);
  const combined = devices.reduce((acc, d) => {
    acc.cost += d.cost_usd; acc.sessions += d.session_count; acc.turns += d.turn_count; return acc;
  }, { cost: 0, sessions: 0, turns: 0 });

  const multiDevice = devices.length > 1;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-[var(--text-strong)]">Devices</h2>
        <p className="text-[var(--muted)] text-sm mt-1">ccusage can't total your machines — your synced devices combine here.</p>
      </div>

      {/* 2nd-device conversion banner (BUILD-012) */}
      {multiDevice && (
        <div className="bg-[var(--accent-dim)] border border-[var(--accent)]/40 rounded-xl p-4 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-[var(--text-strong)] font-medium">{devices.length} devices detected</p>
            <p className="text-[var(--muted)] text-sm mt-0.5">Sync keeps your combined total accurate across machines. Enable it on every device:</p>
          </div>
          <CopyCommand command="wtclaude sync --enable" label="copy" />
        </div>
      )}

      {/* Combined */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Combined cost" value={fc(combined.cost)} accent="accent" badge="billing-grade" />
        <StatCard label="Devices" value={devices.length} />
        <StatCard label="Sessions" value={combined.sessions} />
        <StatCard label="Turns" value={combined.turns} />
      </div>

      {/* Per-device */}
      <div className="space-y-2">
        {devices.map((d) => {
          const share = combined.cost > 0 ? (d.cost_usd / combined.cost) * 100 : 0;
          return (
            <div key={d.device_id} className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[var(--text-strong)] font-medium">{d.label || d.device_id}</p>
                  <p className="text-xs text-[var(--faint)] mt-1">
                    {d.session_count} sessions · {d.turn_count} turns · last seen {relativeTime(d.last_seen)}
                  </p>
                </div>
                <div className="text-right">
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
