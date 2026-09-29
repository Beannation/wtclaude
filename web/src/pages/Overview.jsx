import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Link } from 'react-router-dom';
import { useDashboard } from '../lib/useDashboard';
import { useApp, useThemeColors } from '../context/AppContext';
import { formatCost, formatTokens, formatPercent, formatDuration, formatAxisCost } from '../lib/format';
import {
  dailyView, viewTotals, costBasis, basisBadgeProps, yesterdayDelta, mostExpensiveSession, peakBuckets,
  costByModel, modelSplitNote, costBySource, runRate, runRateNote, agentPool, taskBreakdown, dailyChart, distinctSessionCount,
} from '../lib/derive';
import StatCard from '../components/StatCard';
import LimitGauge from '../components/LimitGauge';
import Donut from '../components/Donut';
import Heatmap from '../components/Heatmap';
import HonestyBadge from '../components/HonestyBadge';
import CopyCommand from '../components/CopyCommand';
import SessionHeading from '../components/SessionHeading';
import InlineCode from '../components/InlineCode';
import { ErrorState } from '../components/EmptyState';
import DataStatus, { NoDataInWindow } from '../components/DataStatus';
import { AGENT_SDK_POOL_PAUSED_NOTE, IS_MOCK } from '../lib/config';

export default function Overview() {
  const { data, loading, error, errorInfo, linked } = useDashboard();
  const { currency } = useApp();
  const c = useThemeColors();
  const fc = (v) => formatCost(v, currency);
  // "+$3.63" / "≈ +€3.34": the sign goes after the approximation mark.
  const signed = (v) => {
    const body = fc(Math.abs(v));
    const sign = v >= 0 ? '+' : '−';
    return body.startsWith('≈ ') ? `≈ ${sign}${body.slice(2)}` : `${sign}${body}`;
  };

  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!linked) return <LinkPrompt />;
  if (error) return <ErrorState info={errorInfo} fallbackTitle="Couldn't load your dashboard" />;

  const now = new Date();
  // One daily view for every date-keyed figure: local days when get-dashboard
  // sends daily_local, UTC days (and labelled so) when it does not.
  const view = dailyView(data, now);
  const utc = !view.local;
  const sessions = data.sessions;
  const t = viewTotals(view);
  const basis = costBasis(t);
  const yd = yesterdayDelta(view);
  const top = mostExpensiveSession(sessions);
  const rr = runRate(view);
  const agent = agentPool(view);
  const tasks = taskBreakdown(sessions);
  const byModel = costByModel(sessions);
  const chartData = dailyChart(view);
  const peaks = peakBuckets(data);
  const turnPeaks = peaks.basis === 'turn-time';
  // Active time: daily_local's api_duration_ms when sent, else the UTC rows (viewTotals).
  const apiMs = t.apiMs;
  const converted = currency !== 'USD';

  const header = (
    <div className="space-y-2">
      <h2 className="text-2xl font-bold text-[var(--text-strong)]">Overview</h2>
      <DataStatus data={data} view={view} now={now} />
    </div>
  );

  if (t.cost <= 0 && t.turns <= 0 && !sessions.length) {
    return (
      <div className="space-y-6">
        {header}
        <NoDataInWindow data={data} days={view.days} now={now} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {header}

      {/* Headline stats with honesty labeling — each badge describes its own figure */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label={utc ? 'Today (UTC day)' : "Today's cost"} value={fc(yd.todayCost)} accent="accent"
          {...basisBadgeProps(yd.todayBasis)} />
        <StatCard label={`${view.days}-day cost`} value={fc(t.cost)} accent="accent" {...basisBadgeProps(basis)} />
        <StatCard label="Tokens (incl. cache)" value={formatTokens(t.tokens)}
          sub={`${formatTokens(t.input + t.output)} in+out · ${t.turns} turns`} />
        <StatCard label="Sessions" value={distinctSessionCount(sessions)} sub={`${formatDuration(apiMs)} active`} />
      </div>

      {/* Limit gauge + yesterday delta + run-rate */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <LimitGauge rateLimits={data.rate_limits} meta={data.meta} now={now.getTime()} />
        <StatCard label={utc ? 'Yesterday delta (UTC days)' : 'Yesterday delta'} accent={yd.diff > 0 ? 'rose' : 'accent'}
          value={signed(yd.diff)}
          {...basisBadgeProps(yd.basis)}
          sub={yd.pct == null ? 'no spend yesterday' : `${yd.diff >= 0 ? '▲' : '▼'} ${formatPercent(Math.abs(yd.pct))} vs yesterday`} />
        <StatCard label="Run-rate projection" accent="indigo" value={`${fc(rr.monthly)}/mo`} badge="estimate"
          sub={runRateNote(rr, { utc, fc })} />
      </div>

      {/* Most-expensive session + Agent-SDK pool tile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {top && (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 min-w-0">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide">Most expensive session</h3>
              <HonestyBadge tier={top.cost_basis === 'estimate' ? 'estimate' : top.cost_basis === 'mixed' ? 'mixed' : 'billing-grade'} />
            </div>
            <p className="text-2xl font-bold font-mono text-[var(--accent)]">{fc(Number(top.estimated_cost_usd))}</p>
            <p className="text-xs text-[var(--muted)] mt-1 break-words">
              <SessionHeading session={top} idChars={8} /> · {top.turn_count} turns · {formatTokens(top.total_input_tokens + top.total_output_tokens)} tok (in+out)
            </p>
            <Link to={`/sessions?s=${top.id}`} className="text-xs text-[var(--indigo)] hover:underline mt-3 inline-block">View session →</Link>
          </div>
        )}
        {/* QA-0928-24: this tile used to project ALL spend under an "Agent-SDK
            forecast" title and say the paused June-15 split "sharpens this". It
            now covers agent_sdk-pool rows only and says the split is paused. */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide">Agent-SDK pool</h3>
            {agent.hasData && <HonestyBadge tier="forecast" />}
          </div>
          {agent.hasData ? (
            <>
              <p className="text-2xl font-bold font-mono text-[var(--indigo)]">{fc(agent.monthly)}/mo</p>
              <p className="text-xs text-[var(--muted)] mt-1">
                Agent-SDK-pool spend only, at its last-{agent.days}-day rate ({fc(agent.dailyAvg)}/day) — a projection, not your future bill.
              </p>
            </>
          ) : (
            <p className="text-sm text-[var(--muted)]">
              No turns in the last {agent.days} days were recorded against the Agent-SDK pool, so there is nothing to forecast.
            </p>
          )}
          {!agent.activated && (
            <p className="text-xs text-[var(--faint)] mt-2"><InlineCode text={AGENT_SDK_POOL_PAUSED_NOTE} /></p>
          )}
        </div>
      </div>

      {/* Donuts: cost by source (honesty split) + by model */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Donut title="Cost by source" data={costBySource(t)} formatValue={fc} />
        <Donut title="Cost by model" data={byModel.slices} formatValue={fc} note={modelSplitNote(byModel)} />
      </div>

      {/* Peak heatmaps (QA-0928-29): turn spend by local hour when the server
          sends it; otherwise session start, labelled, with no $ figure. */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Heatmap title={turnPeaks ? 'Peak hours' : 'Peak hours (by session start)'}
          subtitle={turnPeaks ? `Turn spend by hour, ${view.tz}` : 'Each session’s cost at the hour it started, not when it was spent'}
          cells={peaks.hours} columns={12} formatValue={fc} showValues={turnPeaks}
          countLabel={turnPeaks ? 'turns' : 'sessions started'} />
        <Heatmap title={turnPeaks ? 'Peak days' : 'Peak days (by session start)'}
          subtitle={turnPeaks ? `Turn spend by weekday, ${view.tz}` : 'Each session’s cost on the day it started'}
          cells={peaks.days} columns={7} formatValue={fc} showValues={turnPeaks}
          countLabel={turnPeaks ? 'turns' : 'sessions started'} />
      </div>

      {/* Task breakdown (honest empty) + one-shot rate */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tasks.available ? (
          <Donut title="Where your tokens go (by task)" data={tasks.slices} formatValue={fc} />
        ) : (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 min-w-0">
            <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide mb-3">Task breakdown</h3>
            <p className="text-[var(--muted)] text-sm">No task categories yet.</p>
            <p className="text-[var(--faint)] text-xs mt-2">
              Claude Code's statusline payload doesn't currently expose tool names, so per-task
              categories can't be computed from synced data. This view fills in automatically if a
              future Claude Code version exposes it.
            </p>
          </div>
        )}
        <OneShotCard />
      </div>

      {/* Daily cost chart — every day of the window, local days when available */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 min-w-0">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide mb-4">
          Daily cost ({view.days} {utc ? 'UTC days' : 'days'}{converted ? `, ≈ ${currency} converted from USD` : ''})
        </h3>
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={chartData}>
            <XAxis dataKey="label" tick={{ fill: c.faint, fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={{ fill: c.faint, fontSize: 11 }} tickFormatter={(v) => formatAxisCost(v, currency)} width={56} />
            <Tooltip contentStyle={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8, color: c.text }}
              labelFormatter={(l, p) => p?.[0]?.payload?.fullLabel ?? l}
              formatter={(v) => [fc(v), 'Cost']} cursor={{ fill: c.cardHover }} />
            <Bar dataKey="cost" fill={c.accent} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="text-xs text-[var(--faint)]">
        Cost is anchored on Claude Code's <code>cost.total_cost_usd</code> (billing-grade) wherever a turn carries it;
        anything else is labelled an estimate. Currency is display-only: converted figures are approximate (≈), and
        the source figure stays in USD.{IS_MOCK && ' Showing demo data.'}
      </p>
    </div>
  );
}

// QA-0928-189: the same quality status as the site's /features and /docs — the
// command ships, the field it reads isn't in the payloads yet. This card used
// to say "Computed locally from edit→test→re-edit cycles", as if it worked.
export function OneShotCard() {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 min-w-0">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide">One-shot success rate</h3>
        <HonestyBadge tier="estimate" />
      </div>
      <p className="text-[var(--muted)] text-sm">How often the model's edits land first try, without a retry on the same file.</p>
      <p className="text-[var(--faint)] text-xs mt-2 mb-3">
        The command ships; the edit-target field it reads isn't in current Claude Code payloads yet, so today it
        reports "not available yet". Check it in your terminal:
      </p>
      <CopyCommand command="wtclaude quality" />
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
