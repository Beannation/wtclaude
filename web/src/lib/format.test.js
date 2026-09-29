// Unit tests for the dashboard's display formatters. Run with `npm test` in web/
// (node --test). The zone is pinned before any Date is used, so the date-only
// parsing checks are deterministic on every machine.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  formatCurrency, formatCost, formatDate, relativeTime, countdownTo, resetInfo, formatAxisCost,
} from './format.js';
import { FX_RATES } from './config.js';

const NOW = Date.parse('2026-07-13T22:30:00-04:00');

// QA-0928-91: every converted figure is marked approximate; USD (the billing-grade
// source) is not.
test('formatCurrency marks converted figures approximate and leaves USD alone', () => {
  assert.ok(formatCurrency(1, 'EUR').startsWith('≈'), formatCurrency(1, 'EUR'));
  assert.ok(formatCurrency(1234.5, 'JPY').startsWith('≈'), formatCurrency(1234.5, 'JPY'));
  assert.ok(formatCost(0, 'GBP').startsWith('≈'));
  assert.equal(formatCurrency(1, 'USD'), '$1.00');
  assert.equal(formatCurrency(0.5, 'USD'), '$0.500');
  assert.ok(!formatCurrency(12, 'USD').includes('≈'));
});

test('formatCurrency puts the sign before the symbol', () => {
  assert.equal(formatCurrency(-10.69, 'USD'), '-$10.69');
  assert.equal(formatCurrency(-1, 'EUR'), '≈ -€0.920');
});

// QA-0928-91: the browser table IS the CLI's table. The CLI keeps it in a
// non-exported const, so the test reads it from the source.
test('dashboard FX rates equal the CLI built-in table', () => {
  const src = readFileSync(fileURLToPath(new URL('../../../src/utils/currency.js', import.meta.url)), 'utf8');
  const body = src.match(/const DEFAULT_FX = (\{[\s\S]*?\});/);
  assert.ok(body, 'DEFAULT_FX not found in src/utils/currency.js');
  const cli = Function(`return (${body[1]});`)();
  for (const [code, fx] of Object.entries(FX_RATES)) {
    assert.equal(fx.rate, cli[code], `${code}: dashboard ${fx.rate} vs CLI ${cli[code]}`);
  }
});

// QA-0928-91: the Daily cost axis follows the display currency.
test('formatAxisCost converts ticks into the display currency', () => {
  assert.equal(formatAxisCost(100, 'USD'), '$100');
  assert.equal(formatAxisCost(100, 'EUR'), '€92');
  assert.equal(formatAxisCost(100, 'JPY'), '¥15,700');
  assert.equal(formatAxisCost(0.5, 'USD'), '$0.5');
});

// QA-0928-103: a date-only string is a LOCAL calendar day, not UTC midnight.
test('formatDate labels a YYYY-MM-DD row with its own day west of UTC', () => {
  assert.equal(formatDate('2026-05-25'), 'May 25');
  assert.equal(formatDate('2026-01-01'), 'Jan 1');
});

// QA-0928-177: a future timestamp is never "just now".
test('relativeTime does not call a future time "just now"', () => {
  const later = new Date(NOW + 5 * 3600_000).toISOString();
  assert.notEqual(relativeTime(later, NOW), 'just now');
  assert.equal(relativeTime(new Date(NOW - 30_000).toISOString(), NOW), 'just now');
  assert.equal(relativeTime(new Date(NOW - 3 * 3600_000).toISOString(), NOW), '3h ago');
});

// QA-0928-90: long countdowns read in days; a past reset is not a countdown.
test('countdownTo shows days for long waits and nothing for a past reset', () => {
  assert.equal(countdownTo(new Date(NOW + (147 * 60 + 29) * 60_000).toISOString(), NOW), '6d 3h');
  assert.equal(countdownTo(new Date(NOW + (2 * 60 + 5) * 60_000).toISOString(), NOW), '2h 05m');
  assert.equal(countdownTo(new Date(NOW - 60_000).toISOString(), NOW), null);
});

test('resetInfo reports a past reset as a local clock time', () => {
  const past = resetInfo('2026-07-13T19:40:00Z', NOW);
  assert.equal(past.past, true);
  assert.equal(past.text, 'window reset at 3:40 PM');
  const earlier = resetInfo('2026-07-10T19:40:00Z', NOW);
  assert.equal(earlier.text, 'window reset Jul 10, 3:40 PM');
  const future = resetInfo('2026-07-14T04:30:00Z', NOW);
  assert.deepEqual(future, { past: false, text: 'resets in 2h 00m' });
  assert.equal(resetInfo(null, NOW), null);
});

// RC 0.3.2 (QA-0928-164 parity): nothing spent reads "$0.00", as the CLI's
// formatCost prints it — never "$0.000". Converted zeros keep their "≈".
test('formatCurrency writes zero as the CLI does', () => {
  assert.equal(formatCurrency(0, 'USD'), '$0.00');
  assert.equal(formatCost(0, 'USD'), '$0.00');
  assert.equal(formatCost(null, 'USD'), '$0.00');
  assert.equal(formatCurrency(-0, 'USD'), '$0.00');
  assert.equal(formatCurrency(0, 'EUR'), '≈ €0.00');
  assert.equal(formatCurrency(0, 'JPY'), '≈ ¥0');
  // Non-zero small values keep their precision.
  assert.equal(formatCurrency(0.004, 'USD'), '$0.0040');
  assert.equal(formatCurrency(0.5, 'USD'), '$0.500');
});
