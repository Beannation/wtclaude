import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { formatCost } from '../lib/format';

const PRICING = {
  'haiku-4-5': { input: 1.00, output: 5.00 },
  'sonnet-4-6': { input: 3.00, output: 15.00 },
  'opus-4-7': { input: 5.00, output: 25.00 },
};

const PLANS = [
  { key: 'pro', label: 'Pro', price: 20 },
  { key: 'max5', label: 'Max 5x', price: 100 },
  { key: 'max20', label: 'Max 20x', price: 200 },
];

export default function WhatIf() {
  const [summaries, setSummaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedModel, setSelectedModel] = useState('sonnet-4-6');

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const anonymousId = localStorage.getItem('wtclaude_anonymous_id');
    if (!anonymousId) { setLoading(false); return; }

    const { data: user } = await supabase
      .from('users').select('id').eq('anonymous_id', anonymousId).single();
    if (!user) { setLoading(false); return; }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29);

    const { data } = await supabase
      .from('daily_summaries')
      .select('*')
      .eq('user_id', user.id)
      .gte('date', thirtyDaysAgo.toISOString().slice(0, 10));

    setSummaries(data || []);
    setLoading(false);
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  const totalInput = summaries.reduce((s, d) => s + d.total_input_tokens, 0);
  const totalOutput = summaries.reduce((s, d) => s + d.total_output_tokens, 0);
  const totalCacheRead = summaries.reduce((s, d) => s + d.total_cache_read, 0);
  const days = summaries.length || 1;

  const actualCost = summaries.reduce((s, d) => s + Number(d.estimated_cost_usd || 0), 0);
  const monthlyCost = (actualCost / days) * 30;

  function modelCost(model) {
    const p = PRICING[model];
    const cacheReadMult = 0.10;
    const cacheWriteMult = 0.25;
    return (totalInput / 1_000_000) * p.input +
           (totalOutput / 1_000_000) * p.output +
           (totalCacheRead / 1_000_000) * p.input * cacheReadMult;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-6">What If Calculator</h2>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 mb-6">
        <h3 className="text-sm text-gray-400 uppercase tracking-wide mb-4">Plan Comparison (30-day estimate)</h3>
        <p className="text-gray-400 mb-4">
          Your estimated API cost: <span className="text-green-400 font-mono font-bold">{formatCost(monthlyCost)}/mo</span>
        </p>

        <div className="space-y-3">
          {PLANS.map(plan => {
            const diff = monthlyCost - plan.price;
            return (
              <div key={plan.key} className="flex items-center justify-between bg-[#0a0a14] rounded-lg p-4">
                <div>
                  <span className="text-white font-semibold">{plan.label}</span>
                  <span className="text-gray-500 ml-2">${plan.price}/mo</span>
                </div>
                <span className={diff > 0 ? 'text-green-400 font-mono' : 'text-red-400 font-mono'}>
                  {diff > 0 ? `Saving ${formatCost(diff)}` : `${formatCost(Math.abs(diff))} more than API`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
        <h3 className="text-sm text-gray-400 uppercase tracking-wide mb-4">Model Comparison</h3>
        <p className="text-gray-400 mb-4">What if you used a single model for everything?</p>

        <div className="space-y-3">
          {Object.entries(PRICING).map(([model, p]) => {
            const cost = modelCost(model);
            const diff = cost - actualCost;
            const pct = actualCost > 0 ? ((diff / actualCost) * 100).toFixed(0) : 0;
            return (
              <div key={model} className="flex items-center justify-between bg-[#0a0a14] rounded-lg p-4">
                <span className="text-white font-semibold">{model}</span>
                <div className="text-right">
                  <span className="text-white font-mono">{formatCost(cost)}</span>
                  <span className={`ml-3 text-sm font-mono ${diff > 0 ? 'text-red-400' : 'text-green-400'}`}>
                    {diff > 0 ? '+' : ''}{pct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
