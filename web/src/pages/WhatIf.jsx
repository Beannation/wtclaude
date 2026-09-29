import { useDashboard } from '../lib/useDashboard';
import { useApp } from '../context/AppContext';
import { formatCost } from '../lib/format';
import { dailyView, monthlyProjectionBasis } from '../lib/derive';
import HonestyBadge from '../components/HonestyBadge';
import EmptyState from '../components/EmptyState';
import { LinkPrompt } from './Overview';
import {
  repriceSurface, codeTurnsFromSessions, CAVEATS, COMPARE_HONESTY_LINE, USD_WITHHELD_REASON, PLANS,
  windowDays, billedFromPayload, deltaTone, fmtPct, loadErrorView,
} from '../lib/compareModels';
import { ExclusionNotice, BilledTotal } from './CompareModels';
import InlineCode from '../components/InlineCode';

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
//
// REWORKED 2026-09-28 (BUILD-018), mirroring `wtclaude whatif`:
//  • Plans come from the parity-pinned PLANS mirror of the rate sheet — all
//    five, Team per seat, prices in the display currency (QA-0928-183/184).
//  • The monthly figure scales by the days the data covers, never by the days
//    with usage (QA-0928-26), and says which; plans are compared with API list
//    rates and plan limits are not modelled (QA-0928-80's wording).
//    RC 0.3.2 (dash-prod): the basis is the Overview's (derive.
//    monthlyProjectionBasis): the requested window, or the days since tracking
//    began when meta.first_activity_at puts that inside it (the CLI rule). A
//    server that doesn't send it gets the first synced day in the window,
//    flagged — it used to get the whole window ("earlier days count as idle"),
//    several times below `wtclaude whatif --days 365` for anyone tracked for
//    under a year.
//  • Model rows are % only beside the billed total (decision 4, QA-0928-107):
//    the your-mix $/mo figure sat about 7x below the billed $/mo above it
//    because the recorded tokens are context occupancy.
//  • An empty window names itself and shows no plan verdicts on $0 (QA-0928-93),
//    and the compare honesty line is carried verbatim (QA-0928-185).
const FABLE_CAVEAT = CAVEATS.find((c) => c.startsWith('Fable’s row'));

const TONE_CLASS = {
  more: 'text-[var(--rose)]',
  less: 'text-[var(--accent)]',
  same: 'text-[var(--muted)]',
};

export default function WhatIf() {
  const { data, loading, error, errorInfo, linked } = useDashboard();
  const { currency } = useApp();

  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!linked) return <LinkPrompt />;
  if (error) {
    // errorInfo, never the error text (see loadErrorView).
    const e = loadErrorView(errorInfo, "Couldn't load What-If");
    return <EmptyState title={e.title} body={e.body} command={e.command} details={e.details} />;
  }
  return <WhatIfView data={data} currency={currency} />;
}

// The page for a loaded payload. `now` is for tests (default: the current time).
export function WhatIfView({ data, currency, now }) {
  const fc = (v) => formatCost(v, currency);
  const days = windowDays(data);
  const billed = billedFromPayload(data);
  const basis = monthlyProjectionBasis(dailyView(data, now));
  const covered = basis ? basis.covered : null;
  // Same tokens, same token×rate method on both sides: the baseline is your
  // turns priced at the models you actually ran, so a no-op switch nets ~0%.
  const models = repriceSurface(codeTurnsFromSessions(data.sessions), { days: covered ?? days });
  const windowLabel = `the last ${days} day${days === 1 ? '' : 's'}`;

  const header = (
    <div className="flex items-center gap-3">
      <h2 className="text-2xl font-bold text-[var(--text-strong)]">What If</h2>
      <HonestyBadge tier="estimate" />
    </div>
  );

  if (covered == null && !models.present && models.unpriced_turn_count === 0) {
    return (
      <div className="space-y-6">
        {header}
        <EmptyState
          title={`No synced usage in ${windowLabel}`}
          body="There is nothing to project or compare yet. Sync from the CLI on the machine you linked, then reload:"
          command="wtclaude sync"
        />
      </div>
    );
  }

  const monthlyCost = covered ? (billed.usd / covered) * 30 : 0;
  const perSeat = PLANS.some((p) => p.per_seat);

  return (
    <div className="space-y-6">
      {header}

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide mb-4">Plan comparison</h3>
        <BilledTotal billed={billed} days={days} fc={fc} />
        {/* No billed days to project from: no plan verdicts on $0 (QA-0928-93). */}
        {!basis ? (
          <p className="text-[var(--muted)] text-sm">No billed days in {windowLabel} to project from.</p>
        ) : (
          <>
            <p className="text-[var(--muted)] mb-1">
              Projected to a month: <span className="text-[var(--accent)] font-mono font-bold">{fc(monthlyCost)}/mo</span>
            </p>
            <p className="text-xs text-[var(--muted)] mb-4">
              {basis.note}. Plans are compared with API list rates. Plan usage limits aren't modelled — a plan may not carry this
              workload.
            </p>
            <div className="space-y-3">
              {PLANS.map((plan) => {
                const diff = monthlyCost - plan.price;
                return (
                  <div key={plan.key} className="flex items-center justify-between gap-3 flex-wrap bg-[var(--surface)] rounded-lg p-4">
                    <div>
                      <span className="text-[var(--text-strong)] font-semibold">{plan.label}</span>
                      <span className="text-[var(--muted)] ml-2">{fc(plan.price)}/mo{plan.per_seat ? '/seat' : ''}</span>
                    </div>
                    <span className={`font-mono ${diff >= 0 ? 'text-[var(--accent)]' : 'text-[var(--rose)]'}`}>
                      {diff >= 0 ? `${fc(diff)} less than API list rates` : `${fc(-diff)} more than API list rates`}
                    </span>
                  </div>
                );
              })}
            </div>
            {perSeat && (
              <p className="text-xs text-[var(--muted)] mt-3">Team prices are per seat; the spend above is yours alone.</p>
            )}
          </>
        )}
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide mb-4">Model comparison</h3>
        <p className="text-[var(--muted)] mb-4">What if you used a single model for everything?</p>
        {models.present ? (
          <div className="space-y-3">
            {models.models.map((m) => (
              <div key={m.key} className="flex items-center justify-between bg-[var(--surface)] rounded-lg p-4">
                <span className="text-[var(--text-strong)] font-semibold">{m.label}</span>
                <span className={`text-sm font-mono ${TONE_CLASS[deltaTone(m.delta_pct)]}`}>
                  {fmtPct(m.delta_pct)} vs your mix, re-priced
                </span>
              </div>
            ))}
            <p className="text-xs text-[var(--muted)]">
              % is against your own model mix, re-priced the same way (token × rate on your recorded tokens).{' '}
              {USD_WITHHELD_REASON}
            </p>
            {/* VERBATIM compare honesty line, as on Compare Models (QA-0928-185). */}
            <p className="text-xs text-[var(--muted)]">{COMPARE_HONESTY_LINE}</p>
            {/* The Fable row is a list-rate re-price, and Fable is plan-conditional:
                the same caveat Compare Models and the CLI carry (added 2026-09-27,
                when this card started showing a Fable row). Found by prefix so it
                survives any reordering of CAVEATS. */}
            {FABLE_CAVEAT && (
              <p className="text-xs text-[var(--muted)]">
                <InlineCode text={FABLE_CAVEAT} />
              </p>
            )}
          </div>
        ) : models.unpriced_turn_count > 0 ? null : (
          <p className="text-[var(--muted)] text-sm">No recorded terminal usage in {windowLabel}.</p>
        )}
        <ExclusionNotice surface={models} />
      </div>

      <p className="text-xs text-[var(--muted)]">
        Projections and re-priced percentages are estimates, not the bill — useful for "should I switch plans/models"
        reasoning, labeled accordingly.
      </p>
    </div>
  );
}
