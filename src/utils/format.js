import { formatCost, formatTokens } from './cost.js';
import { formatMoney, currencyNote } from './currency.js';

// Shared honesty-label vocabulary. The headline cost is billing-grade when every
// counted turn carries the payload's cost.total_cost_usd anchor; otherwise it is
// (partly) a pricing-map estimate and MUST be labeled as such (MUST-PASS line 22).
// Returns { label, tilde }: `label` is the parenthetical badge suffix, `tilde` is
// true when the amount is (partly) estimated and should be prefixed with "~".
// Single source of truth so today/week/month and `session` never diverge.
export function costBasisBadge(summary) {
  const anchored = summary.anchored_turns || 0;
  const estimated = summary.estimated_turns || 0;
  const total = summary.cost || 0;
  if (anchored > 0 && estimated === 0) return { label: 'billing-grade', tilde: false };
  if (anchored > 0 && estimated > 0) {
    const pct = total > 0 ? Math.round(((summary.anchored_cost || 0) / total) * 100) : 0;
    return { label: `${pct}% billing-grade, rest estimated`, tilde: true };
  }
  if (estimated > 0) return { label: 'estimated', tilde: true };
  return { label: null, tilde: false }; // no spend / no turns → nothing to label
}

// Per-turn cost basis: a turn is billing-grade iff the collector recorded the
// payload's cost_usd anchor; otherwise its cost is a labeled pricing-map estimate.
export function turnBasis(turn) {
  return typeof turn.cost_usd === 'number' ? 'billing-grade' : 'estimated';
}

export function formatUsageSummary(label, summary, cur = null) {
  // money() honors the active display currency when provided; otherwise falls
  // back to the billing-grade USD formatter. USD always stays the source of truth.
  const money = (usd) => (cur ? formatMoney(usd, cur) : formatCost(usd));
  const lines = [];
  lines.push(`\n  ${label}`);
  lines.push(`  ${'='.repeat(label.length)}`);

  // Headline cost — billing-grade when anchored on the payload's
  // cost.total_cost_usd; labeled honestly when any turn fell back to estimate.
  // Aggregate headline keeps its established (QA-passed) form: the parenthetical
  // basis badge, no leading "~". The per-session `session` view additionally
  // prefixes "~" on an estimated total (QA-BUG-03) — that's its own renderer.
  const total = summary.cost || 0;
  const basis = costBasisBadge(summary);
  let costLine = `  Cost:       ${money(total)}`;
  if (basis.label) costLine += `  (${basis.label})`;
  lines.push(costLine);

  // Fast-mode spend. BUILD-022: when every fast turn was read from the payload's
  // `fast_mode` field it's billing-grade (no "inferred" caveat, no "~"); the
  // legacy ratio inference still falls back to the labeled form on older CC.
  if (summary.fast_cost > 0) {
    const payloadTurns = summary.fast_payload_turns || 0;
    const inferredTurns = summary.fast_inferred_turns || 0;
    if (payloadTurns > 0 && inferredTurns === 0) {
      lines.push(`  Fast-mode:  ${money(summary.fast_cost)}  (billing-grade)`);
    } else if (payloadTurns > 0 && inferredTurns > 0) {
      lines.push(`  Fast-mode:  ~${money(summary.fast_cost)} · partly inferred`);
    } else {
      lines.push(`  Fast-mode:  ~${money(summary.fast_cost)} · inferred`);
    }
  }

  lines.push(`  Input:      ${formatTokens(summary.input_tokens)} tokens`);
  lines.push(`  Output:     ${formatTokens(summary.output_tokens)} tokens`);
  lines.push(`  Cache read: ${formatTokens(summary.cache_read_tokens)} tokens`);
  lines.push(`  Cache write:${formatTokens(summary.cache_write_tokens)} tokens`);
  lines.push(`  Sessions:   ${summary.session_count}`);
  lines.push(`  Turns:      ${summary.turn_count}`);

  if (summary.models && Object.keys(summary.models).length > 0) {
    lines.push(`  Models:     ${Object.entries(summary.models).map(([m, c]) => `${m} (${c})`).join(', ')}`);
  }

  const note = cur ? currencyNote(cur) : '';
  if (note) lines.push(note);

  lines.push('');
  return lines.join('\n');
}

export function formatComparisonTable(accurate, jsonl) {
  const lines = [];
  lines.push('\n  Your real cost vs a session-log estimate');
  lines.push('  ========================================');
  lines.push('');
  lines.push(`  ${'Metric'.padEnd(16)} ${'Billing-grade (statusline)'.padEnd(28)} ${'Session-log estimate'.padEnd(24)} Gap`);
  lines.push(`  ${'------'.padEnd(16)} ${'-'.repeat(26).padEnd(28)} ${'-'.repeat(20).padEnd(24)} ---`);

  const rows = [
    ['Input tokens', accurate.input_tokens, jsonl.input_tokens],
    ['Output tokens', accurate.output_tokens, jsonl.output_tokens],
    ['Cache read', accurate.cache_read_tokens, jsonl.cache_read_tokens],
    ['Cache write', accurate.cache_write_tokens, jsonl.cache_write_tokens],
    ['Est. cost', accurate.cost, jsonl.cost],
  ];

  for (const [label, acc, jsl] of rows) {
    const gap = jsl > 0 ? `${(acc / jsl).toFixed(1)}x` : 'N/A';
    const accStr = typeof acc === 'number' && label.includes('cost') ? formatCost(acc) : formatTokens(acc);
    const jslStr = typeof jsl === 'number' && label.includes('cost') ? formatCost(jsl) : formatTokens(jsl);
    lines.push(`  ${label.padEnd(16)} ${accStr.padEnd(28)} ${jslStr.padEnd(24)} ${gap}`);
  }

  lines.push('');
  return lines.join('\n');
}
