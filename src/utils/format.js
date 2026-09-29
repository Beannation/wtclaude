import { formatCost, formatTokens, turnCostBasis } from './cost.js';
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
    const edge = mixedEdge(summary);
    if (edge === 'billing-grade') return { label: 'billing-grade', tilde: false };
    if (edge === 'estimated') return { label: 'estimated', tilde: true };
    const share = total > 0 ? ((summary.anchored_cost || 0) / total) * 100 : 0;
    // Never round a mixed total to "100% billing-grade" or "0% billing-grade".
    const pct = share > 99 && share < 100 ? '>99' : share > 0 && share < 1 ? '<1' : String(Math.round(share));
    return { label: `${pct}% billing-grade, rest estimated`, tilde: true };
  }
  if (estimated > 0) return { label: 'estimated', tilde: true };
  return { label: null, tilde: false }; // no spend / no turns → nothing to label
}

// A total with both anchored and estimated turns whose dollars all come from one
// side (QA-0928-55): an estimated part of exactly $0 (unanchored zero-token
// turns) leaves the figure all anchor, and an anchored part of exactly $0
// (cost_usd-0 turns, common in real histories) leaves it all estimate. Returns
// that side's label, or null when the dollars are genuinely split. Checked
// only when the summary carries the two amounts.
function mixedEdge(s) {
  if (typeof s.estimated_cost === 'number' && s.estimated_cost <= 0) return 'billing-grade';
  if (typeof s.anchored_cost === 'number' && s.anchored_cost <= 0) return 'estimated';
  return null;
}

// Per-turn cost basis: a turn is billing-grade iff the collector recorded the
// payload's cost_usd anchor; otherwise its cost is a labeled pricing-map estimate,
// or 'excluded' when the model cannot be priced (QA-0928-54).
export function turnBasis(turn) {
  return turnCostBasis(turn).basis;
}

// The --json honesty block, one shape everywhere (today/week/month, session,
// --group-by, report, devices, project, blocks). excluded_* are additive
// (QA-0928-54): schema_version stays 1.0.
export function costBasisJson(s) {
  const r = (n) => (typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : 0);
  return {
    anchored_usd: r(s.anchored_cost),
    estimated_usd: r(s.estimated_cost),
    anchored_turns: s.anchored_turns || 0,
    estimated_turns: s.estimated_turns || 0,
    excluded_turns: s.excluded_turns || 0,
    excluded_models: s.excluded_models || {},
  };
}

// Compact basis tag for a table row: billing-grade when fully anchored, mixed
// when some counted turns are estimated, estimated when none are anchored, and
// 'not priced' when every turn with tokens was excluded (no $ figure at all).
// A mixed row whose dollars are all one side takes that side's tag, as the
// badge does. With a non-USD `cur` the tag names the USD figure (see usdTag).
export function basisTag(s, cur = null) {
  const a = s.anchored_turns || 0, e = s.estimated_turns || 0, x = s.excluded_turns || 0;
  const t = (tag, tilde, priced = true) => ({ tag: usdTag(tag, cur), tilde, priced });
  if (a > 0 && e === 0) return t('billing-grade', false);
  if (a > 0 && e > 0) {
    const edge = mixedEdge(s);
    if (edge === 'billing-grade') return t('billing-grade', false);
    if (edge === 'estimated') return t('estimated', true);
    return t('mixed', true);
  }
  if (e > 0) return t('estimated', true);
  if (x > 0) return t('not priced', false, false);
  return t('—', false);
}

// A row tag in a converted table (QA-0928-157). The "≈" amount is an FX
// conversion and is never itself billing-grade, so the tag says which USD
// figure it describes: "billing-grade USD", "estimated USD", "mixed USD".
// USD output, and rows with no amount ("not priced", "—"), are unchanged.
const USD_TAGS = new Set(['billing-grade', 'estimated', 'mixed']);
export function usdTag(tag, cur = null) {
  return cur && !cur.isUsd && USD_TAGS.has(tag) ? `${tag} USD` : tag;
}

// A table cell amount (QA-0928-55): "~" on an estimated or mixed USD figure (the
// session list's convention; a converted figure already carries "≈"), and "—"
// when nothing in the row could be priced. Pair it with basisTag(s).tag.
export function tableAmount(usd, s, cur = null) {
  const b = basisTag(s);
  if (!b.priced) return '—';
  return `${b.tilde && (!cur || cur.isUsd) ? '~' : ''}${cur ? formatMoney(usd, cur) : formatCost(usd)}`;
}

// CSV basis columns, appended at the END of every cost CSV so existing column
// positions never move (QA-0928-55).
export const BASIS_CSV_COLUMNS = [
  { key: 'anchored_usd', label: 'anchored_usd' },
  { key: 'estimated_usd', label: 'estimated_usd' },
  { key: 'excluded_turns', label: 'excluded_turns' },
];
export function basisCsvFields(s) {
  const { anchored_usd, estimated_usd, excluded_turns } = costBasisJson(s);
  return { anchored_usd, estimated_usd, excluded_turns };
}

// Word-wrap `text` to `width` columns with `first` / `rest` line prefixes.
function wrap(text, first, rest, width = 78) {
  const out = [];
  let line = first;
  for (const w of text.split(' ')) {
    if (line.length + w.length + 1 > width && line !== first && line !== rest) { out.push(line); line = rest; }
    line += (line === first || line === rest ? '' : ' ') + w;
  }
  out.push(line);
  return out;
}

// QA-0928-54: name the turns a $ total leaves out — unanchored turns on a model
// this version cannot price (unresolved, partner-platform, family fallback). No
// lines when nothing was excluded.
export function excludedLines(s, label = 'Not priced:') {
  const n = s.excluded_turns || 0;
  if (!n) return [];
  const names = Object.entries(s.excluded_models || {}).map(([m, c]) => `${m} (${c})`).join(', ');
  const first = `  ${label.padEnd(LABEL_W)}`;
  return wrap(
    `${n} turn${n === 1 ? '' : 's'} not priced, so left out of the cost: Claude Code sent no cost for ${n === 1 ? 'it' : 'them'}, ` +
    `and the model is not in this version's rate sheet or was served by a partner platform — ${names}.`,
    first, ' '.repeat(first.length));
}

// Word-wrap a sentence into lines of at most `width` columns (no prefixes).
export function wrapWords(text, width) {
  const out = [];
  let line = '';
  for (const w of String(text).split(' ')) {
    if (line && (line + ' ' + w).length > width) { out.push(line); line = w; } else line = line ? line + ' ' + w : w;
  }
  if (line) out.push(line);
  return out;
}

// Does a turn that a re-pricing view (compare-models, whatif --model) left out
// still count in the headline cost? Only when Claude Code reported its cost —
// an anchored turn. An unanchored turn on a model we can't price is left out of
// the headline too (QA-0928-54), and the cost views name it (ledger reviewer,
// 2026-09-28: the notice used to say "your headline totals still count it" for
// every excluded turn). `excluded`: turns the view left out; `unanchored`: how
// many of those carry no cost from Claude Code (turnCostBasis().basis ===
// 'excluded').
export function headlineExclusionNote(excluded, unanchored) {
  const u = Math.min(Math.max(unanchored || 0, 0), excluded);
  const it = (n) => (n === 1 ? 'it' : 'them');
  const named = `the cost views (\`today\`, \`week\`, \`month\`) name ${it(u)} under "Not priced".`;
  if (u === 0) {
    return `Your headline cost is unaffected — it is the cost figure Claude Code itself reports, and your headline totals still count ${it(excluded)}.`;
  }
  if (u === excluded) {
    return `Claude Code sent no cost for ${excluded === 1 ? 'this turn' : 'these turns'}, so your headline totals leave ${it(u)} out too — ${named}`;
  }
  const k = excluded - u;
  return `Your headline totals still count ${k} of them (Claude Code reported ${k === 1 ? 'its' : 'their'} cost); ` +
    `the other ${u} ${u === 1 ? 'carries' : 'carry'} no cost from Claude Code, so the headline leaves ${it(u)} out too — ${named}`;
}

// One label column for the summary block (QA-0928-156): 13 wide, so the
// longest label, "Cache write:", still gets a space before its value.
const LABEL_W = 13;

// One definition of a "tokens" total (QA-0928-174). Two sums are in use — all
// four token fields (blocks, --group-by, session) and input + output only — and
// they differ ~3x on cache-heavy work, so a view prints the label of the one it
// shows. Works on summaries and on turn records (same field names).
export const TOKENS_ALL_LABEL = 'all token fields (input + output + cache read + cache write)';
export const TOKENS_IN_OUT_LABEL = 'input + output';
export function tokensAll(s) {
  return (s.input_tokens || 0) + (s.output_tokens || 0) + (s.cache_read_tokens || 0) + (s.cache_write_tokens || 0);
}
export function tokensInOut(s) {
  return (s.input_tokens || 0) + (s.output_tokens || 0);
}

// A turn's input side (input + cache read + cache write), each counted ONCE
// (RC 2026-09-28). Claude Code's context_window input figure already contains
// cache reads and writes (docs/DATA-NOTES.md), so a stored input_tokens at or
// above cache read + cache write holds them already; a smaller one (older rows
// that stored uncached input only) does not, and they are added. Adding them
// unconditionally counted cache tokens twice and capped a cache-read share at
// 50% (Cache Champion, debrief). Per TURN — the convention is a row's, not a
// day's.
export function inputSideTokens(t) {
  const input = t.input_tokens || 0;
  const cache = (t.cache_read_tokens || 0) + (t.cache_write_tokens || 0);
  return input >= cache ? input : input + cache;
}

// Merge the exclusions of several summaries (table views that name them once).
export function mergeExcluded(summaries) {
  const out = { excluded_turns: 0, excluded_models: {} };
  for (const s of summaries) {
    out.excluded_turns += s.excluded_turns || 0;
    for (const [m, c] of Object.entries(s.excluded_models || {})) out.excluded_models[m] = (out.excluded_models[m] || 0) + c;
  }
  return out;
}

// The basis badge for an amount (the text inside the parentheses), or null when
// there is nothing to label. For a converted display currency it describes the
// USD figure the amount came from (QA-0928-157) — an FX-converted number is
// approximate and is never itself billing-grade.
export function basisBadgeText(usd, summary, cur = null) {
  const b = costBasisBadge(summary);
  if (cur && !cur.isUsd) {
    const src = formatCost(usd);
    if (b.label === 'billing-grade') return `converted from billing-grade USD ${src}`;
    if (b.label === 'estimated') return `converted from estimated USD ${src}`;
    if (b.label) return `converted from USD ${src} — ${b.label}`;
    return `converted from USD ${src}`;
  }
  return b.label;
}

// A USD amount with its basis in parentheses, for one-line pool figures
// (credits / forecast / readiness): "$1.00 (billing-grade)", "~$3.62 (28%
// billing-grade, rest estimated)", "~$2.62 (estimated)"; "— (not priced)" when
// every turn behind it was excluded (QA-0928-54), and a bare amount when there
// is nothing to label.
export function amountWithBasis(usd, basis) {
  const b = costBasisBadge(basis);
  if (!b.label) {
    const priced = (basis.anchored_turns || 0) + (basis.estimated_turns || 0);
    return !priced && (basis.excluded_turns || 0) > 0 ? '— (not priced)' : formatCost(usd);
  }
  return `${b.tilde ? '~' : ''}${formatCost(usd)} (${b.label})`;
}

// The amount in the display currency followed by its basis badge.
export function moneyWithBasis(usd, summary, cur = null) {
  const badge = basisBadgeText(usd, summary, cur);
  const amt = cur ? formatMoney(usd, cur) : formatCost(usd);
  return badge ? `${amt}  (${badge})` : amt;
}

export function formatUsageSummary(label, summary, cur = null) {
  // money() honors the active display currency when provided; otherwise falls
  // back to the billing-grade USD formatter. USD always stays the source of truth.
  const money = (usd) => (cur ? formatMoney(usd, cur) : formatCost(usd));
  const row = (name, value) => `  ${name.padEnd(LABEL_W)}${value}`;
  const lines = [];
  lines.push(`\n  ${label}`);
  lines.push(`  ${'='.repeat(label.length)}`);

  // Headline cost — billing-grade when anchored on the payload's
  // cost.total_cost_usd; labeled honestly when any turn fell back to estimate.
  // Aggregate headline keeps its established (QA-passed) form: the parenthetical
  // basis badge, no leading "~". The per-session `session` view additionally
  // prefixes "~" on an estimated total (QA-BUG-03) — that's its own renderer.
  const total = summary.cost || 0;
  lines.push(basisTag(summary).priced
    ? row('Cost:', moneyWithBasis(total, summary, cur))
    : row('Cost:', '—  (not priced — see below)'));
  lines.push(...excludedLines(summary));

  // Fast-mode spend. BUILD-022: when every fast turn was read from the payload's
  // `fast_mode` field it's billing-grade (no "inferred" caveat, no "~"); the
  // legacy ratio inference still falls back to the labeled form on older CC.
  if (summary.fast_cost > 0) {
    const payloadTurns = summary.fast_payload_turns || 0;
    const inferredTurns = summary.fast_inferred_turns || 0;
    if (payloadTurns > 0 && inferredTurns === 0) {
      lines.push(row('Fast-mode:', cur && !cur.isUsd
        ? `${money(summary.fast_cost)}  (converted from billing-grade USD ${formatCost(summary.fast_cost)})`
        : `${money(summary.fast_cost)}  (billing-grade)`));
    } else if (payloadTurns > 0 && inferredTurns > 0) {
      lines.push(row('Fast-mode:', `~${money(summary.fast_cost)} · partly inferred`));
    } else {
      lines.push(row('Fast-mode:', `~${money(summary.fast_cost)} · inferred`));
    }
  }

  lines.push(row('Input:', `${formatTokens(summary.input_tokens)} tokens`));
  lines.push(row('Output:', `${formatTokens(summary.output_tokens)} tokens`));
  lines.push(row('Cache read:', `${formatTokens(summary.cache_read_tokens)} tokens`));
  lines.push(row('Cache write:', `${formatTokens(summary.cache_write_tokens)} tokens`));
  lines.push(row('Sessions:', `${summary.session_count}`));
  lines.push(row('Turns:', `${summary.turn_count}`));

  if (summary.models && Object.keys(summary.models).length > 0) {
    lines.push(row('Models:', Object.entries(summary.models).map(([m, c]) => `${m} (${c})`).join(', ')));
  }

  const note = cur ? currencyNote(cur) : '';
  if (note) lines.push(note);

  lines.push('');
  return lines.join('\n');
}

// The billing-grade ÷ session-log ratio, one format for `compare`'s table and
// its sentence (RC 2026-09-28: the table showed billing ÷ log while the
// sentence below it showed the inverse). Two decimals under 1, so a small
// ratio never rounds to "0.0x"; one decimal from 1 up.
export function gapRatio(billing, log) {
  if (!(log > 0)) return 'N/A';
  const r = billing / log;
  return `${r < 1 ? r.toFixed(2) : r.toFixed(1)}x`;
}

export function formatComparisonTable(accurate, jsonl) {
  const lines = [];
  lines.push('\n  Your real cost vs a session-log estimate');
  lines.push('  ========================================');
  lines.push('');
  lines.push(`  ${'Metric'.padEnd(16)} ${'Billing-grade (statusline)'.padEnd(28)} ${'Session-log estimate'.padEnd(24)} Billing ÷ log`);
  lines.push(`  ${'------'.padEnd(16)} ${'-'.repeat(26).padEnd(28)} ${'-'.repeat(20).padEnd(24)} -------------`);

  const rows = [
    ['Input tokens', accurate.input_tokens, jsonl.input_tokens],
    ['Output tokens', accurate.output_tokens, jsonl.output_tokens],
    ['Cache read', accurate.cache_read_tokens, jsonl.cache_read_tokens],
    ['Cache write', accurate.cache_write_tokens, jsonl.cache_write_tokens],
    // QA-0928-18: this row sits in the billing-grade column, so it is "Cost",
    // not "Est. cost"; the cost cells are matched on the exact label.
    ['Cost', accurate.cost, jsonl.cost],
  ];

  for (const [label, acc, jsl] of rows) {
    const gap = gapRatio(acc, jsl);
    const isCost = label === 'Cost';
    const accStr = typeof acc === 'number' && isCost ? formatCost(acc) : formatTokens(acc);
    const jslStr = typeof jsl === 'number' && isCost ? formatCost(jsl) : formatTokens(jsl);
    lines.push(`  ${label.padEnd(16)} ${accStr.padEnd(28)} ${jslStr.padEnd(24)} ${gap}`);
  }
  // Name the turns the left column's cost leaves out (QA-0928-54).
  lines.push(...excludedLines(accurate));

  lines.push('');
  return lines.join('\n');
}
