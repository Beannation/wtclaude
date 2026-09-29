import HonestyBadge from './HonestyBadge';
import { turnCostBasis } from '../lib/derive';

// One turn's cost on the session detail, labelled the way `wtclaude session`
// labels it (RC 0.3.2). An estimated or not-priced turn used to show no cost and
// no label, so the per-turn list silently summed below the session header.
// `fc` formats a USD figure in the display currency. `inTotal` is true only when
// the turn list adds up to the header's total (derive.sessionTurnSummary): then
// the tooltip may say where this turn sits in it. A session synced by an older
// wtclaude carries that version's total, so otherwise the tooltip says what
// `wtclaude session` shows and nothing about the header.
export default function TurnCost({ turn, fc, inTotal = false }) {
  const c = turnCostBasis(turn);
  if (c.basis === 'billing-grade') {
    return <span className="text-[var(--accent)] font-mono">{fc(c.usd)}</span>;
  }
  if (c.basis === 'estimated') {
    const body = fc(c.usd);
    // "~" marks an estimated USD figure (the CLI's convention); a converted
    // figure already carries "≈".
    return (
      // Stacked on a phone so the row's model name keeps its room.
      <span className="inline-flex flex-col items-end gap-0.5 sm:flex-row sm:items-center sm:gap-1.5">
        <span className="text-[var(--muted)] font-mono">{body.startsWith('≈') ? body : `~${body}`}</span>
        <HonestyBadge tier="estimate" label="estimated"
          title={inTotal
            ? 'No Claude Code cost figure on this turn: a list-rate estimate from its tokens, included in the session total.'
            : 'No Claude Code cost figure on this turn: a list-rate estimate from its tokens, as wtclaude session shows it.'} />
      </span>
    );
  }
  const who = turn.model ? `${turn.model} has` : 'its model has';
  return (
    <span className="text-[var(--faint)] text-xs uppercase tracking-wide"
      title={inTotal
        ? `No Claude Code cost figure on this turn, and ${who} no rate we can stand behind, so it counts zero in the session total.`
        : `No Claude Code cost figure on this turn, and ${who} no rate we can stand behind, so wtclaude session counts it as zero.`}>
      not priced
    </span>
  );
}
