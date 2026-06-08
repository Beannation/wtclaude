import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

const PALETTE = ['#4ade80', '#818cf8', '#fbbf24', '#fb7185', '#22d3ee', '#a78bfa', '#f472b6', '#94a3b8'];
// Honesty-aware colors when slices carry a `basis`.
const BASIS_COLOR = {
  'billing-grade': '#4ade80',
  inferred: '#fbbf24',
  estimate: '#94a3b8',
};

export default function Donut({ data, title, formatValue = (v) => v, badge }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide">{title}</h3>
        {badge}
      </div>
      {total <= 0 ? (
        <p className="text-[var(--faint)] text-sm py-8 text-center">No data in range.</p>
      ) : (
        <div className="flex items-center gap-4">
          <div className="w-32 h-32 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={data} dataKey="value" nameKey="name" innerRadius={38} outerRadius={58} paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {data.map((d, i) => (
                    <Cell key={d.name} fill={d.basis ? BASIS_COLOR[d.basis] : PALETTE[i % PALETTE.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                  formatter={(v, n) => [formatValue(v), n]}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="flex-1 space-y-1.5 text-sm min-w-0">
            {data.map((d, i) => (
              <li key={d.name} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 min-w-0">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: d.basis ? BASIS_COLOR[d.basis] : PALETTE[i % PALETTE.length] }} />
                  <span className="text-[var(--text)] truncate">{d.name}</span>
                </span>
                <span className="text-[var(--muted)] font-mono shrink-0">{formatValue(d.value)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
