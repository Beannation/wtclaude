import { useDashboard } from '../lib/useDashboard';
import { useApp } from '../context/AppContext';
import { formatCost } from '../lib/format';
import { totals } from '../lib/derive';
import HonestyBadge from '../components/HonestyBadge';
import EmptyState from '../components/EmptyState';
import { LinkPrompt } from './Overview';

// Standard-rate pricing (USD/M tokens). Opus 4.8/4.7 bill 1M context at standard
// $5/$25 (no long-context premium), per the live-capture finding.
const PRICING = {
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-opus-4-8': { input: 5.0, output: 25.0 },
};

const PLANS = [
  { key: 'pro', label: 'Pro', price: 20 },
  { key: 'max5', label: 'Max 5x', price: 100 },
  { key: 'max20', label: 'Max 20x', price: 200 },
];

export default function WhatIf() {
  const { data, loading, error, linked } = useDashboard();
  const { currency } = useApp();
  const fc = (v) => formatCost(v, currency);

  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!linked) return <LinkPrompt />;
  if (error) return <EmptyState title="Couldn't load What-If" body={error} />;

  const daily = data.daily_summaries;
  const t = totals(daily);
  const totalInput = daily.reduce((s, d) => s + Number(d.total_input_tokens || 0), 0);
  const totalOutput = daily.reduce((s, d) => s + Number(d.total_output_tokens || 0), 0);
  const totalCacheRead = daily.reduce((s, d) => s + Number(d.total_cache_read || 0), 0);
  const days = daily.length || 1;
  const monthlyCost = (t.cost / days) * 30;

  const modelCost = (model) => {
    const p = PRICING[model];
    return (totalInput / 1e6) * p.input + (totalOutput / 1e6) * p.output + (totalCacheRead / 1e6) * p.input * 0.1;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h2 className="text-2xl font-bold text-[var(--text-strong)]">What If</h2>
        <HonestyBadge tier="estimate" />
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide mb-4">Plan comparison (30-day estimate)</h3>
        <p className="text-[var(--muted)] mb-4">
          Your estimated API-equivalent cost: <span className="text-[var(--accent)] font-mono font-bold">{fc(monthlyCost)}/mo</span>
        </p>
        <div className="space-y-3">
          {PLANS.map((plan) => {
            const diff = monthlyCost - plan.price;
            return (
              <div key={plan.key} className="flex items-center justify-between bg-[var(--surface)] rounded-lg p-4">
                <div><span className="text-[var(--text-strong)] font-semibold">{plan.label}</span><span className="text-[var(--faint)] ml-2">${plan.price}/mo</span></div>
                <span className={`font-mono ${diff > 0 ? 'text-[var(--accent)]' : 'text-[var(--rose)]'}`}>
                  {diff > 0 ? `Saving ${fc(diff)} vs API` : `${fc(Math.abs(diff))} more than API`}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide mb-4">Model comparison</h3>
        <p className="text-[var(--muted)] mb-4">What if you used a single model for everything?</p>
        <div className="space-y-3">
          {Object.keys(PRICING).map((model) => {
            const cost = modelCost(model);
            const diff = cost - t.cost;
            const pct = t.cost > 0 ? ((diff / t.cost) * 100).toFixed(0) : 0;
            return (
              <div key={model} className="flex items-center justify-between bg-[var(--surface)] rounded-lg p-4">
                <span className="text-[var(--text-strong)] font-semibold">{model}</span>
                <div className="text-right">
                  <span className="text-[var(--text)] font-mono">{fc(cost)}</span>
                  <span className={`ml-3 text-sm font-mono ${diff > 0 ? 'text-[var(--rose)]' : 'text-[var(--accent)]'}`}>{diff > 0 ? '+' : ''}{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-[var(--faint)]">
        These are pricing-map estimates (not the bill) — useful for "should I switch plans/models" reasoning, labeled accordingly.
      </p>
    </div>
  );
}
