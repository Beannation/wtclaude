// Donut render tests (node --test via src/test-support/jsx.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, text } from '../test-support/jsx.js';

const C = new URL('./Donut.jsx', import.meta.url);
const fc = (v) => `$${v.toFixed(2)}`;

// RC 0.3.2 (dash-prod): at 390 and 768 px every legend name was cut to
// 'claude-o…' by `truncate`, with no title, so 'opus-4-8[1m]' and 'opus-4-8'
// could not be told apart.
test('Donut: legend names wrap instead of truncating, and carry the full id as a title', async () => {
  const data = [
    { name: 'claude-opus-4-8[1m]', label: 'opus-4-8[1m]', value: 120.5 },
    { name: 'claude-opus-4-8', label: 'opus-4-8', value: 30.25 },
  ];
  const html = await render(C, 'default', { title: 'Cost by model', data, formatValue: fc });
  assert.doesNotMatch(html, /\btruncate\b/);
  assert.match(html, /title="claude-opus-4-8\[1m\]"[^>]*>opus-4-8\[1m\]</);
  assert.match(html, /title="claude-opus-4-8"[^>]*>opus-4-8</);
  // Stacks the chart above the legend in a narrow card (container query).
  assert.match(html, /@container/);
  assert.match(html, /flex-col[^"]*@sm:flex-row/);
});

// RC 0.3.2 (e2e-local): a model the CLI names 'Not priced' shows no figure.
test('Donut: a not-priced row says so instead of showing an amount; the note is shown', async () => {
  const data = [
    { name: 'claude-opus-5-5', label: 'opus-5-5', value: 3 },
    { name: 'claude-mystery-9', label: 'mystery-9', value: 0, notPriced: true },
  ];
  const t = text(await render(C, 'default', { title: 'Cost by model', data, formatValue: fc, note: 'Approximate: split by turn count.' }));
  assert.match(t, /Approximate: split by turn count\./);
  assert.match(t, /mystery-9 not priced/);
  assert.doesNotMatch(t, /mystery-9 \$0\.00/);
  assert.match(t, /opus-5-5 \$3\.00/);
});

// RC 0.3.2 regression: in a mixed session a model the rate sheet can't price may
// carry Claude Code's cost, so it is 'not split' (no figure, no claim that its
// turns carry no cost), and its share is one 'not split by model' slice.
test('Donut: a not-split model shows no figure and no "no cost" claim; the unsplit share is its own row', async () => {
  const data = [
    { name: 'claude-opus-5-5', label: 'opus-5-5', value: 0.45 },
    { name: '(not split by model)', label: 'not split by model', value: 4.55, bucket: true },
    { name: 'claude-opus-5-6', label: 'opus-5-6', value: 0, notSplit: true },
  ];
  const html = await render(C, 'default', { title: 'Cost by model', data, formatValue: fc });
  const t = text(html);
  assert.match(t, /opus-5-6 not split/);
  assert.doesNotMatch(t, /opus-5-6 \$/);
  assert.doesNotMatch(t, /not priced/);
  assert.match(t, /not split by model \$4\.55/);
  assert.match(t, /opus-5-5 \$0\.45/);
  assert.doesNotMatch(html, /carry no Claude Code cost/);
  assert.match(html, /title="No figure of its own/);
});
