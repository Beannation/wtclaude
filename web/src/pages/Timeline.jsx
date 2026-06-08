import { Link } from 'react-router-dom';
import { useDashboard } from '../lib/useDashboard';
import { useApp } from '../context/AppContext';
import { formatCost, formatTokens, formatDuration, formatDateTime, relativeTime } from '../lib/format';
import Sparkline from '../components/Sparkline';
import HonestyBadge from '../components/HonestyBadge';
import CopyCommand from '../components/CopyCommand';
import EmptyState from '../components/EmptyState';
import { LinkPrompt } from './Overview';

const BASIS_TIER = { 'billing-grade': 'billing-grade', mixed: 'mixed', estimate: 'estimate' };

function dayHeading(dateStr) {
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  if (dateStr === today) return 'Today';
  if (dateStr === yest) return 'Yesterday';
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
}

function ActivityCard({ s, fc }) {
  const models = Object.keys(s.models_used || {});
  const tier = BASIS_TIER[s.cost_basis] || 'billing-grade';
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden hover:border-[var(--faint)] transition-colors">
      {/* the "route" — per-turn cost shape */}
      <div className="px-5 pt-4">
        <Sparkline data={s.cost_spark && s.cost_spark.length ? s.cost_spark : [0]} height={44} />
      </div>
      <div className="px-5 pb-4 pt-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm text-[var(--text-strong)] truncate">{s.git_branch || s.session_id.slice(0, 12)}</span>
              <HonestyBadge tier={tier} />
            </div>
            <p className="text-xs text-[var(--faint)] mt-0.5">
              {formatDateTime(s.started_at)} · {relativeTime(s.ended_at)} · {s.device_label || s.device_id}
            </p>
          </div>
          <p className="font-mono text-lg font-bold text-[var(--accent)] shrink-0">{fc(Number(s.estimated_cost_usd))}</p>
        </div>

        {/* Strava-style "splits" stat row */}
        <div className="grid grid-cols-4 gap-2 mt-3 text-center">
          <Split label="Turns" value={s.turn_count} />
          <Split label="Tokens" value={formatTokens(s.total_input_tokens + s.total_output_tokens)} />
          <Split label="Active" value={formatDuration(s.api_duration_ms)} />
          <Split label="Lines" value={`+${s.lines_added ?? 0}/−${s.lines_removed ?? 0}`} />
        </div>

        <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
          <div className="flex gap-1 flex-wrap">
            {models.map((m) => (
              <span key={m} className="px-2 py-0.5 rounded text-[10px] bg-[var(--surface)] text-[var(--muted)] border border-[var(--border)]">{m}</span>
            ))}
            {s.cost_center && <span className="px-2 py-0.5 rounded text-[10px] bg-[var(--surface)] text-[var(--indigo)] border border-[var(--border)]">{s.cost_center}</span>}
          </div>
          <div className="flex items-center gap-2">
            <CopyCommand command={`claude --resume ${s.session_id}`} label="resume" />
            <Link to={`/sessions?s=${s.id}`} className="text-xs text-[var(--indigo)] hover:underline">Detail →</Link>
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
  const { data, loading, error, linked } = useDashboard();
  const { currency } = useApp();
  const fc = (v) => formatCost(v, currency);

  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!linked) return <LinkPrompt />;
  if (error) return <EmptyState title="Couldn't load your timeline" body={error} />;

  const sessions = [...data.sessions].sort((a, b) => b.started_at.localeCompare(a.started_at));
  if (!sessions.length) {
    return <EmptyState title="No sessions yet" body="Use Claude Code, then sync." command="wtclaude sync" />;
  }

  // Group by day.
  const byDay = {};
  for (const s of sessions) {
    const day = s.started_at.slice(0, 10);
    (byDay[day] ||= []).push(s);
  }
  const days = Object.keys(byDay).sort((a, b) => b.localeCompare(a));

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-[var(--text-strong)]">Timeline</h2>
        <p className="text-[var(--muted)] text-sm mt-1">Every session as an activity — the route is your per-turn cost.</p>
      </div>

      <div className="relative">
        <div className="absolute left-2 top-0 bottom-0 w-px bg-[var(--border)] hidden sm:block" aria-hidden="true" />
        <div className="space-y-8">
          {days.map((day) => {
            const dayCost = byDay[day].reduce((s, x) => s + Number(x.estimated_cost_usd || 0), 0);
            return (
              <section key={day}>
                <div className="flex items-center gap-3 mb-3 sm:pl-8">
                  <h3 className="text-sm font-semibold text-[var(--text-strong)]">{dayHeading(day)}</h3>
                  <span className="text-xs text-[var(--faint)] font-mono">{fc(dayCost)} · {byDay[day].length} session{byDay[day].length > 1 ? 's' : ''}</span>
                </div>
                <div className="space-y-4 sm:pl-8">
                  {byDay[day].map((s) => <ActivityCard key={s.id} s={s} fc={fc} />)}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
