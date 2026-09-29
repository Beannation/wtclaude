import HonestyBadge from './HonestyBadge';

export default function StatCard({ label, value, sub, accent, badge, badgeLabel, badgeTitle, children }) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 min-w-0">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <p className="text-xs text-[var(--muted)] uppercase tracking-wide">{label}</p>
        {badge && <HonestyBadge tier={badge} label={badgeLabel} title={badgeTitle} />}
      </div>
      <p
        className="text-xl sm:text-2xl font-bold font-mono break-words"
        style={{ color: accent ? `var(--${accent})` : 'var(--text-strong)' }}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-[var(--muted)] mt-1">{sub}</p>}
      {children}
    </div>
  );
}
