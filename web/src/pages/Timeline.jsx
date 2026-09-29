import { Link } from 'react-router-dom';
import { useDashboard } from '../lib/useDashboard';
import { useApp } from '../context/AppContext';
import { formatCost, formatTokens, formatDuration, formatDateTime, relativeTime } from '../lib/format';
import { timelineDays, deviceLabel, sessionWindowCost } from '../lib/derive';
import Sparkline from '../components/Sparkline';
import HonestyBadge from '../components/HonestyBadge';
import CopyCommand from '../components/CopyCommand';
import SessionHeading from '../components/SessionHeading';
import { ErrorState } from '../components/EmptyState';
import DataStatus, { NoDataInWindow } from '../components/DataStatus';
import { LinkPrompt } from './Overview';

const BASIS_TIER = { 'billing-grade': 'billing-grade', mixed: 'mixed', estimate: 'estimate' };

// Days and the "Today" / "Yesterday" headings follow the LOCAL calendar
// (QA-0928-88) — see derive.timelineDays. They used to key on the UTC date, so
// at 22:30 EDT that morning's sessions were headed "Yesterday".

function ActivityCard({ s, fc }) {
  const models = Object.keys(s.models_used || {});
  const tier = BASIS_TIER[s.cost_basis] || 'billing-grade';
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden hover:border-[var(--faint)] transition-colors min-w-0">
      {/* the "route" — per-turn cost shape */}
      <div className="px-5 pt-4">
        <Sparkline data={s.cost_spark && s.cost_spark.length ? s.cost_spark : [0]} height={44} />
      </div>
      <div className="px-5 pb-4 pt-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <SessionHeading session={s} className="text-sm text-[var(--text-strong)]" />
              <HonestyBadge tier={tier} />
            </div>
            <p className="text-xs text-[var(--faint)] mt-0.5">
              {formatDateTime(s.started_at)} · {relativeTime(s.ended_at)} · {deviceLabel(s.device_id, s.device_label)}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-mono text-lg font-bold text-[var(--accent)]">{fc(Number(s.estimated_cost_usd))}</p>
            {s.window_total_usd != null && Math.abs(sessionWindowCost(s) - Number(s.estimated_cost_usd || 0)) >= 0.005 && (
              <p className="text-[10px] text-[var(--faint)]">{fc(sessionWindowCost(s))} in this window</p>
            )}
          </div>
        </div>

        {/* Strava-style "splits" stat row */}
        <div className="grid grid-cols-4 gap-2 mt-3 text-center">
          <Split label="Turns" value={s.turn_count} />
          <Split label="Tokens" value={formatTokens(s.total_input_tokens + s.total_output_tokens)} />
          <Split label="Active" value={formatDuration(s.api_duration_ms)} />
          <Split label="Lines" value={`+${s.lines_added ?? 0}/−${s.lines_removed ?? 0}`} />
        </div>

        <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
          <div className="flex gap-1 flex-wrap min-w-0">
            {models.map((m) => (
              <span key={m} className="px-2 py-0.5 rounded text-[10px] bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">{m}</span>
            ))}
            {s.cost_center && <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--surface)] text-[var(--indigo)] border border-[var(--border)]">{s.cost_center}</span>}
          </div>
          {/* Wraps on a phone (QA-0928-99): the resume button used to push
              "Detail →" off the card, where overflow-hidden clipped it. */}
          <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full">
            <CopyCommand command={`claude --resume ${s.session_id}`} label="resume" />
            <Link to={`/sessions?s=${s.id}`} className="text-xs text-[var(--indigo)] hover:underline shrink-0">Detail →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function Split({ label, value }) {
  return (
    <div className="bg-[var(--surface)] rounded-lg py-1.5">
      <p className="font-mono text-sm text-[var(--text)]">{value}</p>
      <p className="text-[10px] text-[var(--faint)] uppercase tracking-wide">{label}</p>
    </div>
  );
}

export default function Timeline() {
  const { data, loading, error, errorInfo, linked, days: windowDays } = useDashboard();
  const { currency } = useApp();
  const fc = (v) => formatCost(v, currency);

  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!linked) return <LinkPrompt />;
  if (error) return <ErrorState info={errorInfo} fallbackTitle="Couldn't load your timeline" />;

  const now = new Date();
  const days = timelineDays(data.sessions, now);

  return (
    <div>
      <div className="mb-6 space-y-2">
        <h2 className="text-2xl font-bold text-[var(--text-strong)]">Timeline</h2>
        <p className="text-[var(--muted)] text-sm">Every session as an activity — the route is your per-turn cost. Days follow your local calendar.</p>
        <DataStatus data={data} now={now} />
      </div>
      {!days.length && <NoDataInWindow data={data} days={data.meta?.days || windowDays} what="sessions" now={now} />}

      <div className="relative">
        <div className="absolute left-2 top-0 bottom-0 w-px bg-[var(--border)] hidden sm:block" aria-hidden="true" />
        <div className="space-y-8">
          {days.map((day) => {
            const dayCost = day.sessions.reduce((s, x) => s + Number(x.estimated_cost_usd || 0), 0);
            return (
              <section key={day.date}>
                <div className="flex items-center gap-3 mb-3 sm:pl-8 flex-wrap">
                  <h3 className="text-sm font-semibold text-[var(--text-strong)]">{day.heading}</h3>
                  <span className="text-xs text-[var(--faint)] font-mono">{fc(dayCost)} · {day.sessions.length} session{day.sessions.length > 1 ? 's' : ''} started</span>
                </div>
                <div className="space-y-4 sm:pl-8">
                  {day.sessions.map((s) => <ActivityCard key={s.id} s={s} fc={fc} />)}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
