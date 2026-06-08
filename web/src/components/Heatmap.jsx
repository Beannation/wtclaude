// Simple cost-weighted heatmap. `cells` = [{ label, value, sub? }]. Intensity
// scales the accent color's alpha; the peak cell is outlined so the high point
// reads without relying on color intensity alone (accessibility).
export default function Heatmap({ title, cells, columns, formatValue = (v) => v, badge }) {
  const max = Math.max(...cells.map((c) => c.value), 0);
  const peakIdx = cells.reduce((best, c, i) => (c.value > cells[best].value ? i : best), 0);
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide">{title}</h3>
        {badge}
      </div>
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {cells.map((c, i) => {
          const intensity = max > 0 ? c.value / max : 0;
          const isPeak = max > 0 && i === peakIdx;
          return (
            <div
              key={c.label + i}
              title={`${c.label}: ${formatValue(c.value)}`}
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
          Peak: <span className="text-[var(--text)]">{cells[peakIdx].label}</span> · {formatValue(cells[peakIdx].value)}
        </p>
      )}
    </div>
  );
}
