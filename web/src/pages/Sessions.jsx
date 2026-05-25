import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { supabase } from '../lib/supabase';
import { formatCost, formatTokens } from '../lib/format';

const MODEL_COLORS = {
  'sonnet-4-6': '#818cf8',
  'claude-sonnet-4-6-20250514': '#818cf8',
  'opus-4-7': '#f472b6',
  'claude-opus-4-7-20250514': '#f472b6',
  'haiku-4-5': '#34d399',
  'claude-haiku-4-5-20251001': '#34d399',
};

function getModelColor(model) {
  return MODEL_COLORS[model] || '#6b7280';
}

export default function Sessions() {
  const [sessions, setSessions] = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);
  const [turns, setTurns] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadSessions(); }, []);

  async function loadSessions() {
    const anonymousId = localStorage.getItem('wtclaude_anonymous_id');
    if (!anonymousId) { setLoading(false); return; }

    const { data: user } = await supabase
      .from('users').select('id').eq('anonymous_id', anonymousId).single();
    if (!user) { setLoading(false); return; }

    const { data } = await supabase
      .from('sessions')
      .select('*')
      .eq('user_id', user.id)
      .order('started_at', { ascending: false })
      .limit(50);

    setSessions(data || []);
    setLoading(false);
  }

  async function loadTurns(session) {
    setSelectedSession(session);
    const { data } = await supabase
      .from('turns')
      .select('*')
      .eq('session_id', session.id)
      .order('turn_number', { ascending: true });
    setTurns(data || []);
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  if (selectedSession) {
    const chartData = turns.map(t => ({
      turn: `#${t.turn_number}`,
      input: t.input_tokens,
      output: t.output_tokens,
      model: t.model,
      cacheRead: t.cache_read_tokens,
    }));

    return (
      <div>
        <button
          onClick={() => setSelectedSession(null)}
          className="text-gray-400 hover:text-white mb-4 text-sm"
        >
          &larr; Back to sessions
        </button>

        <h2 className="text-xl font-bold text-white mb-2">
          Session {selectedSession.session_id.slice(0, 8)}...
        </h2>
        <p className="text-gray-500 text-sm mb-6">
          {new Date(selectedSession.started_at).toLocaleString()} &middot;{' '}
          {selectedSession.turn_count} turns &middot;{' '}
          {formatCost(Number(selectedSession.estimated_cost_usd))}
        </p>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-6">
          <h3 className="text-sm text-gray-400 uppercase tracking-wide mb-4">Tokens per Turn</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData}>
              <XAxis dataKey="turn" tick={{ fill: '#666', fontSize: 11 }} />
              <YAxis tick={{ fill: '#666', fontSize: 11 }} tickFormatter={formatTokens} />
              <Tooltip
                contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8 }}
                labelStyle={{ color: '#999' }}
                formatter={(value, name) => [formatTokens(value), name]}
              />
              <Bar dataKey="input" stackId="a" fill="#818cf8" />
              <Bar dataKey="output" stackId="a" fill="#4ade80" />
              <Bar dataKey="cacheRead" stackId="a" fill="#333" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-2">
          {turns.map(t => (
            <div key={t.id} className="bg-gray-900 border border-gray-800 rounded-lg p-3 flex items-center justify-between text-sm">
              <div className="flex items-center gap-3">
                <span className="text-gray-500 w-8">#{t.turn_number}</span>
                <span className="px-2 py-0.5 rounded text-xs" style={{ background: getModelColor(t.model) + '30', color: getModelColor(t.model) }}>
                  {t.model}
                </span>
              </div>
              <div className="flex gap-6 text-gray-400">
                <span>In: {formatTokens(t.input_tokens)}</span>
                <span>Out: {formatTokens(t.output_tokens)}</span>
                <span>Cache: {formatTokens(t.cache_read_tokens)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Sessions</h2>

      {sessions.length === 0 ? (
        <p className="text-gray-500">No sessions synced yet. Run <code className="text-green-400">wtclaude sync</code> after using Claude Code.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map(s => (
            <button
              key={s.id}
              onClick={() => loadTurns(s)}
              className="w-full bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between hover:border-gray-700 transition-colors text-left"
            >
              <div>
                <p className="text-white font-mono text-sm">{s.session_id.slice(0, 12)}...</p>
                <p className="text-gray-500 text-xs mt-1">
                  {new Date(s.started_at).toLocaleString()} &middot; {s.turn_count} turns
                </p>
              </div>
              <div className="text-right">
                <p className="text-green-400 font-mono font-bold">{formatCost(Number(s.estimated_cost_usd))}</p>
                <p className="text-gray-500 text-xs mt-1">
                  {formatTokens(s.total_input_tokens + s.total_output_tokens)} tokens
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
