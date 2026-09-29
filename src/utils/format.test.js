import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatCost } from './cost.js';
import { formatMoney } from './currency.js';
import {
  formatUsageSummary, formatComparisonTable, costBasisBadge, basisTag, usdTag, tableAmount, tokensAll, tokensInOut, TOKENS_ALL_LABEL, TOKENS_IN_OUT_LABEL, inputSideTokens,
} from './format.js';

const EUR = { code: 'EUR', rate: 0.92, symbol: '€', isUsd: false, supported: true };
const JPY = { code: 'JPY', rate: 157, symbol: '¥', isUsd: false, supported: true };
const USD = { code: 'USD', rate: 1, symbol: '$', isUsd: true, supported: true };

// ── QA-0928-164 / QA-0928-156: money formatting ──────────────────────────────

test('formatCost: exactly zero is $0.00, not $0.0000', () => {
  assert.equal(formatCost(0), '$0.00');
  assert.equal(formatCost(-0), '$0.00');
  assert.equal(formatMoney(0, USD), '$0.00');
});

test('formatCost: sub-cent and sub-dollar precision is unchanged', () => {
  assert.equal(formatCost(0.005), '$0.0050');
  assert.equal(formatCost(0.5), '$0.500');
  assert.equal(formatCost(-10.69), '-$10.69');
});

test('formatCost / formatMoney: thousands are grouped for display', () => {
  assert.equal(formatCost(12345.67), '$12,345.67');
  assert.equal(formatCost(-1234567.891), '-$1,234,567.89');
  assert.equal(formatCost(999.99), '$999.99');
  assert.equal(formatMoney(12345.67, USD), '$12,345.67');
  assert.equal(formatMoney(10000, EUR), '≈ €9,200.00');
});

test('DEFAULT_FX is exported for the dashboard parity check, with USD at 1 (QA-0928-91)', async () => {
  const { DEFAULT_FX } = await import('./currency.js');
  assert.equal(DEFAULT_FX.USD, 1);
  assert.equal(DEFAULT_FX.JPY, JPY.rate);
});

test('formatMoney: JPY has no minor unit, so no decimals', () => {
  assert.equal(formatMoney(1234.56, JPY), '≈ ¥193,826');
  assert.equal(formatMoney(0.001, JPY), '≈ ¥0');
});

// ── QA-0928-156 / QA-0928-157: the summary block ─────────────────────────────

const SUMMARY = {
  cost: 42.1, anchored_cost: 42.1, estimated_cost: 0, fast_cost: 0,
  anchored_turns: 250, estimated_turns: 0, excluded_turns: 0, excluded_models: {},
  fast_turns: 0, fast_payload_turns: 0, fast_inferred_turns: 0,
  input_tokens: 812000, output_tokens: 234000, cache_read_tokens: 1400000, cache_write_tokens: 1020000,
  session_count: 2, turn_count: 250, models: { 'claude-opus-5-5[1m]': 250 },
};

test('formatUsageSummary: one 13-column label block, so "Cache write:" gets its space', () => {
  assert.equal(formatUsageSummary('Today (2026-09-28)', SUMMARY), [
    '',
    '  Today (2026-09-28)',
    '  ==================',
    '  Cost:        $42.10  (billing-grade)',
    '  Input:       812K tokens',
    '  Output:      234K tokens',
    '  Cache read:  1.4M tokens',
    '  Cache write: 1.0M tokens',
    '  Sessions:    2',
    '  Turns:       250',
    '  Models:      claude-opus-5-5[1m] (250)',
    '',
  ].join('\n'));
});

test('formatUsageSummary: a converted amount is badged as converted from the USD figure, not as billing-grade itself', () => {
  const out = formatUsageSummary('Today', SUMMARY, EUR);
  assert.match(out, /Cost: {8}≈ €38\.73 {2}\(converted from billing-grade USD \$42\.10\)/);
  assert.doesNotMatch(out, /≈ €38\.73 {2}\(billing-grade\)/);
  const mixed = formatUsageSummary('Today', { ...SUMMARY, cost: 100, anchored_cost: 66, estimated_cost: 34, estimated_turns: 1 }, EUR);
  assert.match(mixed, /≈ €92\.00 {2}\(converted from USD \$100\.00 — 66% billing-grade, rest estimated\)/);
  const est = formatUsageSummary('Today', { ...SUMMARY, anchored_cost: 0, anchored_turns: 0, estimated_cost: 42.1, estimated_turns: 3 }, EUR);
  assert.match(est, /\(converted from estimated USD \$42\.10\)/);
});


test('costBasisBadge never reads "100%" or "0% billing-grade, rest estimated", rounded or exact', () => {
  const mixed = (anchored, estimated) => costBasisBadge({ cost: anchored + estimated, anchored_cost: anchored, estimated_cost: estimated, anchored_turns: 1, estimated_turns: 1 }).label;
  assert.equal(mixed(12000, 3.3), '>99% billing-grade, rest estimated');
  assert.equal(mixed(0.001, 50), '<1% billing-grade, rest estimated');
  assert.equal(mixed(66, 34), '66% billing-grade, rest estimated');
  // Exact edges: an estimated part of exactly $0 (an unanchored zero-token turn)
  // leaves the figure all anchor; an anchored part of exactly $0 (cost_usd-0
  // turns, common in real histories) leaves it all estimate. Neither reads
  // "100%" or "0% billing-grade, rest estimated".
  assert.deepEqual(costBasisBadge({ cost: 5, anchored_cost: 5, estimated_cost: 0, anchored_turns: 1, estimated_turns: 1 }), { label: 'billing-grade', tilde: false });
  assert.deepEqual(costBasisBadge({ cost: 5, anchored_cost: 0, estimated_cost: 5, anchored_turns: 1, estimated_turns: 1 }), { label: 'estimated', tilde: true });
  assert.deepEqual(costBasisBadge({ cost: 0, anchored_cost: 0, estimated_cost: 0, anchored_turns: 1, estimated_turns: 1 }), { label: 'billing-grade', tilde: false });
});

test('basisTag agrees with costBasisBadge at the exact edges, so "~" and "mixed" never contradict the badge', () => {
  const allAnchor = { cost: 5, anchored_cost: 5, estimated_cost: 0, anchored_turns: 1, estimated_turns: 1 };
  const allEstimate = { cost: 5, anchored_cost: 0, estimated_cost: 5, anchored_turns: 1, estimated_turns: 1 };
  const split = { cost: 5, anchored_cost: 4, estimated_cost: 1, anchored_turns: 1, estimated_turns: 1 };
  assert.deepEqual(basisTag(allAnchor), { tag: 'billing-grade', tilde: false, priced: true });
  assert.equal(tableAmount(5, allAnchor), '$5.00');
  assert.deepEqual(basisTag(allEstimate), { tag: 'estimated', tilde: true, priced: true });
  assert.equal(tableAmount(5, allEstimate), '~$5.00');
  assert.deepEqual(basisTag(split), { tag: 'mixed', tilde: true, priced: true });
});

// ── QA-0928-157: a converted row's tag names the USD figure it describes ─────

test('usdTag / basisTag(s, cur): in a converted table the tag describes the USD source, never the ≈ amount', () => {
  const anchored = { cost: 5, anchored_cost: 5, estimated_cost: 0, anchored_turns: 1, estimated_turns: 0 };
  assert.equal(basisTag(anchored, EUR).tag, 'billing-grade USD');
  assert.equal(basisTag(anchored, USD).tag, 'billing-grade');
  assert.equal(basisTag(anchored).tag, 'billing-grade');
  assert.equal(usdTag('estimated', EUR), 'estimated USD');
  assert.equal(usdTag('mixed', JPY), 'mixed USD');
  assert.equal(usdTag('not priced', EUR), 'not priced', 'no amount, nothing to qualify');
  assert.equal(usdTag('—', EUR), '—');
  assert.equal(usdTag('billing-grade', USD), 'billing-grade');
  // A converted row never pairs "≈" with a bare "billing-grade".
  const row = `${tableAmount(5, anchored, EUR)}  ${basisTag(anchored, EUR).tag}`;
  assert.doesNotMatch(row, /≈.*billing-grade(?! USD)/);
});

// ── compare: the "accurate" side names the turns its cost leaves out ─────────

test('formatComparisonTable names unanchored turns its cost column leaves out (QA-0928-54)', () => {
  const acc = { input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, cost: 1, excluded_turns: 2, excluded_models: { 'claude-zeta-9': 2 } };
  const jsl = { input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, cost: 1 };
  const out = formatComparisonTable(acc, jsl);
  assert.match(out, /Not priced: +2 turns not priced/);
  assert.match(out, /claude-zeta-9 \(2\)/);
  assert.doesNotMatch(formatComparisonTable({ ...acc, excluded_turns: 0, excluded_models: {} }, jsl), /Not priced/);
});

// QA-0928-18 (rest): the billing-grade column's cost row was labelled
// "Est. cost". It is "Cost", and the cost cells are matched on that exact label
// (a case-sensitive includes('cost') would send them through formatTokens).
test('formatComparisonTable labels the billing-grade cost row "Cost" and formats both cells as money', () => {
  const acc = { input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, cost: 1234.56 };
  const jsl = { input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, cache_write_tokens: 0, cost: 1500 };
  const out = formatComparisonTable(acc, jsl);
  assert.doesNotMatch(out, /Est\. cost/);
  assert.match(out, /^  Cost +\$1,234\.56 +\$1,500\.00 +0\.82x$/m);
  assert.match(out, /Billing ÷ log$/m, 'the ratio column says which side is divided by which');
});

// ── QA-0928-174: one definition of a tokens total, with its label ────────────


test('tokensAll / tokensInOut sum the fields their labels name, on summaries and on turn records', () => {
  const s = { input_tokens: 10, output_tokens: 5, cache_read_tokens: 100, cache_write_tokens: 20 };
  assert.equal(tokensAll(s), 135);
  assert.equal(tokensInOut(s), 15);
  assert.equal(tokensAll({ input_tokens: 1 }), 1, 'missing fields count as 0');
  assert.equal(TOKENS_ALL_LABEL, 'all token fields (input + output + cache read + cache write)');
  assert.equal(TOKENS_IN_OUT_LABEL, 'input + output');
});

test('inputSideTokens counts the input side once (RC 2026-09-28)', () => {
  // Current rows: input already includes cache read + write.
  assert.equal(inputSideTokens({ input_tokens: 1000, cache_read_tokens: 700, cache_write_tokens: 300 }), 1000);
  assert.equal(inputSideTokens({ input_tokens: 1200, cache_read_tokens: 700, cache_write_tokens: 300 }), 1200);
  // Older rows: input is the uncached part only.
  assert.equal(inputSideTokens({ input_tokens: 100, cache_read_tokens: 900, cache_write_tokens: 0 }), 1000);
  assert.equal(inputSideTokens({}), 0);
});
