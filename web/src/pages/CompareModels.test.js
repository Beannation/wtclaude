// Compare Models render tests (node --test via src/test-support/jsx.js).
process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, text } from '../test-support/jsx.js';

const PAGE = new URL('./CompareModels.jsx', import.meta.url);
const NOW = new Date('2026-09-28T16:00:00Z');
const day = (date, usd) => ({ date, estimated_cost_usd: usd, anchored_cost_usd: usd, estimated_only_cost_usd: 0, turn_count: 4 });

// A session that began before the window and ran into it (synthetic). Its
// whole-session totals are 25x its in-window tokens.
const straddling = {
  id: 's-straddle', models_used: { 'claude-opus-5-5': 12 }, turn_count: 12,
  total_input_tokens: 40_000_000, total_output_tokens: 2_000_000, total_cache_read: 30_000_000, total_cache_write: 3_000_000,
  window_turn_count: 2,
  window_input_tokens: 1_600_000, window_output_tokens: 80_000, window_cache_read_tokens: 1_200_000, window_cache_write_tokens: 120_000,
};

// RC 0.3.2 (dash-prod): the page re-priced each session's WHOLE tokens, so a
// session that straddled the window counted turns from before it, and the
// token count differed from `wtclaude compare-models --days N`. With the
// server's window_* fields (contract B) it re-prices the in-window turns.
test('a straddling session is re-priced on its in-window tokens', async () => {
  const data = { meta: { days: 30 }, daily_summaries: [day('2026-09-27', 12)], sessions: [straddling] };
  const t = text(await render(PAGE, 'CompareModelsView', { data, currency: 'USD', now: NOW }));
  // 1.6M + 80K + 1.2M + 120K = 3.0M, not the session's 75.0M.
  assert.match(t, /3\.0M recorded tokens/);
  assert.doesNotMatch(t, /75\.0M/);
  assert.match(t, /Billed in the last 30 days \(days are UTC\): \$12\.00/);
});

test('an older server without window_* fields still gets a comparison, on whole-session tokens', async () => {
  const old = Object.fromEntries(Object.entries(straddling).filter(([k]) => !k.startsWith('window_')));
  const data = { meta: { days: 30 }, daily_summaries: [day('2026-09-27', 12)], sessions: [old] };
  const t = text(await render(PAGE, 'CompareModelsView', { data, currency: 'USD', now: NOW }));
  assert.match(t, /75\.0M recorded tokens/);
});

test('an empty window names itself', async () => {
  const data = { meta: { days: 90 }, daily_summaries: [], sessions: [] };
  const t = text(await render(PAGE, 'CompareModelsView', { data, currency: 'USD', now: NOW }));
  assert.match(t, /No synced usage in the last 90 days/);
});

// RC 0.3.2 (dash-prod): the comparison's /mo basis is derive's coveredDays on
// dailyView, the Overview's and /whatif's rule, never the whole window for
// data that starts inside it. This page withholds its dollar figures, so no
// rendered text shows the basis: comparisonFor is what CompareModelsView
// renders from, and covered_days is the basis the comparison carries. Each
// case would read the whole window (30 or 365) on the old basis.
const sparse = ['2026-09-06', '2026-09-08', '2026-09-10', '2026-09-12', '2026-09-14', '2026-09-16',
  '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-09-28'].map((d) => day(d, 10));
const coveredFor = async (data) => {
  const { comparisonFor } = await import(String(PAGE));
  return comparisonFor({ sessions: [straddling], ...data }, NOW).cmp.surfaces.code.covered_days;
};

test('the comparison covers the days since the first synced day when the server does not say when tracking began', async () => {
  // 15 active days, the first on 2026-09-06: 23 days, not the 30-day window.
  assert.equal(await coveredFor({ meta: { days: 30 }, daily_summaries: sparse }), 23);
  // A 365-day window whose data starts on its day 240: 126 days, not 365.
  assert.equal(await coveredFor({ meta: { days: 365 }, daily_summaries: [day('2026-05-26', 100), day('2026-09-01', 26)] }), 126);
  // Data from the window's first day: the whole window.
  assert.equal(await coveredFor({ meta: { days: 30 }, daily_summaries: [day('2026-08-30', 1), ...sparse] }), 30);
});

test('with meta.first_activity_at the comparison covers the days the CLI does', async () => {
  const rows = [day('2026-09-26', 3), day('2026-09-28', 3)];
  // Tracking began 09-26: 3 days (`wtclaude compare-models --days 30` says the same).
  assert.equal(await coveredFor({ meta: { days: 30, first_activity_at: '2026-09-26T14:00:00Z' }, daily_summaries: rows }), 3);
  // Tracking began long before the window: the whole window.
  assert.equal(await coveredFor({ meta: { days: 30, first_activity_at: '2026-01-02T14:00:00Z' }, daily_summaries: rows }), 30);
  // Local rows read first_activity_at on the server's calendar (meta.tz):
  // 02:00Z on 09-26 is 22:00 EDT on 09-25, so 09-25 … 09-28.
  const local = { meta: { days: 30, tz: 'America/New_York', first_activity_at: '2026-09-26T02:00:00Z' },
    daily_local: [{ date: '2026-09-26', total_usd: 1, anchored_usd: 1, estimate_usd: 0, turn_count: 1 }] };
  assert.equal(await coveredFor(local), 4);
});

test('a window with no synced day keeps the whole window as its basis', async () => {
  assert.equal(await coveredFor({ meta: { days: 30 }, daily_summaries: [] }), 30);
});
