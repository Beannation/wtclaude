import { useState, useEffect } from 'react';
import { fetchLeaderboard } from '../lib/api';
import { formatTokens } from '../lib/format';

export default function Leaderboard() {
  const [entries, setEntries] = useState([]);
  const [period, setPeriod] = useState('weekly');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchLeaderboard(period)
      .then((r) => { if (alive) setEntries(r.leaderboard || []); })
      .catch(() => { if (alive) setEntries([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [period]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-[var(--text-strong)]">Leaderboard</h2>
        <div className="flex gap-2">
          {['weekly', 'monthly'].map((p) => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded text-sm capitalize ${period === p ? 'bg-[var(--card-hover)] text-[var(--text-strong)]' : 'text-[var(--muted)]'}`}>
              {p}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-[var(--muted)]">Loading…</p>
      ) : entries.length === 0 ? (
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-8 text-center">
          <p className="text-[var(--muted)] mb-3">No leaderboard data yet.</p>
          <p className="text-[var(--faint)] text-sm">Enable sharing with <code className="text-[var(--accent)]">wtclaude share --enable</code> to appear on the leaderboard.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-5 gap-4 px-4 text-xs text-[var(--faint)] uppercase tracking-wide">
            <span>Rank</span><span>User</span><span className="text-right">Tokens</span><span className="text-right">Sessions</span><span className="text-right">Turns</span>
          </div>
          {entries.map((e) => (
            <div key={e.user_id} className="grid grid-cols-5 gap-4 bg-[var(--card)] border border-[var(--border)] rounded-lg p-4 items-center">
              <span className={`font-bold ${e.rank <= 3 ? 'text-[var(--amber)]' : 'text-[var(--muted)]'}`}>#{e.rank}</span>
              <span className="text-[var(--text)] font-mono text-sm">{e.user_id.slice(0, 8)}…</span>
              <span className="text-[var(--text-strong)] font-mono text-right">{formatTokens(e.total_tokens)}</span>
              <span className="text-[var(--muted)] text-right">{e.session_count}</span>
              <span className="text-[var(--muted)] text-right">{e.turn_count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
