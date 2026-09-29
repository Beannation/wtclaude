// What If render tests (node --test via src/test-support/jsx.js).
process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, text } from '../test-support/jsx.js';
import { describeError, edgeError } from '../lib/errors.js';
import { loadErrorView } from '../lib/compareModels.js';

const PAGE = new URL('./WhatIf.jsx', import.meta.url);
const EMPTY_STATE = new URL('../components/EmptyState.jsx', import.meta.url);
// Noon on 2026-09-28 in UTC and in New York alike.
const NOW = new Date('2026-09-28T16:00:00Z');
const day = (date, usd) => ({ date, estimated_cost_usd: usd, anchored_cost_usd: usd, estimated_only_cost_usd: 0, turn_count: 4 });
const view = (data) => render(PAGE, 'WhatIfView', { data: { sessions: [], ...data }, currency: 'USD', now: NOW });

// RC 0.3.2 (dash-prod): against a server that doesn't send
// meta.first_activity_at (every server before the 0.3.2 deploy), the monthly
// projection divided by the whole selected window and said "earlier days count
// as idle". At 365 days that read several times below `wtclaude whatif --days
// 365` for anyone tracked for under a year (the synthetic payload below covers
// 126 of 365 days: $10.36/mo instead of $30.00). The page now uses the Overview's rule
// (derive.monthlyProjectionBasis): the first synced day in the window stands in
// for when tracking began, and the note says so.
test('a 365-day window whose data starts on its day 240 projects from 126 days, not 365', async () => {
  const t = text(await view({ meta: { days: 365 }, daily_summaries: [day('2026-05-26', 100), day('2026-09-01', 26)] }));
  // $126 over 2026-05-26 … 2026-09-28 (126 days) = $30/mo.
  assert.match(t, /Projected to a month: \$30\.00\/mo/);
  assert.match(t, /Projected from 126 days of synced data, from 2026-05-26 UTC, your first synced day in the 365-day window \(this server doesn't say when tracking began; if it began earlier, the monthly figure is lower\)\./);
  assert.doesNotMatch(t, /count as idle/);
  assert.doesNotMatch(t, /full 365-day window/);
});

// The same rule on a 30-day window that opens on idle days (synthetic: 15
// active days at $10, the first on 2026-09-06). The old basis divided by the
// whole window: $150.00/mo, "earlier days count as idle".
test('a 30-day window whose first synced day is 09-06 projects from 23 days, not 30', async () => {
  const sparse = ['2026-09-06', '2026-09-08', '2026-09-10', '2026-09-12', '2026-09-14', '2026-09-16',
    '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27',
    '2026-09-28'];
  const t = text(await view({ meta: { days: 30 }, daily_summaries: sparse.map((d) => day(d, 10)) }));
  // $150 over 2026-09-06 … 2026-09-28 (23 days) × 30 = $195.65/mo.
  assert.match(t, /Projected to a month: \$195\.65\/mo/);
  assert.match(t, /Projected from 23 days of synced data, from 2026-09-06 UTC, your first synced day in the 30-day window \(this server doesn't say when tracking began; if it began earlier, the monthly figure is lower\)\./);
  assert.doesNotMatch(t, /count as idle|full 30-day window/);
});

test('with meta.first_activity_at the projection follows the CLI rule', async () => {
  const rows = [day('2026-09-26', 3), day('2026-09-28', 3)];
  // Tracking began 09-26: 3 days, $6 → $60/mo.
  const began = text(await view({ meta: { days: 30, first_activity_at: '2026-09-26T14:00:00Z' }, daily_summaries: rows }));
  assert.match(began, /Projected to a month: \$60\.00\/mo/);
  assert.match(began, /Projected from 3 days of data — tracking began inside the 30-day window\./);
  // Tracking began long before the window: the full window, $6 → $6/mo.
  const longTime = text(await view({ meta: { days: 30, first_activity_at: '2026-01-02T14:00:00Z' }, daily_summaries: rows }));
  assert.match(longTime, /Projected to a month: \$6\.00\/mo/);
  assert.match(longTime, /Projected from the full 30-day window\./);
});

// Contract-B local rows are the server's calendar days (meta.tz), not UTC ones,
// and the note does not call them UTC.
test('daily_local rows project on the server calendar and the note does not say UTC', async () => {
  const local = (meta) => view({ meta: { days: 30, tz: 'America/New_York', ...meta },
    daily_local: [{ date: '2026-09-26', total_usd: 2, anchored_usd: 2, estimate_usd: 0, turn_count: 1 }] });
  // first_activity_at 02:00Z on 09-26 is 22:00 EDT on 09-25: 4 days, $2 → $15/mo.
  const began = text(await local({ first_activity_at: '2026-09-26T02:00:00Z' }));
  assert.match(began, /Projected to a month: \$15\.00\/mo/);
  assert.match(began, /Projected from 4 days of data — tracking began inside the 30-day window\./);
  // Without it, the first synced local day stands in: 09-26 … 09-28, 3 days → $20/mo.
  const flagged = text(await local({}));
  assert.match(flagged, /Projected to a month: \$20\.00\/mo/);
  assert.match(flagged, /Projected from 3 days of synced data, from 2026-09-26, your first synced day in the 30-day window/);
  assert.doesNotMatch(flagged, / UTC/);
});

test('an empty window names itself and gives no plan verdicts', async () => {
  const t = text(await view({ meta: { days: 7 }, daily_summaries: [] }));
  assert.match(t, /No synced usage in the last 7 days/);
  assert.doesNotMatch(t, /\/mo/);
});

// RC 0.3.2 (dash-prod): /whatif and /compare-models said `wtclaude sync` for an
// id with nothing synced, where every other page says `wtclaude sync --enable`.
// Rendered, the two pages' error state is now ErrorState's, word for word.
test('an unsynced id renders exactly what every other page renders for it', async () => {
  const info = describeError(edgeError('get-dashboard', 404, '{"error":"User not found"}'));
  const shared = text(await render(EMPTY_STATE, 'ErrorState', { info, fallbackTitle: "Couldn't load your dashboard" }));
  for (const fallback of ["Couldn't load What-If", "Couldn't load Compare Models"]) {
    const page = text(await render(EMPTY_STATE, 'default', loadErrorView(info, fallback)));
    assert.equal(page, shared);
  }
  assert.match(shared, /wtclaude sync --enable/);
});
