import { useDashboard } from '../lib/useDashboard';
import { useApp } from '../context/AppContext';
import { formatCost, formatTokens } from '../lib/format';
import { wasteFromDashboard, WASTE_MECHANISMS } from '../lib/contextWaste';
import HonestyBadge from '../components/HonestyBadge';
import EmptyState from '../components/EmptyState';
import { LinkPrompt } from './Overview';

// The three ways dead weight costs you — always shown, so the mechanism is
// explicit whether or not there's a local inventory to score.
function Mechanisms() {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
      <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide mb-4">The real mechanism</h3>
      <div className="grid md:grid-cols-3 gap-4">
        {WASTE_MECHANISMS.map((m) => (
          <div key={m.title} className="bg-[var(--surface)] rounded-lg p-4">
            <p className="text-[var(--text-strong)] font-semibold text-sm mb-1">{m.title}</p>
            <p className="text-[var(--muted)] text-xs leading-relaxed">{m.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ContextWaste() {
  const { data, loading, error, linked } = useDashboard();
  const { currency } = useApp();
  const fc = (v) => formatCost(v, currency);

  if (loading) return <p className="text-[var(--muted)]">Loading…</p>;
  if (!linked) return <LinkPrompt />;
  if (error) return <EmptyState title="Couldn't load Context Waste" body={error} />;

  // The browser can't scan ~/.claude, so this is null unless a fixture carries a
  // context_inventory. When null we render the honest explanatory state.
  const waste = wasteFromDashboard(data);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 flex-wrap">
        <h2 className="text-2xl font-bold text-[var(--text-strong)]">Context Waste</h2>
        <HonestyBadge tier="estimate" />
      </div>
      <p className="text-[var(--muted)] max-w-3xl">
        Always-loaded skills, MCP tools and memory files that you never invoke still get re-read on
        every turn after the first, billed at your model's cache-read rate — a fraction of its input
        rate, shown below for the model you actually ran. This tile
        surfaces what that dead weight costs — and flags each item for{' '}
        <span className="text-[var(--text-strong)]">review</span>, never removal.
      </p>

      {waste && waste.loaded_count > 0 ? (
        <>
          {/* Headline: N loaded, M used, ~$W/mo re-reading the rest */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Always loaded</p>
                <p className="text-2xl font-bold font-mono text-[var(--text-strong)]">{waste.loaded_count}</p>
              </div>
              <div>
                <p className="text-xs text-[var(--muted)] uppercase tracking-wide mb-1">Used in {waste.days}d</p>
                <p className="text-2xl font-bold font-mono text-[var(--accent)]">{waste.used_count}</p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <p className="text-xs text-[var(--muted)] uppercase tracking-wide">Dead tokens</p>
                  <HonestyBadge tier="estimate" />
                </div>
                <p className="text-2xl font-bold font-mono text-[var(--amber)]">{formatTokens(waste.dead_tokens)}</p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <p className="text-xs text-[var(--muted)] uppercase tracking-wide">Re-reading / mo</p>
                  <HonestyBadge tier="estimate" />
                </div>
                <p className="text-2xl font-bold font-mono text-[var(--amber)]">
                  {waste.monthly_usd === null ? '—' : fc(waste.monthly_usd)}
                </p>
              </div>
            </div>
            {waste.monthly_usd === null ? (
              // FIXED 2026-09-27: a model this table does not know used to be
              // priced at Sonnet 5's $2 default and the rate labelled
              // billing-grade. A guessed rate never produces a figure shown as ours.
              <p className="text-xs text-[var(--faint)] mt-4">
                {waste.loaded_count} always-loaded items, {waste.used_count} used. No dollar figure is shown:{' '}
                {waste.model_id ? (
                  <span className="font-mono text-[var(--muted)]">{waste.model_id}</span>
                ) : (
                  'your model'
                )}{' '}
                has no rate in this dashboard's table that we can stand behind. Token sizes and turns are still shown.
              </p>
            ) : (
              <p className="text-xs text-[var(--faint)] mt-4">
                {waste.loaded_count} always-loaded items, {waste.used_count} used — about{' '}
                <span className="font-mono text-[var(--muted)]">{fc(waste.monthly_usd)}/mo</span> re-reading the rest at
                cache-read rates ({waste.turns} turns × {+(waste.cache_read_multiplier * 100).toFixed(1)}% of the{' '}
                {`$${waste.input_rate}/MTok`} input rate). Token size is an estimate; turns, rate and multiplier are
                billing-grade.
              </p>
            )}
          </div>

          <Mechanisms />

          {/* Per-item review table — verdicts are KEEP / REVIEW only */}
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-6">
            <h3 className="text-sm text-[var(--muted)] uppercase tracking-wide mb-4">Loaded items</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--faint)] uppercase tracking-wide">
                    <th className="py-2 pr-4 font-medium">Item</th>
                    <th className="py-2 pr-4 font-medium">Type</th>
                    <th className="py-2 pr-4 font-medium text-right">Tokens</th>
                    <th className="py-2 font-medium">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {waste.items.map((it) => (
                    <tr key={it.id} className="border-t border-[var(--border)] align-top">
                      <td className="py-2.5 pr-4">
                        <span className="text-[var(--text-strong)] font-medium">{it.name}</span>
                        <span className="block text-xs text-[var(--faint)]">{it.why}</span>
                      </td>
                      <td className="py-2.5 pr-4 text-[var(--muted)]">{it.type}</td>
                      <td className="py-2.5 pr-4 text-right font-mono text-[var(--muted)]">{formatTokens(it.tokens)}</td>
                      <td className="py-2.5">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                            it.verdict === 'KEEP'
                              ? 'text-[var(--accent)] border-[var(--accent)] bg-[var(--accent-dim)]'
                              : 'text-[var(--amber)] border-[var(--amber)] bg-transparent'
                          }`}
                        >
                          {it.verdict}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-[var(--faint)] mt-4">
              Verdicts are advisory. <span className="text-[var(--text)]">REVIEW</span> means "check whether this earns
              its context" — a rarely-but-critically-used skill (deploy, incident response) still earns a REVIEW, not a
              condemnation. Never used ≠ never useful.
            </p>
          </div>
        </>
      ) : (
        <>
          <Mechanisms />
          <EmptyState
            title="This reveal runs on your machine"
            body={
              "The full inventory of always-loaded skills, MCP tools and memory files lives under ~/.claude — the " +
              'browser can\'t read your filesystem, so we won\'t guess at it here. Run the command below in your terminal ' +
              'for the full reveal: which items are dead weight, how many tokens each costs, and the monthly re-read total.'
            }
            command="wtclaude waste"
            note="Token size is an estimate; turns, input rate and your model's own cache-read multiplier are billing-grade. Verdicts are REVIEW — this tool never removes anything for you."
          />
        </>
      )}
    </div>
  );
}
