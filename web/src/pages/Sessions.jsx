import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useDashboard } from '../lib/useDashboard';
import { useApp, useThemeColors } from '../context/AppContext';
import { fetchSession } from '../lib/api';
import { formatCost, formatTokens, formatDuration, formatDateTime, modelLabel } from '../lib/format';
import {
  facets, filterSessions, groupSessions, sessionsToCSV, deviceLabel, sessionWindowCost,
  branchGroupLabel, branchDimLabel, isHashedBranch, HASHED_BRANCH_NOTE, sessionTurnSummary, turnListNote, modelSplitIsExact, modelSplitNote, MODEL_SPLIT_TITLES,
} from '../lib/derive';
import { describeError } from '../lib/errors';
import FilterChips from '../components/FilterChips';
import HonestyBadge from '../components/HonestyBadge';
import CopyCommand from '../components/CopyCommand';
import SessionHeading from '../components/SessionHeading';
import TurnCost from '../components/TurnCost';
import { ErrorState } from '../components/EmptyState';
import DataStatus, { NoDataInWindow } from '../components/DataStatus';
import { LinkPrompt } from './Overview';

const GROUP_DIMS = [
  { key: null, label: 'None' },
  { key: 'git_branch', label: 'Branch' }, // 'Branch (hashed)' once every branch is a hash — branchDimLabel (QA-0928-05)
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
  const { data, loading, error, errorInfo, linked, days: windowDays } = useDashboard();
  const { currency } = useApp();
  const [params, setParams] = useSearchParams();
  const [filters, setFilters] = useState({});
  const [groupDim, setGroupDim] = useState(null);
  const fc = (v) => formatCost(v, currency);

  const selectedId = params.get('s');
  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!linked) return <LinkPrompt />;
  if (error) return <ErrorState info={errorInfo} fallbackTitle="Couldn't load sessions" />;

  if (selectedId) return <SessionDetail id={selectedId} onBack={() => setParams({})} fc={fc} />;

  const all = data.sessions;
  const f = facets(all);
  const filtered = filterSessions(all, filters).sort((a, b) => b.started_at.localeCompare(a.started_at));
  const groups = groupDim ? groupSessions(filtered, groupDim) : null;

  return (
    <div>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-3">
        <h2 className="text-2xl font-bold text-[var(--text-strong)]">Sessions</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-xs text-[var(--faint)]">Group by</label>
          <select value={groupDim || ''} onChange={(e) => setGroupDim(e.target.value || null)}
            className="bg-[var(--card)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text)]">
            {GROUP_DIMS.map((g) => <option key={g.label} value={g.key || ''}>{g.key === 'git_branch' ? branchDimLabel(f.branch) : g.label}</option>)}
          </select>
          <button onClick={() => downloadCSV(filtered)}
            className="text-xs border border-[var(--border)] rounded px-3 py-1 text-[var(--text)] hover:border-[var(--accent)]">
            Export CSV
          </button>
        </div>
      </div>

      <div className="mb-4"><DataStatus data={data} /></div>
      {!all.length && <NoDataInWindow data={data} days={data.meta?.days || windowDays} what="sessions" />}
      <FilterChips facets={f} value={filters} onChange={setFilters} />
      {all.length > 0 && <p className="text-xs text-[var(--faint)] mb-4">{filtered.length} of {all.length} sessions</p>}

      {groups ? (
        <div className="space-y-2">
          {/* By model, each session's cost, turns and tokens are split as the
              Overview's Cost by model splits them (QA-0928-28, RC 0.3.2), so the
              groups sum to the sessions' total; the count is the sessions that
              used the model. */}
          {groupDim === 'model' && (
            <p className="text-xs text-[var(--faint)]">
              {modelSplitNote({
                exact: modelSplitIsExact(filtered),
                unsplitModels: groups.filter((g) => g.notSplit || g.partlyUnsplit).map((g) => g.key),
              })}
            </p>
          )}
          {groups.map((g) => (
            <div key={g.key} className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 flex items-center justify-between gap-3">
              {g.bucket ? (
                <div className="min-w-0">
                  <p className="text-[var(--muted)] font-medium italic" title={MODEL_SPLIT_TITLES.bucket}>Not split by model</p>
                  <p className="text-xs text-[var(--faint)] mt-1">
                    from {g.sessions} session{g.sessions === 1 ? '' : 's'} mixing turns with and without Claude Code’s cost figure
                  </p>
                </div>
              ) : (
                <div className="min-w-0">
                  <p className={`text-[var(--text-strong)] font-medium truncate ${groupDim === 'git_branch' && isHashedBranch(g.key) ? 'font-mono' : ''}`}
                    title={groupDim === 'git_branch' && isHashedBranch(g.key) ? HASHED_BRANCH_NOTE : groupDim === 'model' ? g.key : undefined}>
                    {groupDim === 'device_id' ? (f.deviceLabels[g.key] || g.key) : groupDim === 'git_branch' ? branchGroupLabel(g.key) : groupDim === 'model' ? modelLabel(g.key) : g.key}
                  </p>
                  <p className="text-xs text-[var(--faint)] mt-1">
                    {groupDim === 'model' ? `used in ${g.sessions} session${g.sessions === 1 ? '' : 's'}` : `${g.sessions} sessions`} · {Math.round(g.turns)} turns · {formatTokens(Math.round(g.tokens))} tok (in+out)
                  </p>
                </div>
              )}
              {g.notPriced || g.notSplit ? (
                <p className="text-xs uppercase tracking-wide text-[var(--faint)] shrink-0"
                  title={g.notSplit ? MODEL_SPLIT_TITLES.notSplit : MODEL_SPLIT_TITLES.notPriced}>
                  {g.notSplit ? 'not split' : 'not priced'}
                </p>
              ) : (
                <p className={`font-mono font-bold shrink-0 ${g.bucket ? 'text-[var(--muted)]' : 'text-[var(--accent)]'}`}
                  title={g.partlyUnsplit ? MODEL_SPLIT_TITLES.partlyUnsplit : undefined}>
                  {fc(g.cost)}{g.partlyUnsplit ? ' +' : ''}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((s) => (
            <button key={s.id} onClick={() => setParams({ s: s.id })}
              className="w-full bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 flex items-center justify-between gap-3 hover:border-[var(--faint)] transition-colors text-left">
              <div className="min-w-0">
                <p className="text-[var(--text-strong)] text-sm flex items-center gap-2 flex-wrap">
                  <SessionHeading session={s} />
                  <HonestyBadge tier={BASIS_TIER[s.cost_basis] || 'billing-grade'} />
                </p>
                <p className="text-[var(--faint)] text-xs mt-1">{formatDateTime(s.started_at)} · {s.turn_count} turns · {deviceLabel(s.device_id, s.device_label)}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[var(--accent)] font-mono font-bold">{fc(Number(s.estimated_cost_usd))}</p>
                {s.window_total_usd != null && Math.abs(sessionWindowCost(s) - Number(s.estimated_cost_usd || 0)) >= 0.005 && (
                  <p className="text-[var(--faint)] text-[10px]">{fc(sessionWindowCost(s))} in this window</p>
                )}
                <p className="text-[var(--faint)] text-xs mt-1">{formatTokens(s.total_input_tokens + s.total_output_tokens)} tok (in+out)</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SessionDetail({ id, onBack, fc }) {
  // { id, session, err } for the id it was loaded for; anything else is loading.
  const [result, setResult] = useState(null);
  const c = useThemeColors();

  useEffect(() => {
    let alive = true;
    fetchSession(id).then((s) => { if (alive) setResult({ id, session: s, err: null }); })
      .catch((err) => { if (alive) setResult({ id, session: null, err }); });
    return () => { alive = false; };
  }, [id]);

  if (!result || result.id !== id) return <p className="text-[var(--muted)]">Loading session…</p>;
  // QA-0928-179: a 404 is "not found"; a network or server failure says so.
  if (result.err || !result.session) {
    const info = describeError(result.err, { what: 'session' });
    return (
      <div>
        <button onClick={onBack} className="text-[var(--muted)] hover:text-[var(--text)] mb-4 text-sm">← Back to sessions</button>
        <ErrorState info={info} />
      </div>
    );
  }
  const session = result.session;

  const turns = session.turns || [];
  // get-session returns every turn (contract C); total_turns lets an older,
  // capped server be told apart (QA-0928-122).
  const totalTurns = Number(session.total_turns ?? session.turn_count ?? turns.length);
  const chartData = turns.map((t) => ({ turn: `#${t.turn}`, input: t.input_tokens, output: t.output_tokens, cache: t.cache_read_tokens }));
  const tier = BASIS_TIER[session.cost_basis] || 'billing-grade';
  // Turns without the cost anchor, as `wtclaude session` counts them, and
  // whether the list adds up to the header's total (RC 0.3.2).
  const turnSum = sessionTurnSummary(session, turns);
  const turnNote = turnListNote(turnSum, fc);

  return (
    <div>
      <button onClick={onBack} className="text-[var(--muted)] hover:text-[var(--text)] mb-4 text-sm">← Back to sessions</button>

      <div className="flex items-start justify-between gap-4 mb-2 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-[var(--text-strong)] flex items-center gap-2 flex-wrap break-all">
            <SessionHeading session={session} idChars={16} /> <HonestyBadge tier={tier} />
          </h2>
          <p className="text-[var(--faint)] text-sm mt-1">
            {formatDateTime(session.started_at)} · {session.turn_count} turns · {fc(Number(session.estimated_cost_usd))} · active {formatDuration(session.api_duration_ms)}
          </p>
        </div>
        {/* One-click resume (A5) */}
        <div className="sm:text-right min-w-0 max-w-full">
          <p className="text-xs text-[var(--faint)] mb-1">Resume this session</p>
          <CopyCommand command={`claude --resume ${session.session_id}`} label="copy" />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-5">
        <Mini label="Cost center" value={session.cost_center || '—'} />
        <Mini label="Device" value={deviceLabel(session.device_id, session.device_label)} />
        <Mini label="Lines" value={`+${session.lines_added ?? 0} / −${session.lines_removed ?? 0}`} />
        <Mini label="Tokens (in+out)" value={formatTokens(session.total_input_tokens + session.total_output_tokens)} />
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5 mb-6">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide mb-4">Tokens per turn</h3>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={chartData}>
            {/* Width-aware ticks (RC 0.3.2): a fixed turns ÷ 12 interval ran the
                labels into each other on a phone. */}
            <XAxis dataKey="turn" tick={{ fill: c.faint, fontSize: 11 }} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={{ fill: c.faint, fontSize: 11 }} tickFormatter={formatTokens} />
            <Tooltip contentStyle={{ background: c.surface, border: `1px solid ${c.border}`, borderRadius: 8, color: c.text }}
              formatter={(v, n) => [formatTokens(v), n]} cursor={{ fill: c.cardHover }} />
            <Bar dataKey="input" stackId="a" fill={c.indigo} isAnimationActive={false} />
            <Bar dataKey="output" stackId="a" fill={c.accent} isAnimationActive={false} />
            <Bar dataKey="cache" stackId="a" fill={c.border} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {turnNote && <p className="text-xs text-[var(--faint)] mb-3">{turnNote}</p>}
      {turns.length < totalTurns && (
        <p className="text-xs text-[var(--amber)] mb-3">
          Showing {turns.length} of {totalTurns} turns — the rest were not returned by the cloud, so the list sums to less than the session total.
        </p>
      )}
      <div className="space-y-2">
        {turns.map((t) => (
          <div key={t.turn} className="bg-[var(--card)] border border-[var(--border)] rounded-lg p-3 flex items-center justify-between text-sm gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-[var(--faint)] w-8 shrink-0">#{t.turn}</span>
              <span className="px-2 py-0.5 rounded text-xs bg-[var(--surface)] text-[var(--muted)] truncate" title={t.model}>{modelLabel(t.model)}</span>
              {t.speed_tier === 'fast' && <HonestyBadge tier={t.speed_tier_source === 'payload' ? 'billing-grade' : 'inferred'} label="fast" />}
            </div>
            <div className="flex items-center justify-end gap-x-4 gap-y-1 flex-wrap text-[var(--muted)] shrink-0">
              <span>In {formatTokens(t.input_tokens)}</span>
              <span>Out {formatTokens(t.output_tokens)}</span>
              <TurnCost turn={t} fc={fc} inTotal={turnSum.reconciles} />
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
