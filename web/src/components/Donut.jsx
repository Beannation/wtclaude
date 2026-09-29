import { PieChart, Pie, Cell, Tooltip } from 'recharts';
import { MODEL_SPLIT_TITLES } from '../lib/derive';

const PALETTE = ['#4ade80', '#818cf8', '#fbbf24', '#fb7185', '#22d3ee', '#a78bfa', '#f472b6', '#94a3b8'];
// Honesty-aware colors when slices carry a `basis`.
const BASIS_COLOR = {
  'billing-grade': '#4ade80',
  inferred: '#fbbf24',
  estimate: '#94a3b8',
};

// The unsplit share (Cost by model): a neutral grey, never a model's colour.
const BUCKET_COLOR = '#94a3b8';

// Slices: { name, value, label?, basis?, notPriced?, notSplit?, partlyUnsplit?,
// bucket? }. `label` is the legend text (the full `name` is its title); a
// `notPriced` or `notSplit` row shows no amount; a `bucket` row is the share
// Cost by model keeps apart (derive.costByModel). `note` is a line under the
// title saying what the figures are.
//
// RC 0.3.2 (dash-prod): at phone and tablet widths the legend's `truncate` cut
// every model id to 'claude-o…'. In a narrow card the chart now sits above the
// legend (container query), names wrap, and each carries its full id as a title.
export default function Donut({ data, title, formatValue = (v) => v, badge, note }) {
  const rows = data.map((d, i) => ({
    ...d, label: d.label ?? d.name,
    color: d.bucket ? BUCKET_COLOR : d.basis ? BASIS_COLOR[d.basis] : PALETTE[i % PALETTE.length],
  }));
  const total = rows.reduce((s, d) => s + d.value, 0);
  const slices = rows.filter((d) => d.value > 0);
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide">{title}</h3>
        {badge}
      </div>
      {note && <p className="text-xs text-[var(--faint)] mb-3">{note}</p>}
      {total <= 0 ? (
        <p className="text-[var(--faint)] text-sm py-8 text-center">No data in range.</p>
      ) : (
        <div className="@container">
          <div className="flex flex-col items-center gap-4 @sm:flex-row">
            {/* Fixed-size chart (QA-0928-178): a ResponsiveContainer inside a fixed
                box measured -1 on first render and logged a warning per donut. */}
            <div className="w-32 h-32 shrink-0">
              <PieChart width={128} height={128}>
                <Pie data={slices} dataKey="value" nameKey="label" innerRadius={38} outerRadius={58} paddingAngle={2} stroke="none" isAnimationActive={false}>
                  {slices.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text)' }}
                  formatter={(v, n) => [formatValue(v), n]}
                />
              </PieChart>
            </div>
            <ul className="w-full @sm:w-auto @sm:flex-1 space-y-1.5 text-sm min-w-0">
              {rows.map((d) => (
                <li key={d.name} className="flex items-start justify-between gap-2">
                  <span className="flex items-start gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 mt-1.5 rounded-full shrink-0"
                      style={d.notPriced || d.notSplit ? { border: '1px solid var(--faint)' } : { background: d.color }} />
                    <span className={`[overflow-wrap:anywhere] ${d.bucket ? 'text-[var(--muted)] italic' : 'text-[var(--text)]'}`}
                      title={d.bucket ? MODEL_SPLIT_TITLES.bucket : d.name}>{d.label}</span>
                  </span>
                  {d.notPriced || d.notSplit ? (
                    <span className="text-[var(--faint)] text-xs uppercase tracking-wide shrink-0 mt-0.5"
                      title={d.notSplit ? MODEL_SPLIT_TITLES.notSplit : MODEL_SPLIT_TITLES.notPriced}>
                      {d.notSplit ? 'not split' : 'not priced'}
                    </span>
                  ) : (
                    <span className="text-[var(--muted)] font-mono shrink-0"
                      title={d.partlyUnsplit ? MODEL_SPLIT_TITLES.partlyUnsplit : undefined}>
                      {formatValue(d.value)}{d.partlyUnsplit ? ' +' : ''}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
