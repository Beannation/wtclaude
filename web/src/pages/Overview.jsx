import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Link } from 'react-router-dom';
import { useDashboard } from '../lib/useDashboard';
import { useApp, useThemeColors } from '../context/AppContext';
import { formatCost, formatTokens, formatDate, formatPercent, formatDuration } from '../lib/format';
import {
  totals, costBasis, yesterdayDelta, mostExpensiveSession, peakHours, peakDays,
  costByModel, costBySource, runRate, forecast, taskBreakdown,
} from '../lib/derive';
import StatCard from '../components/StatCard';
import LimitGauge from '../components/LimitGauge';
import Donut from '../components/Donut';
import Heatmap from '../components/Heatmap';
import HonestyBadge from '../components/HonestyBadge';
import CopyCommand from '../components/CopyCommand';
import EmptyState from '../components/EmptyState';
import { DATA_MODE } from '../lib/config';

export default function Overview() {
  const { data, loading, error, linked } = useDashboard();
  const { currency } = useApp();
  const c = useThemeColors();
  const fc = (v) => formatCost(v, currency);

  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!linked) return <LinkPrompt />;
  if (error) return <EmptyState title="Couldn't load your dashboard" body={error} note="Cloud sync is gated on the SEC Phase C deploy. Until then the dashboard runs in demo mode." />;

  const daily = data.daily_summaries;
  const sessions = data.sessions;
  const t = totals(daily);
  const basis = costBasis(t);
  const yd = yesterdayDelta(daily);
  const top = mostExpensiveSession(sessions);
  const rr = runRate(daily);
  const fcast = forecast(daily);
  const tasks = taskBreakdown(sessions);

  const todayStr = new Date().toISOString().slice(0, 10);
  const today = daily.find((d) => d.date === todayStr);

  const chartData = daily.map((d) => ({ date: formatDate(d.date), cost: Number(d.estimated_cost_usd || 0) }));

  const hourCells = peakHours(sessions).map((b) => ({ label: String(b.hour).padStart(2, '0'), value: b.cost }));
  const dayCells = peakDays(sessions).map((b) => ({ label: b.label, value: b.cost }));

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold text-[var(--text-strong)]">Overview</h2>

      {/* Headline stats with honesty labeling */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Today's cost" value={fc(Number(today?.estimated_cost_usd || 0))} accent="accent"
          badge={basis.tier} sub={basis.tier === 'mixed' ? `${basis.pct}% billing-grade` : undefined} />
        <StatCard label="30-day cost" value={fc(t.cost)} accent="accent" badge={basis.tier} />
        <StatCard label="Total tokens" value={formatTokens(t.tokens)} sub={`${t.turns} turns`} />
        <StatCard label="Sessions" value={t.sessions} sub={`${formatDuration(daily.reduce((s, d) => s + Number(d.api_duration_ms || 0), 0))} active`} />
      </div>

      {/* Limit gauge + yesterday delta + run-rate */}
      <div className="grid md:grid-cols-3 gap-4">
        <LimitGauge rateLimits={data.rate_limits} />
        <StatCard label="Yesterday delta" accent={yd.diff > 0 ? 'rose' : 'accent'}
          value={`${yd.diff >= 0 ? '+' : '−'}${fc(Math.abs(yd.diff))}`}
          badge="billing-grade"
          sub={yd.pct == null ? 'no spend yesterday' : `${yd.diff >= 0 ? '▲' : '▼'} ${formatPercent(Math.abs(yd.pct))} vs yesterday`} />
        <StatCard label="Run-rate projection" accent="indigo" value={`${fc(rr.monthly)}/mo`} badge="estimate"
          sub={`from ${fc(rr.dailyAvg)}/day avg (${rr.days}d)`} />
      </div>

      {/* Most-expensive session + Agent-SDK forecast tile */}
      <div className="grid md:grid-cols-2 gap-4">
        {top && (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide">Most expensive session</h3>
              <HonestyBadge tier={top.cost_basis === 'estimate' ? 'estimate' : top.cost_basis === 'mixed' ? 'mixed' : 'billing-grade'} />
            </div>
            <p className="text-2xl font-bold font-mono text-[var(--accent)]">{fc(Number(top.estimated_cost_usd))}</p>
            <p className="text-xs text-[var(--muted)] mt-1">
              {top.git_branch || top.session_id.slice(0, 8)} · {top.turn_count} turns · {formatTokens(top.total_input_tokens + top.total_output_tokens)} tok
            </p>
            <Link to={`/sessions?s=${top.id}`} className="text-xs text-[var(--indigo)] hover:underline mt-3 inline-block">View session →</Link>
          </div>
        )}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide">Agent-SDK forecast</h3>
            <HonestyBadge tier="forecast" />
          </div>
          <p className="text-2xl font-bold font-mono text-[var(--indigo)]">{fc(fcast.projectedMonthly)}/mo</p>
          <p className="text-xs text-[var(--muted)] mt-1">projected range {fc(fcast.low)} – {fc(fcast.high)}</p>
          <p className="text-xs text-[var(--faint)] mt-2">A projection from your trailing usage — not your exact future bill. The June-15 pool split sharpens this as more days are tracked.</p>
        </div>
      </div>

      {/* Donuts: cost by source (honesty split) + by model */}
      <div className="grid md:grid-cols-2 gap-4">
        <Donut title="Cost by source" data={costBySource(t)} formatValue={fc}
          badge={<HonestyBadge tier="mixed" label="3-tier" />} />
        <Donut title="Cost by model" data={costByModel(sessions)} formatValue={fc} />
      </div>

      {/* Peak heatmaps */}
      <div className="grid md:grid-cols-2 gap-4">
        <Heatmap title="Peak hours" cells={hourCells} columns={12} formatValue={fc} />
        <Heatmap title="Peak days" cells={dayCells} columns={7} formatValue={fc} />
      </div>

      {/* Task breakdown (honest empty) + one-shot rate */}
      <div className="grid md:grid-cols-2 gap-4">
        {tasks.available ? (
          <Donut title="Where your tokens go (by task)" data={tasks.slices} formatValue={fc} />
        ) : (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
            <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide mb-3">Task breakdown</h3>
            <p className="text-[var(--muted)] text-sm">No task categories yet.</p>
            <p className="text-[var(--faint)] text-xs mt-2">
              Claude Code's statusline payload doesn't currently expose tool names, so per-task
              categories can't be computed from synced data. This view fills in automatically if a
              future Claude Code version exposes it.
            </p>
          </div>
        )}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide">One-shot success rate</h3>
            <HonestyBadge tier="estimate" />
          </div>
          <p className="text-[var(--muted)] text-sm">Computed locally from edit→test→re-edit cycles.</p>
          <p className="text-[var(--faint)] text-xs mt-2 mb-3">
            The edit-target signal isn't carried in synced data (privacy: salted hashes stay on-device),
            so run it in your terminal:
          </p>
          <CopyCommand command="wtclaude quality" />
        </div>
      </div>

      {/* Daily cost chart */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide mb-4">Daily cost (30 days)</h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData}>
            <XAxis dataKey="date" tick={{ fill: c.faint, fontSize: 11 }} interval={4} />
            <YAxis tick={{ fill: c.faint, fontSize: 11 }} />
            <Tooltip contentStyle={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8, color: c.text }}
              formatter={(v) => [fc(v), 'Cost']} cursor={{ fill: c.cardHover }} />
            <Bar dataKey="cost" fill={c.accent} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-[var(--faint)]">
        Cost is anchored on Claude Code's <code>cost.total_cost_usd</code> (billing-grade). Currency is display-only;
        the source figure stays in USD. Data mode: <code>{DATA_MODE}</code>.
      </p>
    </div>
  );
}

export function LinkPrompt() {
  return (
    <div className="text-center py-20">
      <h2 className="text-2xl font-bold text-[var(--text-strong)] mb-4">Welcome to WTClaude</h2>
      <p className="text-[var(--muted)] mb-6 max-w-md mx-auto">To view your dashboard, link your CLI by running:</p>
      <code className="bg-[var(--card)] text-[var(--accent)] px-4 py-2 rounded-lg text-lg">wtclaude dashboard</code>
    </div>
  );
}
