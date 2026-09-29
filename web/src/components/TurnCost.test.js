// Session-detail turn cost render tests (node --test via src/test-support/jsx.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, text } from '../test-support/jsx.js';
import { formatCost } from '../lib/format.js';

const C = new URL('./TurnCost.jsx', import.meta.url);
const usd = (v) => formatCost(v, 'USD');
const eur = (v) => formatCost(v, 'EUR');
const tok = { input_tokens: 2000, output_tokens: 1000 };

// RC 0.3.2 (e2e-local): an estimated turn and a not-priced one showed only
// their tokens, so the list silently summed below the header's total.
test('TurnCost: an anchored turn shows its billing-grade cost', async () => {
  const t = text(await render(C, 'default', { turn: { ...tok, cost_usd: 0.1234, cumulative_cost_usd: 2 }, fc: usd }));
  assert.equal(t, '$0.123');
});

test('TurnCost: an estimated turn shows ~cost and says it is an estimate', async () => {
  const t = text(await render(C, 'default', { turn: { ...tok, cost_usd: null, cumulative_cost_usd: null, cost_estimate_usd: 0.04 }, fc: usd }));
  assert.match(t, /^~\$0\.040 ○ estimated/);
  const e = text(await render(C, 'default', { turn: { ...tok, cost_usd: null, cost_estimate_usd: 0.04 }, fc: eur }));
  assert.match(e, /^≈ €0\.037 ○ estimated/, 'a converted figure already says ≈; no ~ on top');
});

test('TurnCost: an excluded turn says not priced, with no figure', async () => {
  const turn = { ...tok, model: 'claude-mystery-9', cost_usd: null, cumulative_cost_usd: null, cost_estimate_usd: null };
  const html = await render(C, 'default', { turn, fc: usd, inTotal: true });
  const t = text(html);
  assert.match(t, /^not priced/);
  assert.doesNotMatch(t, /\$/);
  assert.match(html, /title="[^"]*counts zero in the session total/);
});

// RC 0.3.2 regression: the tooltips said where the turn sits in the session
// total even when the header came from an older wtclaude that priced it another
// way. Without inTotal (the list does not add up to the header) they say what
// wtclaude session shows, and nothing about the header.
test('TurnCost: without inTotal the tooltips make no claim about the session total', async () => {
  const excluded = await render(C, 'default', { turn: { ...tok, model: 'claude-mystery-9', cost_usd: null }, fc: usd });
  assert.doesNotMatch(excluded, /session total/);
  assert.match(excluded, /title="[^"]*wtclaude session counts it as zero/);
  const est = await render(C, 'default', { turn: { ...tok, cost_usd: null, cost_estimate_usd: 0.04 }, fc: usd });
  assert.doesNotMatch(est, /session total/);
  assert.match(est, /title="[^"]*list-rate estimate from its tokens/);
  const inTotal = await render(C, 'default', { turn: { ...tok, cost_usd: null, cost_estimate_usd: 0.04 }, fc: usd, inTotal: true });
  assert.match(inTotal, /included in the session total/);
});

// The regression's own row: no estimate on the row, a model the rate sheet prices.
test('TurnCost: a priceable turn with no synced estimate shows its list-rate estimate, not "not priced"', async () => {
  const t = text(await render(C, 'default', { turn: { ...tok, model: 'claude-opus-4-8', cost_usd: null, cumulative_cost_usd: null }, fc: usd }));
  assert.match(t, /^~\$0\.\d+ ○ estimated/);
  assert.doesNotMatch(t, /not priced/);
});
