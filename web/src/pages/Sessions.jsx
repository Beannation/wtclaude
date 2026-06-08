import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useDashboard } from '../lib/useDashboard';
import { useApp, useThemeColors } from '../context/AppContext';
import { fetchSession } from '../lib/api';
import { formatCost, formatTokens, formatDuration, formatDateTime } from '../lib/format';
import { facets, filterSessions, groupSessions, sessionsToCSV } from '../lib/derive';
import FilterChips from '../components/FilterChips';
import HonestyBadge from '../components/HonestyBadge';
import CopyCommand from '../components/CopyCommand';
import EmptyState from '../components/EmptyState';
import { LinkPrompt } from './Overview';

const GROUP_DIMS = [
  { key: null, label: 'None' },
  { key: 'git_branch', label: 'Branch' },
  { key: 'cost_center', label: 'Cost center' },
  { key: 'device_id', label: 'Device' },
  { key: 'model', label: 'Model' },
];

const BASIS_TIER = { 'billing-grade': 'billing-grade', mixed: 'mixed', estimate: 'estimate' };

function downloadCSV(sessions) {
  const csv = sessionsToCSV(sessions);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `wtclaude-sessions-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Sessions() {
  const { data, loading, error, linked } = useDashboard();
  const { currency } = useApp();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({});
  const [groupDim, setGroupDim] = useState(null);
  const fc = (v) => formatCost(v, currency);

  const selectedId = params.get('s');
  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!linked) return <LinkPrompt />;
  if (error) return <EmptyState title="Couldn't load sessions" body={error} />;

  if (selectedId) return <SessionDetail id={selectedId} onBack={() => setParams({})} fc={fc} />;

  const all = data.sessions;
  const f = facets(all);
  const filtered = filterSessions(all, filters).sort((a, b) => b.started_at.localeCompare(a.started_at));
  const groups = groupDim ? groupSessions(filtered, groupDim) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-[var(--text-strong)]">Sessions</h2>
        <div className="flex items-center gap-3">
          <label className="text-xs text-[var(--faint)]">Group by</label>
          <select value={groupDim || ''} onChange={(e) => setGroupDim(e.target.value || null)}
            className="bg-[var(--card)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text)]">
            {GROUP_DIMS.map((g) => <option key={g.label} value={g.key || ''}>{g.label}</option>)}
          </select>
          <button onClick={() => downloadCSV(filtered)}
            className="text-xs border border-[var(--border)] rounded px-3 py-1 text-[var(--text)] hover:border-[var(--accent)]">
            Export CSV
          </button>
        </div>
      </div>

      <FilterChips facets={f} value={filters} onChange={setFilters} />
      <p className="text-xs text-[var(--faint)] mb-4">{filtered.length} of {all.length} sessions</p>

      {groups ? (
        <div className="space-y-2">
          {groups.map((g) => (
            <div key={g.key} className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 flex items-center justify-between">
              <div>
                <p className="text-[var(--text-strong)] font-medium">{groupDim === 'device_id' ? (f.deviceLabels[g.key] || g.key) : g.key}</p>
                <p className="text-xs text-[var(--faint)] mt-1">{g.sessions} sessions · {g.turns} turns · {formatTokens(g.tokens)} tok</p>
              </div>
              <p className="font-mono font-bold text-[var(--accent)]">{fc(g.cost)}</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <button key={s.id} onClick={() => setParams({ s: s.id })}
              className="w-full bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 flex items-center justify-between hover:border-[var(--faint)] transition-colors text-left">
              <div className="min-w-0">
                <p className="text-[var(--text-strong)] font-mono text-sm flex items-center gap-2">
                  {s.git_branch || s.session_id.slice(0, 12)}
                  <HonestyBadge tier={BASIS_TIER[s.cost_basis] || 'billing-grade'} />
                </p>
                <p className="text-[var(--faint)] text-xs mt-1">{formatDateTime(s.started_at)} · {s.turn_count} turns · {s.device_label || s.device_id}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[var(--accent)] font-mono font-bold">{fc(Number(s.estimated_cost_usd))}</p>
                <p className="text-[var(--faint)] text-xs mt-1">{formatTokens(s.total_input_tokens + s.total_output_tokens)} tok</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionDetail({ id, onBack, fc }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const c = useThemeColors();

  useEffect(() => {
    let alive = true;
    fetchSession(id).then((s) => { if (alive) { setSession(s); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  if (loading) return <p className="text-[var(--muted)]">Loading session…</p>;
  if (!session) return <EmptyState title="Session not found" body="It may not have synced yet." />;

  const turns = session.turns || [];
  const chartData = turns.map((t) => ({ turn: `#${t.turn}`, input: t.input_tokens, output: t.output_tokens, cache: t.cache_read_tokens }));
  const tier = BASIS_TIER[session.cost_basis] || 'billing-grade';

  return (
    <div>
      <button onClick={onBack} className="text-[var(--muted)] hover:text-[var(--text)] mb-4 text-sm">← Back to sessions</button>

      <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-[var(--text-strong)] flex items-center gap-2">
            {session.git_branch || session.session_id.slice(0, 16)} <HonestyBadge tier={tier} />
          </h2>
          <p className="text-[var(--faint)] text-sm mt-1">
            {formatDateTime(session.started_at)} · {session.turn_count} turns · {fc(Number(session.estimated_cost_usd))} · active {formatDuration(session.api_duration_ms)}
          </p>
        </div>
        {/* One-click resume (A5) */}
        <div className="text-right">
          <p className="text-xs text-[var(--faint)] mb-1">Resume this session</p>
          <CopyCommand command={`claude --resume ${session.session_id}`} label="copy" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-5">
        <Mini label="Cost center" value={session.cost_center || '—'} />
        <Mini label="Device" value={session.device_label || session.device_id} />
        <Mini label="Lines" value={`+${session.lines_added ?? 0} / −${session.lines_removed ?? 0}`} />
        <Mini label="Tokens" value={formatTokens(session.total_input_tokens + session.total_output_tokens)} />
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 mb-6">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide mb-4">Tokens per turn</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData}>
            <XAxis dataKey="turn" tick={{ fill: c.faint, fontSize: 11 }} interval={Math.max(0, Math.floor(turns.length / 12))} />
            <YAxis tick={{ fill: c.faint, fontSize: 11 }} tickFormatter={formatTokens} />
            <Tooltip contentStyle={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8, color: c.text }}
              formatter={(v, n) => [formatTokens(v), n]} cursor={{ fill: c.cardHover }} />
            <Bar dataKey="input" stackId="a" fill={c.indigo} isAnimationActive={false} />
            <Bar dataKey="output" stackId="a" fill={c.accent} isAnimationActive={false} />
            <Bar dataKey="cache" stackId="a" fill={c.border} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="space-y-2">
        {turns.map((t) => (
          <div key={t.turn} className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-3 flex items-center justify-between text-sm gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-[var(--faint)] w-8 shrink-0">#{t.turn}</span>
              <span className="px-2 py-0.5 rounded text-xs bg-[var(--surface)] text-[var(--muted)] truncate">{t.model}</span>
              {t.speed_tier === 'fast' && <HonestyBadge tier={t.speed_tier_source === 'payload' ? 'billing-grade' : 'inferred'} label="fast" />}
            </div>
            <div className="flex gap-4 text-[var(--muted)] shrink-0">
              <span>In {formatTokens(t.input_tokens)}</span>
              <span>Out {formatTokens(t.output_tokens)}</span>
              {typeof t.cost_usd === 'number' && <span className="text-[var(--accent)] font-mono">{fc(t.cost_usd)}</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Mini({ label, value }) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-3">
      <p className="text-[10px] text-[var(--faint)] uppercase tracking-wide">{label}</p>
      <p className="text-sm text-[var(--text)] font-mono truncate">{value}</p>
    </div>
  );
}
