import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.TZ = 'America/New_York';
const { isRealDate, addDays, localDateOf, localDateRange } = await import('./time.js');

// ── QA-0928-159: a date must be a real calendar date, not just the right shape ─

test('isRealDate accepts real YYYY-MM-DD dates and rejects impossible or malformed ones', () => {
  for (const ok of ['2026-09-28', '2028-02-29', '2026-12-31', '2026-01-01']) assert.ok(isRealDate(ok), ok);
  for (const bad of ['2026-13-45', '2026-02-31', '2026-02-29', '2026-00-10', '2026-9-1', '20260928', '', null, undefined, '2026-09-28T00:00']) {
    assert.ok(!isRealDate(bad), String(bad));
  }
});

// ── QA-0928-56: calendar-day arithmetic on date strings, no clock involved ───

test('addDays steps calendar dates across month, year and DST boundaries', () => {
  assert.equal(addDays('2026-09-01', -6), '2026-08-26');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-11-01', 1), '2026-11-02');   // US DST ends that day
  assert.equal(addDays('2026-03-08', -1), '2026-03-07');  // US DST starts that day
  assert.equal(addDays('2026-09-28', 0), '2026-09-28');
});

test('localDateOf buckets a late-evening EDT turn on its local day', () => {
  assert.equal(localDateOf('2026-09-15T03:30:00.000Z'), '2026-09-14'); // 23:30 EDT
  assert.equal(localDateOf('2026-09-15T04:00:00.000Z'), '2026-09-15'); // 00:00 EDT
});

// ── QA-0928-155 / QA-0928-156: reset times and countdowns ────────────────────

const { normalizeResetsAt, formatDuration, localDateTime } = await import('./time.js');

test('normalizeResetsAt reads epoch seconds, epoch milliseconds and ISO strings; anything else is unknown', () => {
  const ms = Date.UTC(2026, 8, 28, 15, 10);
  assert.equal(normalizeResetsAt(ms / 1000), ms);
  assert.equal(normalizeResetsAt(ms), ms);
  assert.equal(normalizeResetsAt(new Date(ms).toISOString()), ms);
  assert.equal(normalizeResetsAt(String(ms / 1000)), ms, 'a numeric string is still seconds');
  for (const bad of [null, undefined, '', 'soon', NaN, Infinity, {}, -5]) assert.equal(normalizeResetsAt(bad), null, String(bad));
});

test('formatDuration: one countdown format for limit and watch; minutes never print as 60', () => {
  const M = 60_000, H = 60 * M;
  assert.equal(formatDuration(6 * 24 * H + 9 * H + 59 * M), '6d 9h');
  assert.equal(formatDuration(152 * H + 59 * M), '6d 8h');
  assert.equal(formatDuration(H + 9 * M + 30_000), '1h 9m');
  assert.equal(formatDuration(2 * H - 1), '1h 59m');
  assert.equal(formatDuration(H), '1h 0m');
  assert.equal(formatDuration(9 * M), '9m');
  assert.equal(formatDuration(20_000), '<1m');
});

test('localDateTime renders a stored UTC timestamp in local time', () => {
  assert.equal(localDateTime('2026-09-28T13:42:00.000Z'), '2026-09-28 09:42');
});

// ── QA-0928-58 / 160 / 163: a compact local date range ───────────────────────

test('localDateRange: one day, same month, same year, across New Year (drops the repeated year), over a year (both in full)', () => {
  assert.equal(localDateRange('2026-09-14T17:53:00Z', '2026-09-15T03:30:00Z'), '2026-09-14', '23:30 EDT is still the 14th');
  assert.equal(localDateRange('2026-09-14T17:00:00Z', '2026-09-15T17:00:00Z'), '2026-09-14–15');
  assert.equal(localDateRange('2026-08-31T17:00:00Z', '2026-09-01T17:00:00Z'), '2026-08-31–09-01');
  assert.equal(localDateRange('2026-12-31T17:00:00Z', '2027-01-01T17:00:00Z'), '2026-12-31–01-01');
  assert.equal(localDateRange('2026-06-01T17:00:00Z', '2027-06-02T17:00:00Z'), '2026-06-01–2027-06-02', 'a span over a year keeps both years');
});
