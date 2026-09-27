import { useDashboard } from '../lib/useDashboard';
import { useApp } from '../context/AppContext';
import { formatCost, formatTokens } from '../lib/format';
import {
  computeComparison, codeTurnsFromSessions, COMPARE_MODELS, CAVEATS, COMPARE_HONESTY_LINE,
} from '../lib/compareModels';
import HonestyBadge from '../components/HonestyBadge';
import EmptyState from '../components/EmptyState';
import CopyCommand from '../components/CopyCommand';
import { LinkPrompt } from './Overview';

// ADDED 2026-09-27. Turns this dashboard cannot price at first-party rates — a
// model its rate table does not know, a partner-platform id, or a family-fallback
// guess — are excluded from both sides of the comparison (mirror of the CLI).
// Before this, the browser priced them silently: every Opus 5.5 slice went into
// "your mix" at Opus 5's rates with nothing on the page to say so. Excluding
// without saying so would be the same error in a different shape, so the tile
// names what it left out — and when EVERYTHING was left out, it says that rather
// than "no usage".
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
          ? `Usage on ${m} ${models} was excluded from this comparison — and from your mix, so the figures above don't cover all your usage.`
          : `All usage in this window was on ${models} this dashboard can't price, so there is nothing to compare yet — this is not the same as having no usage.`}
      </p>
      {m > 0 && <p className="font-mono">{ids.join(' · ')}</p>}
      <p>
        Either the model isn't in this dashboard's rate table yet, or it was served by a partner platform that
        publishes its own rates. Your headline cost is unaffected — it is the cost figure Claude Code itself
        reports.
      </p>
    </div>
  );
}

function deltaColor(usd) {
  if (usd > 0) return 'text-[var(--rose)]'; // costs more
  if (usd < 0) return 'text-[var(--accent)]'; // costs less
  return 'text-[var(--muted)]'; // ~no-op
}

function fmtDelta(usd, fc) {
  if (Math.abs(usd) < 0.005) return '≈ $0 (no-op)';
  return `${usd > 0 ? '+' : '−'}${fc(Math.abs(usd))}`;
}

export default function CompareModels() {
  const { data, loading, error, linked } = useDashboard();
  const { currency } = useApp();
  const fc = (v) => formatCost(v, currency);

  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!linked) return <LinkPrompt />;
  if (error) return <EmptyState title="Couldn't load Compare Models" body={error} />;

  const daily = data.daily_summaries || [];
  const days = daily.length || 30;
  const codeTurns = codeTurnsFromSessions(data.sessions);
  // Cowork has no per-surface breakdown in the synced payload → empty (honest
  // placeholder, never fabricated). Chat is always excluded.
  const cmp = computeComparison({ codeTurns, coworkTurns: [], days });
  const code = cmp.surfaces.code;
  const cowork = cmp.surfaces.cowork;
  const chat = cmp.surfaces.chat;

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
        and applying each model's rate. The delta is measured against your actual model mix, so
        re-pricing a model you already run nets about $0.
      </p>

      {/* Per-surface split — the honest unit. Each surface declares its own grade. */}
      <div className="space-y-4">
        {/* CODE — billing-grade */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
          <div className="flex items-center justify-between gap-3 mb-1 flex-wrap">
            <h3 className="text-[var(--text-strong)] font-semibold">Code (terminal)</h3>
            <HonestyBadge tier="billing-grade" />
          </div>
          {code.present ? (
            <>
              <p className="text-xs text-[var(--muted)] mb-4">
                {formatTokens(
                  code.tokens.input + code.tokens.output + code.tokens.cache_read + code.tokens.cache_write,
                )}{' '}
                tokens re-priced · your mix ≈{' '}
                <span className="text-[var(--text)] font-mono">{fc(code.baseline_monthly_usd)}/mo</span>
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--faint)] uppercase tracking-wide">
                      <th className="py-2 pr-4 font-medium">Model</th>
                      <th className="py-2 pr-4 font-medium text-right">Projected / mo</th>
                      <th className="py-2 font-medium text-right">Δ vs your mix</th>
                    </tr>
                  </thead>
                  <tbody>
                    {code.models.map((m) => (
                      <tr key={m.key} className="border-t border-[var(--border)]">
                        <td className="py-2.5 pr-4 text-[var(--text-strong)] font-medium">{m.label}</td>
                        <td className="py-2.5 pr-4 text-right font-mono text-[var(--text)]">{fc(m.monthly_usd)}</td>
                        <td className={`py-2.5 text-right font-mono ${deltaColor(m.monthly_delta_vs_baseline_usd)}`}>
                          {fmtDelta(m.monthly_delta_vs_baseline_usd, fc)}
                          {m.delta_pct !== 0 && Math.abs(m.monthly_delta_vs_baseline_usd) >= 0.005 && (
                            <span className="text-[var(--faint)] ml-1">({m.delta_pct > 0 ? '+' : ''}{m.delta_pct}%)</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : code.unpriced_turn_count > 0 ? null : (
            <p className="text-[var(--muted)] text-sm mt-2">
              No recorded terminal usage in this window yet.
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
            Cowork cost is a labeled estimate (audit-log tokens × rate). The synced dashboard payload
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

      {/* VERBATIM under-block honesty line */}
      <p className="text-xs text-[var(--faint)] max-w-3xl leading-relaxed">{COMPARE_HONESTY_LINE}</p>

      {/* Full caveats (mirror of CLI CAVEATS) */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
        <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide mb-3">How to read this</h3>
        <ul className="space-y-2 text-sm text-[var(--muted)] list-disc pl-5">
          {CAVEATS.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// Re-export so other surfaces can reference the compared set without re-importing lib.
export { COMPARE_MODELS };
