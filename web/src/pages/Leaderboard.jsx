import { useState, useEffect } from 'react';
import { fetchLeaderboard } from '../lib/api';
import { describeError } from '../lib/errors';
import { formatTokens } from '../lib/format';
import { ErrorState } from '../components/EmptyState';

export default function Leaderboard() {
  const [period, setPeriod] = useState('weekly');
  // { period, entries, err } for the period it was loaded for. A different
  // period is "loading" until its own response lands (QA-0928-182: the old
  // period's rows used to stay up under the new tab).
  const [result, setResult] = useState(null);

  useEffect(() => {
    let alive = true;
    fetchLeaderboard(period)
      .then((r) => { if (alive) setResult({ period, entries: r.leaderboard || [], err: null }); })
      // QA-0928-106: a failed load is an error, not an empty board.
      .catch((err) => { if (alive) setResult({ period, entries: [], err }); });
    return () => { alive = false; };
  }, [period]);

  const loading = !result || result.period !== period;
  const entries = loading ? [] : result.entries;

  return (
    <div>
      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <h2 className="text-2xl font-bold text-[var(--text-strong)]">Leaderboard</h2>
        <div className="flex gap-2">
          {['weekly', 'monthly'].map((p) => (
            <button key={p} onClick={() => setPeriod(p)} aria-pressed={period === p}
              className={`px-3 py-1.5 rounded text-sm capitalize ${period === p ? 'bg-[var(--card-hover)] text-[var(--text-strong)]' : 'text-[var(--muted)]'}`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--muted)]">Loading…</p>
      ) : result.err ? (
        <ErrorState info={{ ...describeError(result.err, { what: 'leaderboard' }), title: "Couldn't load the leaderboard" }} />
      ) : entries.length === 0 ? (
        <LeaderboardEmpty period={period} />
      ) : (
        <div className="space-y-2">
          {/* Phone (QA-0928-181): rank · user · tokens; sessions and turns from sm up. */}
          <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-5 gap-4 px-4 text-xs text-[var(--faint)] uppercase tracking-wide">
            <span>Rank</span><span>User</span><span className="text-right">Tokens</span>
            <span className="text-right hidden sm:block">Sessions</span><span className="text-right hidden sm:block">Turns</span>
          </div>
          {entries.map((e) => (
            <div key={e.user_id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] sm:grid-cols-5 gap-4 bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 items-center">
              <span className={`font-bold ${e.rank <= 3 ? 'text-[var(--amber)]' : 'text-[var(--muted)]'}`}>#{e.rank}</span>
              <span className="text-[var(--text)] font-mono text-sm truncate min-w-0">{e.user_id.slice(0, 8)}…</span>
              <span className="text-[var(--text-strong)] font-mono text-right">{formatTokens(e.total_tokens)}</span>
              <span className="text-[var(--muted)] text-right hidden sm:block">{e.session_count}</span>
              <span className="text-[var(--muted)] text-right hidden sm:block">{e.turn_count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// The empty board (RC 0.3.2): how a user gets listed, never a promise that the
// reader's totals will appear — that needs both the opt-in path on the server
// and a CLI that sends it (QA-0928-39), and this page can't tell which it has.
export function LeaderboardEmpty({ period }) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center">
      <p className="text-[var(--muted)] mb-3">No one is on the {period} leaderboard yet.</p>
      <p className="text-[var(--faint)] text-sm">
        It lists only users who opted in with <code className="text-[var(--accent)]">wtclaude share --enable</code>, once
        a <code className="text-[var(--accent)]">wtclaude sync</code> has carried the opt-in to the cloud (wtclaude 0.3.2 or later
        sends it).
      </p>
    </div>
  );
}
