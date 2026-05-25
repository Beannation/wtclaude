import { useState, useEffect } from 'react';
import { fetchLeaderboard } from '../lib/supabase';
import { formatTokens, formatCost } from '../lib/format';

export default function Leaderboard() {
  const [entries, setEntries] = useState([]);
  const [period, setPeriod] = useState('weekly');
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, [period]);

  async function loadData() {
    setLoading(true);
    try {
      const result = await fetchLeaderboard(period);
      setEntries(result.leaderboard || []);
    } catch {
      setEntries([]);
    }
    setLoading(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Leaderboard</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setPeriod('weekly')}
            className={`px-3 py-1.5 rounded text-sm ${period === 'weekly' ? 'bg-gray-800 text-white' : 'text-gray-400'}`}
          >
            Weekly
          </button>
          <button
            onClick={() => setPeriod('monthly')}
            className={`px-3 py-1.5 rounded text-sm ${period === 'monthly' ? 'bg-gray-800 text-white' : 'text-gray-400'}`}
          >
            Monthly
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-gray-500">Loading...</p>
      ) : entries.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center">
          <p className="text-gray-400 mb-3">No leaderboard data yet.</p>
          <p className="text-gray-500 text-sm">
            Enable sharing with <code className="text-green-400">wtclaude share --enable</code> to appear on the leaderboard.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-5 gap-4 px-4 text-xs text-gray-500 uppercase tracking-wide">
            <span>Rank</span>
            <span>User</span>
            <span className="text-right">Tokens</span>
            <span className="text-right">Sessions</span>
            <span className="text-right">Turns</span>
          </div>
          {entries.map(e => (
            <div key={e.user_id} className="grid grid-cols-5 gap-4 bg-gray-900 border border-gray-800 rounded-lg p-4 items-center">
              <span className={`font-bold ${e.rank <= 3 ? 'text-yellow-400' : 'text-gray-400'}`}>
                #{e.rank}
              </span>
              <span className="text-gray-300 font-mono text-sm">
                {e.user_id.slice(0, 8)}...
              </span>
              <span className="text-white font-mono text-right">{formatTokens(e.total_tokens)}</span>
              <span className="text-gray-400 text-right">{e.session_count}</span>
              <span className="text-gray-400 text-right">{e.turn_count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
