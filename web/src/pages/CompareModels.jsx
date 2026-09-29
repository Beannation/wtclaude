import { useDashboard } from '../lib/useDashboard';
import { useApp } from '../context/AppContext';
import { formatCost, formatTokens } from '../lib/format';
import { costBasis, coveredDays, dailyView } from '../lib/derive';
import {
  computeComparison, codeTurnsFromSessions, COMPARE_MODELS, CAVEATS, COMPARE_HONESTY_LINE,
  windowDays, billedFromPayload, billedLabel, deltaTone, fmtPct, loadErrorView,
} from '../lib/compareModels';
import HonestyBadge from '../components/HonestyBadge';
import EmptyState from '../components/EmptyState';
import CopyCommand from '../components/CopyCommand';
import InlineCode from '../components/InlineCode';
import { LinkPrompt } from './Overview';

// ADDED 2026-09-27. Turns this dashboard cannot price at first-party rates — a
// model its rate table does not know, a partner-platform id, or a family-fallback
// guess — are excluded from both sides of the comparison (mirror of the CLI).
// Before this, the browser priced them silently: every Opus 5.5 slice went into
// "your mix" at Opus 5's rates with nothing on the page to say so. Excluding
// without saying so would be the same error in a different shape, so the tile
// names what it left out — and when EVERYTHING was left out, it says that rather
// than "no usage". The headline counts such a turn only when Claude Code
// reported its cost (mirror of the CLI's exclusion notice, ledger reviewer
// 2026-09-28); the synced session totals can't say which turns those were, so
// the notice states the rule rather than a count.
export function ExclusionNotice({ surface }) {
  const n = surface.unpriced_turn_count || 0;
  if (n === 0) return null;
  const ids = surface.unpriced_models || [];
  const m = ids.length;
  const models = `model${m === 1 ? '' : 's'}`;
  return (
    <div className="mt-4 rounded-lg border border-[var(--amber)] px-4 py-3 text-xs text-[var(--muted)] space-y-1">
      <p className="text-[var(--amber)] font-medium">
        {surface.present
          ? `${m > 0 ? `Usage on ${m} ${models} was` : 'Some usage was'} excluded from this comparison — and from your mix, so the figures above don't cover all your usage.`
          : `All usage in this window was on ${m === 1 ? 'a model' : 'models'} this dashboard can't price, so there is nothing to compare yet — this is not the same as having no usage.`}
      </p>
      {m > 0 && <p className="font-mono">{ids.join(' · ')}</p>}
      <p>
        Either the model isn't in this dashboard's rate table yet, or it was served by a partner platform that
        publishes its own rates. Your headline cost still counts such a turn when Claude Code reported its cost;
        a turn it sent no cost for is left out of the headline too.
      </p>
    </div>
  );
}

// Colour of a % difference. 0% is neutral — never the saving colour
// (QA-0928-183); the tone comes from the shared lib so /whatif agrees.
const TONE_CLASS = {
  more: 'text-[var(--rose)]', // costs more
  less: 'text-[var(--accent)]', // costs less
  same: 'text-[var(--muted)]', // no change
};

// BUILD-018 (decision 4, QA-0928-21/105): the Code card re-prices recorded
// tokens that are context occupancy, not billed tokens, so it shows each
// model's % difference against your mix re-priced — never re-priced dollars —
// beside the real billed total for the window. The BILLING-GRADE badge that sat
// over the re-priced figures now sits on the billed total only. Without
// contract-B daily_local the days are UTC, and the label says so.
export function BilledTotal({ billed, days, fc }) {
  const tier = costBasis({ cost: billed.usd, anchored: billed.anchored_usd }).tier;
  return (
    <p className="text-sm text-[var(--muted)] mb-3 flex items-center gap-2 flex-wrap">
      {billedLabel(billed, days)}:
      <span className="text-[var(--text-strong)] font-mono">{fc(billed.usd)}</span>
      <HonestyBadge tier={tier} />
    </p>
  );
}

export default function CompareModels() {
  const { data, loading, error, errorInfo, linked } = useDashboard();
  const { currency } = useApp();

  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!linked) return <LinkPrompt />;
  if (error) {
    // errorInfo, never the error text (see loadErrorView).
    const e = loadErrorView(errorInfo, "Couldn't load Compare Models");
    return <EmptyState title={e.title} body={e.body} command={e.command} details={e.details} />;
  }
  return <CompareModelsView data={data} currency={currency} />;
}

// Everything the page computes from a loaded payload, and all it renders from.
// Pure, so CompareModels.test.js pins what the comparison carries: this page
// withholds its dollar figures, so no rendered text shows the /mo basis.
// `now` is for tests (default: the current time).
// eslint-disable-next-line react-refresh/only-export-components
export function comparisonFor(data, now) {
  const days = windowDays(data);
  const billed = billedFromPayload(data);
  // In-window tokens where the server sends them (codeTurnsFromSessions).
  const codeTurns = codeTurnsFromSessions(data.sessions);
  // Cowork has no per-surface breakdown in the synced payload → empty (honest
  // placeholder, never fabricated). Chat is always excluded.
  // The /mo basis is the Overview's and /whatif's (derive.coveredDays, RC 0.3.2):
  // never the whole window for data that starts inside it.
  const cmp = computeComparison({
    codeTurns, coworkTurns: [], days,
    coveredDays: { code: coveredDays(dailyView(data, now)).days },
    billed,
  });
  return { days, billed, cmp };
}

// The page for a loaded payload. `now` is for tests (default: the current time).
export function CompareModelsView({ data, currency, now }) {
  const fc = (v) => formatCost(v, currency);
  const { days, billed, cmp } = comparisonFor(data, now);
  const code = cmp.surfaces.code;
  const chat = cmp.surfaces.chat;
  const windowLabel = `the last ${days} day${days === 1 ? '' : 's'}`;

  // QA-0928-93: a window with nothing synced says so, naming the window.
  if (!code.present && code.unpriced_turn_count === 0 && billed.usd === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <h2 className="text-2xl font-bold text-[var(--text-strong)]">Compare Models</h2>
          <HonestyBadge tier="estimate" />
        </div>
        <EmptyState
          title={`No synced usage in ${windowLabel}`}
          body="Nothing to re-price yet. Sync from the CLI on the machine you linked, then reload:"
          command="wtclaude sync"
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-2xl font-bold text-[var(--text-strong)]">Compare Models</h2>
        <HonestyBadge tier="estimate" />
      </div>
      {/* FIXED 2026-09-07: these three names were hard-coded and read "Opus 4.8 /
          Sonnet 5 / Fable 5" — stale since the 0.3.0 Opus 5 swap, so the live
          dashboard named a model it does not price. Derived from COMPARE_MODELS
          now, exactly as the CLI header is, so the label cannot drift from the
          set being compared. */}
      <p className="text-[var(--muted)] max-w-3xl">
        Re-prices your recorded usage across{' '}
        {COMPARE_MODELS.map((m, i) => (
          <span key={m.key}>
            <span className="text-[var(--text-strong)]">{m.label}</span>
            {i < COMPARE_MODELS.length - 2 ? ', ' : i === COMPARE_MODELS.length - 2 ? ' and ' : ''}
          </span>
        ))}
        {' '}— holding your token counts fixed
        and applying each model's rate. Each difference is measured against your mix, re-priced the same way,
        so re-pricing a model you already run nets about 0%.
      </p>

      {/* Per-surface split — the honest unit. Each surface declares its own grade. */}
      <div className="space-y-4">
        {/* CODE — % differences beside the billed total (decision 4) */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
          <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
            <h3 className="text-[var(--text-strong)] font-semibold">Code (terminal)</h3>
            <HonestyBadge tier="estimate" label="re-priced estimate" />
          </div>
          <BilledTotal billed={billed} days={days} fc={fc} />
          {code.present ? (
            <>
              <p className="text-xs text-[var(--muted)] mb-4">
                {formatTokens(
                  code.tokens.input + code.tokens.output + code.tokens.cache_read + code.tokens.cache_write,
                )}{' '}
                recorded tokens (from the Claude Code status line) re-priced at each model's list rate
                (token × rate) and compared with your mix, re-priced the same way.
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--muted)] uppercase tracking-wide">
                      <th className="py-2 pr-4 font-medium">Model</th>
                      <th className="py-2 font-medium text-right">vs your mix, re-priced</th>
                    </tr>
                  </thead>
                  <tbody>
                    {code.models.map((m) => (
                      <tr key={m.key} className="border-t border-[var(--border)]">
                        <td className="py-2.5 pr-4 text-[var(--text-strong)] font-medium">{m.label}</td>
                        <td className={`py-2.5 text-right font-mono ${TONE_CLASS[deltaTone(m.delta_pct)]}`}>
                          {fmtPct(m.delta_pct)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-[var(--muted)] mt-3">{code.withheld_reason}</p>
            </>
          ) : code.unpriced_turn_count > 0 ? null : (
            <p className="text-[var(--muted)] text-sm mt-2">
              No recorded terminal usage in {windowLabel}.
            </p>
          )}
          <ExclusionNotice surface={code} />
        </div>

        {/* COWORK — labeled estimate, honest placeholder (no synced per-surface data) */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
          <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
            <h3 className="text-[var(--text-strong)] font-semibold">Cowork</h3>
            <HonestyBadge tier="estimate" />
          </div>
          <p className="text-[var(--muted)] text-sm mt-1">
            Cowork cost is a labeled estimate (tokens from Cowork's local logs × rate). The synced dashboard payload
            doesn't carry a per-surface Cowork breakdown, so there's nothing to re-price here yet —
            we won't fabricate a number. Run the CLI to fold your Cowork surface into the comparison:
          </p>
          <div className="mt-3 max-w-sm">
            <CopyCommand command="wtclaude compare-models" />
          </div>
        </div>

        {/* CHAT — excluded */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
          <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
            <h3 className="text-[var(--text-strong)] font-semibold">Chat</h3>
            <span className="inline-flex items-center rounded-full border border-[var(--faint)] border-dashed px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted)]">
              excluded
            </span>
          </div>
          <p className="text-[var(--muted)] text-sm mt-1">{chat.reason}.</p>
        </div>
      </div>

      {/* VERBATIM under-block honesty line. --muted, not --faint: honesty fine
          print must be readable (QA-0928-186; --faint measured under 3:1). */}
      <p className="text-xs text-[var(--muted)] max-w-3xl leading-relaxed">{COMPARE_HONESTY_LINE}</p>

      {/* Full caveats (mirror of CLI CAVEATS) */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide mb-3">How to read this</h3>
        <ul className="space-y-2 text-sm text-[var(--muted)] list-disc pl-5">
          {CAVEATS.map((c, i) => (
            <li key={i}>
              <InlineCode text={c} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Re-export so other surfaces can reference the compared set without re-importing lib.
export { COMPARE_MODELS };
