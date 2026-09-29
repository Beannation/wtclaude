import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateComparisonCard, generateComparisonHtml } from './card-generator.js';

// QA-0928-19 (2026-09-28): the share card labelled window TOTALS "/day" (days was
// never passed in), hard-coded the cache-read gap as "~1x", rounded the token
// gaps to whole numbers (0.3x read "0x") and printed "???x" on a zero side.

const accurate = { input_tokens: 300, output_tokens: 5000, cache_read_tokens: 500_000, cache_write_tokens: 0, cost: 6 };
const jsonl = { input_tokens: 1000, output_tokens: 2000, cache_read_tokens: 200_000, cache_write_tokens: 0, cost: 3 };

test('a 3-day card says "over 3 days", never "/day"', () => {
  const svg = generateComparisonCard(accurate, jsonl, { days: 3 });
  assert.doesNotMatch(svg, /\/day/);
  assert.match(svg, /Over 3 days/);
  assert.match(generateComparisonHtml(accurate, jsonl, { days: 3 }), /Over 3 days/);
});

test('a 1-day card says "Today"', () => {
  const svg = generateComparisonCard(accurate, jsonl, { days: 1 });
  assert.doesNotMatch(svg, /\/day/);
  assert.match(svg, /Today:/);
});

test('every gap is computed at the table\'s one decimal — cache read included, no hard-coded "~1x"', () => {
  const svg = generateComparisonCard(accurate, jsonl, { days: 1 });
  assert.doesNotMatch(svg, /~1x/);
  assert.match(svg, />2\.5x</, 'cache read 500K / 200K');
  assert.match(svg, />0\.3x</, 'input 300 / 1000 is 0.3x, not "0x"');
  assert.match(svg, />2\.5x</, 'output 5000 / 2000');
  assert.match(svg, />2\.0x</, 'cost $6 / $3');
});

test('a zero session-log side reads N/A, not "???x"', () => {
  const svg = generateComparisonCard(accurate, { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost: 0 }, { days: 1 });
  assert.doesNotMatch(svg, /\?\?\?/);
  assert.match(svg, />N\/A</);
});
