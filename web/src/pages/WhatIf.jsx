import { useDashboard } from '../lib/useDashboard';
import { useApp } from '../context/AppContext';
import { formatCost } from '../lib/format';
import { totals } from '../lib/derive';
import HonestyBadge from '../components/HonestyBadge';
import EmptyState from '../components/EmptyState';
import { LinkPrompt } from './Overview';
import { repriceSurface, codeTurnsFromSessions } from '../lib/compareModels';
import { ExclusionNotice } from './CompareModels';

// REPLACED 2026-09-27. This page kept its OWN price table — Haiku 4.5, Sonnet
// 4.6 and Opus 4.8, typed in during Phase 0 — outside every parity guard. By
// the time Opus 5.5 became Claude Code's default model (v2.1.280) it offered a
// "use a single model for everything" answer that omitted the model most
// sessions now run on, ignored cache writes, used one global 0.1x cache-read
// multiplier, and compared a token×rate hypothetical against the billing-grade
// anchor (the QA-0610-03 bias the CLI fixed in June). The model comparison now
// runs on the shared, parity-tested mirror (lib/compareModels.js): the same
// three models as `wtclaude compare-models`, per-model cache pricing, a
// same-method baseline, and unpriceable turns excluded and named.
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
  const days = daily.length || 1;
  const monthlyCost = (t.cost / days) * 30;
  // Same tokens, same token×rate method on both sides: the baseline is your
  // turns priced at the models you actually ran, so a no-op switch nets ~$0.
  const models = repriceSurface(codeTurnsFromSessions(data.sessions), { days: daily.length || 30 });

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
        {models.present ? (
          <div className="space-y-3">
            {models.models.map((m) => {
              const diff = m.delta_vs_baseline_usd;
              return (
                <div key={m.key} className="flex items-center justify-between bg-[var(--surface)] rounded-lg p-4">
                  <span className="text-[var(--text-strong)] font-semibold">{m.label}</span>
                  <div className="text-right">
                    <span className="text-[var(--text)] font-mono">{fc(m.monthly_usd)}/mo</span>
                    <span className={`ml-3 text-sm font-mono ${diff > 0 ? 'text-[var(--rose)]' : 'text-[var(--accent)]'}`}>
                      {diff > 0 ? '+' : ''}
                      {m.delta_pct}%
                    </span>
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-[var(--faint)]">
              % is against your own model mix, priced the same way — about{' '}
              <span className="font-mono">{fc(models.baseline_monthly_usd)}/mo</span>.
            </p>
          </div>
        ) : models.unpriced_turn_count > 0 ? null : (
          <p className="text-[var(--muted)] text-sm">No recorded terminal usage in this window yet.</p>
        )}
        <ExclusionNotice surface={models} />
      </div>

      <p className="text-xs text-[var(--faint)]">
        These are pricing-map estimates (not the bill) — useful for "should I switch plans/models" reasoning, labeled accordingly.
      </p>
    </div>
  );
}
