// ─────────────────────────────────────────────────────────────────────────────
// HonestyBadge — load-bearing, NOT decoration. Every number on the dashboard
// declares how trustworthy it is, using the project's 3-tier labeling:
//
//   billing-grade  → anchored on Claude Code's cost.total_cost_usd (the bill).
//   inferred       → a label we derived (e.g. fast-mode speed tier) — directionally
//                    right, not the exact basis.
//   estimate       → computed from a pricing map / projection, not the bill.
//
// Tiers map to color + shape so they're distinguishable without relying on color
// alone (accessibility): solid green / solid amber / dashed gray.
// ─────────────────────────────────────────────────────────────────────────────

const TIERS = {
  'billing-grade': {
    label: 'billing-grade',
    title: 'Billing-grade — anchored on Claude Code\'s cost.total_cost_usd (the actual bill).',
    cls: 'text-[var(--accent)] border-[var(--accent)] bg-[var(--accent-dim)] border-solid',
    dot: '●',
  },
  mixed: {
    label: 'mostly billing-grade',
    title: 'A mix: most cost is billing-grade (cost.total_cost_usd); some turns are estimated from a pricing map.',
    cls: 'text-[var(--amber)] border-[var(--amber)] bg-transparent border-solid',
    dot: '◐',
  },
  inferred: {
    label: 'inferred',
    title: 'Inferred label — derived (e.g. fast-mode speed tier), directionally right but not the exact basis.',
    cls: 'text-[var(--amber)] border-[var(--amber)] bg-transparent border-solid',
    dot: '◑',
  },
  estimate: {
    label: 'estimate',
    title: 'Estimate — computed from a pricing map or projection, not the actual bill.',
    cls: 'text-[var(--muted)] border-[var(--faint)] bg-transparent border-dashed',
    dot: '○',
  },
  forecast: {
    label: 'forecast',
    title: 'Forecast — a projection from your trailing usage. Never your exact future bill.',
    cls: 'text-[var(--muted)] border-[var(--faint)] bg-transparent border-dashed',
    dot: '○',
  },
  // Added 2026-09-28 (QA-0928-90): a figure Claude Code itself reports that is
  // not a cost — the plan-limit percentages. Exact as of its reading, but not
  // "billing-grade", which this project reserves for the anchored cost.
  reported: {
    label: 'as reported',
    title: 'From a synced Claude Code status update — the percentages Claude Code reports, as of that reading. Not a cost figure.',
    cls: 'text-[var(--indigo)] border-[var(--indigo)] bg-transparent border-solid',
    dot: '◆',
  },
};

// `title` overrides the tier's tooltip when the figure needs a more exact one
// (e.g. a mixed figure's actual billing-grade share).
export default function HonestyBadge({ tier = 'billing-grade', label, title, className = '' }) {
  const t = TIERS[tier] || TIERS['billing-grade'];
  const tip = title || t.title;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide align-middle whitespace-nowrap ${t.cls} ${className}`}
      title={tip}
    >
      <span aria-hidden="true">{t.dot}</span>
      {label || t.label}
      <span className="sr-only"> ({tip})</span>
    </span>
  );
}
