// Simple cost-weighted heatmap. `cells` = [{ label, value, count? }]. Intensity
// scales the accent color's alpha; the peak cell is outlined so the high point
// reads without relying on color intensity alone (accessibility).
//
// `showValues` (QA-0928-29): when the buckets are only an approximation (each
// session's whole cost at its start hour) the page passes false, and neither
// the tooltips nor the peak line print a $ figure.
export default function Heatmap({ title, subtitle, cells, columns, formatValue = (v) => v, badge, showValues = true, countLabel = 'turns' }) {
  const max = Math.max(...cells.map((c) => c.value), 0);
  const peakIdx = cells.reduce((best, c, i) => (c.value > cells[best].value ? i : best), 0);
  const tip = (c) => (showValues ? `${c.label}: ${formatValue(c.value)}` : `${c.label}: ${c.count ?? 0} ${countLabel}`);
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 min-w-0">
      <div className="flex items-center justify-between mb-3 gap-2">
        <div>
          <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide">{title}</h3>
          {subtitle && <p className="text-xs text-[var(--faint)] mt-0.5">{subtitle}</p>}
        </div>
        {badge}
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {cells.map((c, i) => {
          const intensity = max > 0 ? c.value / max : 0;
          const isPeak = max > 0 && i === peakIdx;
          return (
            <div
              key={c.label + i}
              title={tip(c)}
              className="rounded text-center py-2 px-1 text-[10px] border transition-colors"
              style={{
                background: `color-mix(in srgb, var(--accent) ${Math.round(intensity * 80)}%, var(--surface))`,
                borderColor: isPeak ? 'var(--accent)' : 'transparent',
                color: intensity > 0.5 ? '#0a0a0f' : 'var(--muted)',
              }}
            >
              <div className="font-medium">{c.label}</div>
            </div>
          );
        })}
      </div>
      {max > 0 && (
        <p className="text-xs text-[var(--faint)] mt-2">
          Peak: <span className="text-[var(--text)]">{cells[peakIdx].label}</span>
          {showValues && <> · {formatValue(cells[peakIdx].value)}</>}
        </p>
      )}
    </div>
  );
}
