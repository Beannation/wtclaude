import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { supabase } from '../lib/supabase';
import { formatCost, formatTokens, formatDate } from '../lib/format';
import StatCard from '../components/StatCard';

export default function Overview() {
  const [daily, setDaily] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const anonymousId = localStorage.getItem('wtclaude_anonymous_id');
    if (!anonymousId) {
      setLoading(false);
      return;
    }

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('anonymous_id', anonymousId)
      .single();

    if (!user) { setLoading(false); return; }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

    const { data } = await supabase
      .from('daily_summaries')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', thirtyDaysAgo.toISOString().slice(0, 10))
      .order('date', { ascending: true });

    setDaily(data || []);
    setLoading(false);
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  const anonymousId = localStorage.getItem('wtclaude_anonymous_id');
  if (!anonymousId) {
    return (
      <div className="text-center py-20">
        <h2 className="text-2xl font-bold text-white mb-4">Welcome to WTClaude</h2>
        <p className="text-gray-400 mb-6 max-w-md mx-auto">
          To view your dashboard, link your CLI by running:
        </p>
        <code className="bg-gray-900 text-green-400 px-4 py-2 rounded-lg text-lg">
          wtclaude dashboard
        </code>
      </div>
    );
  }

  const today = daily.find(d => d.date === new Date().toISOString().slice(0, 10));
  const totalCost = daily.reduce((s, d) => s + Number(d.estimated_cost_usd || 0), 0);
  const totalTokens = daily.reduce((s, d) => s + (d.total_input_tokens + d.total_output_tokens + d.total_cache_read + d.total_cache_write), 0);
  const totalSessions = daily.reduce((s, d) => s + d.session_count, 0);

  const chartData = daily.map(d => ({
    date: formatDate(d.date),
    tokens: d.total_input_tokens + d.total_output_tokens,
    cost: Number(d.estimated_cost_usd || 0),
  }));

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">Overview</h2>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard
          label="Today's cost"
          value={formatCost(Number(today?.estimated_cost_usd || 0))}
          color="text-green-400"
        />
        <StatCard
          label="30-day cost"
          value={formatCost(totalCost)}
          color="text-green-400"
        />
        <StatCard
          label="Total tokens"
          value={formatTokens(totalTokens)}
        />
        <StatCard
          label="Sessions"
          value={totalSessions}
        />
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5 mb-8">
        <h3 className="text-sm text-gray-400 uppercase tracking-wide mb-4">Daily Cost (30 days)</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 11 }} />
            <YAxis tick={{ fill: '#666', fontSize: 11 }} tickFormatter={v => `$${v}`} />
            <Tooltip
              contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8 }}
              labelStyle={{ color: '#999' }}
              formatter={(value) => [`$${value.toFixed(2)}`, 'Cost']}
            />
            <Bar dataKey="cost" fill="#4ade80" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
        <h3 className="text-sm text-gray-400 uppercase tracking-wide mb-4">Daily Tokens (30 days)</h3>
        <ResponsiveContainer width="100%" height={250}>
          <BarChart data={chartData}>
            <XAxis dataKey="date" tick={{ fill: '#666', fontSize: 11 }} />
            <YAxis tick={{ fill: '#666', fontSize: 11 }} tickFormatter={formatTokens} />
            <Tooltip
              contentStyle={{ background: '#1a1a2e', border: '1px solid #333', borderRadius: 8 }}
              labelStyle={{ color: '#999' }}
              formatter={(value) => [formatTokens(value), 'Tokens']}
            />
            <Bar dataKey="tokens" fill="#818cf8" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
