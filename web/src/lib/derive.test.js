// Unit tests for the dashboard derivations (web/src/lib/derive.js). The zone is
// pinned before any Date is used and every function takes an explicit `now`, so
// nothing here depends on today's date or the machine's zone.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dailyView, collapseByDate, sumRows, costBasis, yesterdayDelta, runRate, agentPool,
  dailyChart, peakBuckets, distinctSessionCount, costByModel, groupSessions,
  deviceLabel, deviceSummary, sessionsToCSV, dataFreshness, timelineDays, sessionWindowCost,
  isHashedBranch, sessionHeading, branchGroupLabel, branchDimLabel, HASHED_BRANCH_NOTE, viewTotals,
  monthlyProjectionBasis, turnCostBasis, sessionTurnSummary, turnListNote, NOT_SPLIT_KEY, modelSplitNote,
} from './derive.js';
import { priceTurn } from './compareModels.js';

// 22:30 EDT on 2026-07-13 is already 2026-07-14 in UTC — the case that broke.
const NOW = new Date('2026-07-13T22:30:00-04:00');
const round2 = (n) => Math.round(n * 100) / 100;

// A daily_summaries row as the pre-0.3.2 get-dashboard returns it (UTC dates).
function summary(date, cost, extra = {}) {
  return {
    date, usage_pool: 'interactive', estimated_cost_usd: cost, anchored_cost_usd: cost,
    estimated_only_cost_usd: 0, fast_cost_usd: 0, total_input_tokens: 10, total_output_tokens: 20,
    total_cache_read: 100, total_cache_write: 5, session_count: 1, turn_count: 2, models_used: {}, ...extra,
  };
}
// A daily_local row (contract B: local dates in meta.tz).
function local(date, total, extra = {}) {
  return {
    date, usage_pool: 'interactive', turn_count: 2, session_count: 1, anchored_usd: total,
    estimate_usd: 0, total_usd: total, input_tokens: 10, output_tokens: 20,
    cache_read_tokens: 100, cache_write_tokens: 5, models_used: {}, ...extra,
  };
}

// ── QA-0928-104: two usage pools on one date ───────────────────────────────
test('rows for two pools on one date collapse into one day', () => {
  const data = {
    meta: { days: 30 },
    daily_summaries: [
      summary('2026-07-13', 10), summary('2026-07-13', 5, { usage_pool: 'agent_sdk' }),
      summary('2026-07-14', 4), summary('2026-07-14', 6, { usage_pool: 'agent_sdk' }),
    ],
  };
  const view = dailyView(data, NOW);
  assert.equal(view.rows.length, 2);
  assert.deepEqual(view.rows.map((r) => [r.date, r.cost]), [['2026-07-13', 15], ['2026-07-14', 10]]);
  // Fallback payload: days are UTC, so "today" is the UTC date.
  assert.equal(view.local, false);
  assert.equal(view.today, '2026-07-14');
  const yd = yesterdayDelta(view);
  assert.equal(yd.todayCost, 10);
  assert.equal(yd.yesterdayCost, 15);
  assert.equal(round2(yd.pct), -33.33);
  const chart = dailyChart(view);
  assert.equal(chart.filter((d) => d.date === '2026-07-14').length, 1, 'one bar per date');
  assert.equal(collapseByDate(data.daily_summaries.map((r) => ({ date: r.date, cost: r.estimated_cost_usd }))).length, 2);
});

// ── QA-0928-25: run-rate over 14 CALENDAR days, idle days are $0 ─────────────
test('run-rate divides the last 14 calendar days by 14, not the last 14 rows', () => {
  // 14 rows spread over 28 days: every other day, $20 each; plus stale July rows.
  const rows = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(2026, 5, 16 + i * 2)); // 06-16 … 07-12
    rows.push(local(d.toISOString().slice(0, 10), 20));
  }
  const data = { meta: { days: 30, tz: 'America/New_York' }, daily_local: rows, daily_summaries: [] };
  const view = dailyView(data, NOW);
  assert.equal(view.local, true);
  assert.equal(view.today, '2026-07-13');
  const rr = runRate(view);
  // 06-30 … 07-13: rows on 06-30, 07-02 … 07-12 = 7 rows × $20 = $140 over 14 days.
  assert.equal(rr.days, 14);
  assert.equal(round2(rr.dailyAvg), 10);
  assert.equal(round2(rr.monthly), 300);
  assert.equal(rr.empty, false);
});

test('run-rate says so when the last 14 days hold no synced spend', () => {
  const data = { meta: { days: 90, tz: 'America/New_York' }, daily_local: [local('2026-05-01', 50)], daily_summaries: [] };
  const rr = runRate(dailyView(data, NOW));
  assert.equal(rr.empty, true);
  assert.equal(rr.monthly, 0);
});

test('run-rate never looks back further than the fetched window', () => {
  const data = { meta: { days: 7, tz: 'America/New_York', first_activity_at: '2026-01-02T12:00:00Z' }, daily_local: [local('2026-07-13', 14)], daily_summaries: [] };
  const rr = runRate(dailyView(data, NOW));
  assert.equal(rr.days, 7);
  assert.equal(rr.dailyAvg, 2);
});

// ── QA-0928-24: the Agent-SDK tile never projects interactive spend ──────────
test('agentPool only counts agent_sdk rows and reports nothing to forecast', () => {
  const none = agentPool(dailyView({ meta: { days: 30, tz: 'UTC' }, daily_local: [local('2026-07-13', 40)], daily_summaries: [] }, NOW));
  assert.equal(none.activated, false);
  assert.equal(none.hasData, false);
  assert.equal(none.monthly, 0);
  const some = agentPool(dailyView({
    meta: { days: 30, tz: 'America/New_York', first_activity_at: '2026-01-02T12:00:00Z' },
    daily_local: [local('2026-07-13', 40), local('2026-07-12', 14, { usage_pool: 'agent_sdk' })],
    daily_summaries: [],
  }, NOW));
  assert.equal(some.hasData, true);
  assert.equal(some.dailyAvg, 1);
});

// ── QA-0928-32 / 88: local days when the server sends daily_local ────────────
test('with daily_local, Today is the local day even after 20:00 EDT', () => {
  const data = {
    meta: { days: 30, tz: 'America/New_York' },
    daily_local: [local('2026-07-13', 30.2), local('2026-07-12', 12)],
    daily_summaries: [summary('2026-07-14', 30.2)],
  };
  const view = dailyView(data, NOW);
  const yd = yesterdayDelta(view);
  assert.equal(yd.todayCost, 30.2);
  assert.equal(yd.yesterdayCost, 12);
});

// ── QA-0928-89: badges describe the figure they sit on ───────────────────────
test('Today and the delta take their basis from their own rows', () => {
  const data = {
    meta: { days: 30, tz: 'America/New_York' },
    daily_local: [
      local('2026-07-13', 10),
      local('2026-07-12', 10, { anchored_usd: 0, estimate_usd: 10 }),
      local('2026-07-01', 10, { anchored_usd: 5, estimate_usd: 5 }),
    ],
    daily_summaries: [],
  };
  const view = dailyView(data, NOW);
  const yd = yesterdayDelta(view);
  assert.equal(yd.todayBasis.tier, 'billing-grade');
  assert.equal(yd.basis.tier, 'estimate', 'the delta takes the weaker of the two days');
  assert.equal(costBasis(sumRows(view.rows)).tier, 'mixed');
  assert.equal(costBasis({ cost: 0, anchored: 0 }).tier, 'billing-grade');
});

// ── QA-0928-92 / 103: zero-filled window, labelled by local date ─────────────
test('dailyChart zero-fills every day of the window', () => {
  const data = {
    meta: { days: 7, tz: 'America/New_York', window_start: '2026-07-07' },
    daily_local: [local('2026-07-08', 3), local('2026-07-13', 4)],
    daily_summaries: [],
  };
  const chart = dailyChart(dailyView(data, NOW));
  assert.equal(chart.length, 7);
  assert.equal(chart[0].date, '2026-07-07');
  assert.equal(chart[0].label, 'Jul 7');
  assert.equal(chart[0].cost, 0);
  assert.equal(chart[6].cost, 4);
  assert.equal(chart[0].fullLabel, 'Jul 7, 2026', 'the tooltip always names the year');
});

// RC 0.3.2 (dash-prod): the 365-day axis read 'Sep 29 … Sep 28' with no year,
// so its first and last ticks looked like the same day. A window that crosses
// a year boundary puts the year on every label.
test('dailyChart labels carry the year when the window crosses a year boundary', () => {
  const year = dailyChart(dailyView({ meta: { days: 365, tz: 'America/New_York' }, daily_local: [local('2026-07-13', 4)], daily_summaries: [] }, NOW));
  assert.equal(year.length, 365);
  assert.equal(year[0].label, 'Jul 14, 2025');
  assert.equal(year[year.length - 1].label, 'Jul 13, 2026');
  assert.ok(year.some((d) => d.label === 'Jan 1, 2026'));
  const jan = new Date('2026-01-05T15:00:00Z');
  const crossing = dailyChart(dailyView({ meta: { days: 7, tz: 'UTC' }, daily_summaries: [] }, jan));
  assert.equal(crossing[0].label, 'Dec 30, 2025');
  assert.equal(crossing[6].label, 'Jan 5, 2026');
  const within = dailyChart(dailyView({ meta: { days: 30, tz: 'America/New_York' }, daily_local: [], daily_summaries: [] }, NOW));
  assert.equal(within[0].label, 'Jun 14', 'one calendar year: no year on the ticks');
});

// ── QA-0928-27: sessions count once however many days they touch ────────────
test('distinctSessionCount counts a two-day session once', () => {
  const sessions = [{ id: 'a' }, { id: 'b' }, { id: 'a' }];
  assert.equal(distinctSessionCount(sessions), 2);
});

// ── QA-0928-28: Group by Model splits each session by turn share ─────────────
test('Group by Model sums to the session total and matches the donut', () => {
  const sessions = [
    { id: 's1', estimated_cost_usd: 10, turn_count: 4, total_input_tokens: 40, total_output_tokens: 40, models_used: { 'opus-5-5': 3, 'fable-5-1': 1 } },
    { id: 's2', estimated_cost_usd: 6, turn_count: 2, total_input_tokens: 10, total_output_tokens: 10, models_used: { 'opus-5-5': 2 } },
  ];
  const groups = groupSessions(sessions, 'model');
  const sum = groups.reduce((a, g) => a + g.cost, 0);
  assert.equal(round2(sum), 16);
  const fable = groups.find((g) => g.key === 'fable-5-1');
  assert.equal(round2(fable.cost), 2.5);
  assert.equal(fable.sessions, 1);
  assert.equal(fable.turns, 1);
  const donut = costByModel(sessions);
  assert.equal(donut.exact, false);
  assert.equal(round2(donut.slices.find((d) => d.name === 'fable-5-1').value), 2.5);
  const opus = groups.find((g) => g.key === 'opus-5-5');
  assert.equal(opus.turns, 5);
  assert.equal(opus.sessions, 2);
});

test('session views use the in-window cost when the server sends it', () => {
  const s = { estimated_cost_usd: 10, window_total_usd: 4, models_used: { a: 1 } };
  assert.equal(sessionWindowCost(s), 4);
  assert.equal(sessionWindowCost({ estimated_cost_usd: 10 }), 10);
  assert.equal(costByModel([s]).slices[0].value, 4);
});

// ── QA-0928-29: heatmaps bucket turn spend when the server sends it ──────────
test('peakBuckets uses hourly_local turn buckets when present', () => {
  const data = {
    hourly_local: [
      { dow: 1, hour: 10, total_usd: 73.73, turn_count: 5 },
      { dow: 2, hour: 10, total_usd: 1, turn_count: 1 },
      { dow: 1, hour: 8, total_usd: 50.22, turn_count: 5 },
    ],
    sessions: [{ started_at: '2026-07-13T12:00:00Z', estimated_cost_usd: 999 }],
  };
  const pk = peakBuckets(data);
  assert.equal(pk.basis, 'turn-time');
  assert.equal(round2(pk.hours[10].value), 74.73);
  assert.equal(round2(pk.days[1].value), 123.95);
  assert.equal(pk.hours[8].value, 50.22);
});

test('peakBuckets falls back to session start, flagged as such', () => {
  const pk = peakBuckets({ sessions: [{ started_at: '2026-07-13T12:00:00Z', estimated_cost_usd: 5 }] });
  assert.equal(pk.basis, 'session-start');
  assert.equal(pk.hours[8].value, 5); // 12:00Z = 08:00 EDT
  assert.equal(pk.days[1].value, 5);  // Monday
});

// ── QA-0928-123: short device labels; no false second device ─────────────────
test('deviceLabel shortens raw ids and names unattributed sessions', () => {
  assert.equal(deviceLabel('3fa2c4d1-0000-4000-8000-000000000000'), 'Device 3fa2…');
  assert.equal(deviceLabel('3fa2c4d1-0000-4000-8000-000000000000', '3fa2c4d1-0000-4000-8000-000000000000'), 'Device 3fa2…');
  assert.equal(deviceLabel('dev_1', 'Mac Studio'), 'Mac Studio');
  assert.equal(deviceLabel(null), 'Unattributed (older sessions)');
  assert.equal(deviceLabel('unknown', 'unknown'), 'Unattributed (older sessions)');
});

test('deviceSummary excludes the unattributed bucket from the device count', () => {
  const devices = [
    { device_id: 'aaaa1111-0000-4000-8000-000000000000', label: 'aaaa1111-0000-4000-8000-000000000000', session_count: 12, turn_count: 100, cost_usd: 250 },
    { device_id: 'unknown', label: 'unknown', session_count: 1, turn_count: 2, cost_usd: 1.5 },
  ];
  const sessions = [
    { anchored_cost_usd: 250, estimated_only_cost_usd: 0, estimated_cost_usd: 250, cost_basis: 'billing-grade' },
    { anchored_cost_usd: 0, estimated_only_cost_usd: 1.5, estimated_cost_usd: 1.5, cost_basis: 'estimate' },
  ];
  const sum = deviceSummary(devices, sessions);
  assert.equal(sum.attributed.length, 1);
  assert.equal(sum.unattributed.session_count, 1);
  assert.equal(round2(sum.combined.cost), 251.5);
  assert.equal(sum.combined.sessions, 13);
  assert.equal(sum.basis.tier, 'mixed', 'an estimate-only session in range is not billing-grade');
});

// ── QA-0928-162: CSV cells never start a formula ─────────────────────────────
test('sessionsToCSV neutralises formula-leading cells', () => {
  const csv = sessionsToCSV([{
    session_id: 's1', git_branch: '=HYPERLINK("http://example.invalid","x")', cost_center: '+1+1',
    device_label: '@SUM(A1)', started_at: '-2', ended_at: '\tx', estimated_cost_usd: 1.5,
  }]);
  const row = csv.split('\n')[1];
  assert.ok(row.includes(`"'=HYPERLINK(""http://example.invalid"",""x"")"`), row);
  assert.ok(row.includes("'+1+1"), row);
  assert.ok(row.includes("'@SUM(A1)"), row);
  assert.ok(row.includes("'-2"), row);
  assert.ok(row.includes("'\tx"), row);
  assert.ok(row.includes(',1.5,'), 'numbers are left alone');
});

// Same rule as the CLI's escapeCell (src/utils/export.js): a leading CR is
// neutralised AND quoted, and a negative number stays a number.
test('sessionsToCSV neutralises a leading CR and leaves negative numbers alone', () => {
  const csv = sessionsToCSV([{ session_id: 's1', cost_center: '\r=1+1', estimated_cost_usd: -10.69, turn_count: 3 }]);
  const row = csv.slice(csv.indexOf('\n') + 1);
  assert.ok(row.includes(`"'\r=1+1"`), JSON.stringify(row));
  assert.ok(row.includes(',-10.69,'), JSON.stringify(row));
  assert.ok(!row.includes("'-10.69"), 'a number is never prefixed');
});

// ── QA-0928-92 / 127: freshness from meta.last_activity_at ───────────────────
test('dataFreshness flags cloud data older than 24 hours', () => {
  const fresh = dataFreshness({ last_activity_at: '2026-07-13T20:00:00-04:00' }, NOW);
  assert.equal(fresh.known, true);
  assert.equal(fresh.stale, false);
  const stale = dataFreshness({ last_activity_at: '2026-07-10T20:00:00-04:00' }, NOW);
  assert.equal(stale.stale, true);
  assert.equal(dataFreshness({}, NOW).known, false);
});

// ── QA-0928-88: Timeline headings follow the local calendar day ──────────────
test('timelineDays groups by local date at 22:30 EDT', () => {
  const sessions = [
    { id: 'a', started_at: '2026-07-13T13:00:00Z', estimated_cost_usd: 1 }, // 09:00 EDT today
    { id: 'b', started_at: '2026-07-14T01:00:00Z', estimated_cost_usd: 2 }, // 21:00 EDT today
    { id: 'c', started_at: '2026-07-13T02:00:00Z', estimated_cost_usd: 3 }, // 22:00 EDT yesterday
  ];
  const days = timelineDays(sessions, NOW);
  assert.deepEqual(days.map((d) => [d.date, d.heading, d.sessions.length]), [
    ['2026-07-13', 'Today', 2],
    ['2026-07-12', 'Yesterday', 1],
  ]);
  const afternoon = timelineDays(sessions, new Date('2026-07-13T15:30:00-04:00'));
  assert.equal(afternoon[0].heading, 'Today');
});

// ── QA-0928-05 (0.3.2): synced branches are salted hashes ────────────────────
// After the 0.3.2 sync and migration 009, git_branch is '#' + 12 hex or null.
test('isHashedBranch recognises only the uploaded hash shape', () => {
  assert.equal(isHashedBranch('#0123456789ab'), true);
  assert.equal(isHashedBranch('main'), false);
  assert.equal(isHashedBranch('#main'), false);
  assert.equal(isHashedBranch('#0123456789abc'), false, 'exactly 12 hex characters');
  assert.equal(isHashedBranch(null), false);
});

test('sessionHeading labels a hashed branch as hashed, never as a name', () => {
  const h = sessionHeading({ git_branch: '#0123456789ab', session_id: 'abcdef012345-6789' });
  assert.equal(h.kind, 'Branch (hashed)');
  assert.equal(h.text, '#0123456789ab');
  assert.equal(h.title, HASHED_BRANCH_NOTE);
  assert.match(HASHED_BRANCH_NOTE, /hashed before upload/i);
});

test('sessionHeading falls back to the short session id when there is no branch', () => {
  for (const git_branch of [null, undefined, '']) {
    const h = sessionHeading({ git_branch, session_id: 'abcdef0123456789' }, 8);
    assert.deepEqual(h, { kind: 'Session', text: 'abcdef01', title: null });
  }
});

test('sessionHeading keeps a legacy raw name as a plain branch (pre-009 rows)', () => {
  const h = sessionHeading({ git_branch: 'main', session_id: 's1' });
  assert.deepEqual(h, { kind: 'Branch', text: 'main', title: null });
});

test('branchDimLabel says hashed only when every branch in view is a hash', () => {
  assert.equal(branchDimLabel(['#0123456789ab', '#ba9876543210']), 'Branch (hashed)');
  assert.equal(branchDimLabel(['#0123456789ab', null]), 'Branch (hashed)', 'a null branch is no raw name');
  assert.equal(branchDimLabel(['#0123456789ab', 'main']), 'Branch', 'legacy raw names stored before migration 009');
  assert.equal(branchDimLabel([]), 'Branch');
});

test('branchGroupLabel names the no-branch group instead of showing a dash', () => {
  assert.equal(branchGroupLabel('—'), 'No branch recorded');
  assert.equal(branchGroupLabel('#0123456789ab'), '#0123456789ab');
  const groups = groupSessions([
    { id: 'a', git_branch: null, estimated_cost_usd: 1, turn_count: 1 },
    { id: 'b', git_branch: '#0123456789ab', estimated_cost_usd: 2, turn_count: 1 },
  ], 'git_branch');
  assert.deepEqual(groups.map((g) => branchGroupLabel(g.key)), ['#0123456789ab', 'No branch recorded']);
});

// ── Optional get-dashboard fields (graceful when absent) ─────────────────────
// daily_local[].fast_usd / api_duration_ms: used as sent when the local rows
// carry them (a 0 is a real 0); otherwise the UTC daily_summaries fill in.
test('fast-mode share and active time come from daily_local when it carries them', () => {
  const data = {
    meta: { days: 30, tz: 'America/New_York' },
    daily_local: [local('2026-07-13', 10, { fast_usd: 0, api_duration_ms: 60_000 }), local('2026-07-12', 10, { fast_usd: 2, api_duration_ms: 30_000 })],
    daily_summaries: [summary('2026-07-14', 20, { fast_cost_usd: 9, api_duration_ms: 999_000 })],
  };
  const t = viewTotals(dailyView(data, NOW));
  assert.equal(t.fast, 2, 'the local fast_usd, not the UTC rows');
  assert.equal(t.apiMs, 90_000, 'the local api_duration_ms, not the UTC rows');
});

test('a daily_local fast_usd of 0 is a real zero, not a reason to fall back', () => {
  const data = {
    meta: { days: 30, tz: 'America/New_York' },
    daily_local: [local('2026-07-13', 10, { fast_usd: 0, api_duration_ms: 0 })],
    daily_summaries: [summary('2026-07-13', 10, { fast_cost_usd: 3, api_duration_ms: 5_000 })],
  };
  const t = viewTotals(dailyView(data, NOW));
  assert.equal(t.fast, 0);
  assert.equal(t.apiMs, 0);
});

test('without fast_usd / api_duration_ms on daily_local, the UTC rows fill in', () => {
  const data = {
    meta: { days: 30, tz: 'America/New_York' },
    daily_local: [local('2026-07-13', 10)],
    daily_summaries: [summary('2026-07-13', 6, { fast_cost_usd: 3, api_duration_ms: 5_000 }), summary('2026-07-14', 4, { api_duration_ms: 1_000 })],
  };
  const t = viewTotals(dailyView(data, NOW));
  assert.equal(t.fast, 3);
  assert.equal(t.apiMs, 6_000);
});

// meta.first_activity_at: tracking that began inside the look-back projects
// from the days since, as the CLI's coveredDays does (src/utils/window.js).
test('run-rate divides by the days since tracking began when that is inside the look-back', () => {
  const data = {
    meta: { days: 30, tz: 'America/New_York', first_activity_at: '2026-07-11T14:00:00Z' },
    daily_local: [local('2026-07-11', 6), local('2026-07-13', 3)],
    daily_summaries: [],
  };
  const rr = runRate(dailyView(data, NOW));
  assert.equal(rr.days, 3, '07-11 … 07-13');
  assert.equal(rr.sinceStart, true);
  assert.equal(rr.dailyAvg, 3);
  assert.equal(rr.monthly, 90);
});

test('first_activity_at is read as a local date in meta.tz', () => {
  // 02:00Z on 07-12 is 22:00 EDT on 07-11.
  const data = { meta: { days: 30, tz: 'America/New_York', first_activity_at: '2026-07-12T02:00:00Z' }, daily_local: [local('2026-07-13', 3)], daily_summaries: [] };
  assert.equal(runRate(dailyView(data, NOW)).days, 3);
});

test('a first activity before the look-back keeps the full 14 days', () => {
  const rows = [local('2026-07-13', 14)];
  const before = runRate(dailyView({ meta: { days: 30, tz: 'America/New_York', first_activity_at: '2026-03-01T12:00:00Z' }, daily_local: rows, daily_summaries: [] }, NOW));
  assert.equal(before.days, 14);
  assert.equal(before.sinceStart, false);
  assert.equal(before.exact, true);
  // Not sent (or unreadable), with a synced day before the look-back: 14 days.
  const early = [local('2026-06-20', 7), local('2026-07-13', 14)];
  const absent = runRate(dailyView({ meta: { days: 30, tz: 'America/New_York' }, daily_local: early, daily_summaries: [] }, NOW));
  assert.equal(absent.days, 14);
  assert.equal(absent.sinceStart, false);
  const junk = runRate(dailyView({ meta: { days: 30, tz: 'America/New_York', first_activity_at: 'not a date' }, daily_local: early, daily_summaries: [] }, NOW));
  assert.equal(junk.days, 14);
});

// RC 0.3.2 (dash-prod): today's server sends no meta.first_activity_at, and the
// run-rate then divided by all 14 days even when the first synced day was 3
// days ago — anyone tracked for under 14 days read up to 14x low. The first
// synced day in the fetched window stands in for "tracking began", flagged as
// inexact so the page can say it is the window's first synced day.
test('without first_activity_at the run-rate counts from the first synced day in the window', () => {
  const data = { meta: { days: 30 }, daily_summaries: [summary('2026-07-12', 6), summary('2026-07-14', 3)] };
  const rr = runRate(dailyView(data, NOW));
  assert.equal(rr.days, 3, 'UTC 07-12 … 07-14');
  assert.equal(rr.sinceStart, true);
  assert.equal(rr.exact, false);
  assert.equal(rr.firstDate, '2026-07-12');
  assert.equal(rr.dailyAvg, 3);
  assert.equal(rr.monthly, 90);
});

// ── RC 0.3.2 (dash-prod): What If's /mo basis on today's server ──────────────
// Without meta.first_activity_at the page divided by the whole selected window.
// With the 365-day option that read several times below `wtclaude whatif --days 365`
// for a user whose data starts inside the window (everyone, at 365 days).
test('monthlyProjectionBasis on a pre-0.3.2 payload counts from the first synced day in the window', () => {
  // UTC today is 2026-07-14; the 365-day window opens 2025-07-15. Day 240 of it:
  const first = '2026-03-11';
  const data = { meta: { days: 365 }, daily_summaries: [summary(first, 100), summary('2026-07-01', 50)] };
  const b = monthlyProjectionBasis(dailyView(data, NOW));
  assert.equal(b.covered, 126, '2026-03-11 … 2026-07-14 inclusive');
  assert.notEqual(b.covered, 365, 'never the whole window when data starts later');
  assert.equal(b.exact, false);
  assert.equal(b.firstDate, first);
  assert.match(b.note, /^Projected from 126 days of synced data, from 2026-03-11 UTC/);
  assert.match(b.note, /this server doesn't say when tracking began/);
  assert.doesNotMatch(b.note, /count as idle/);
});

test('monthlyProjectionBasis mirrors the CLI note when the server sends first_activity_at', () => {
  const began = { meta: { days: 30, tz: 'America/New_York', first_activity_at: '2026-07-11T14:00:00Z' }, daily_local: [local('2026-07-11', 6)], daily_summaries: [] };
  const b = monthlyProjectionBasis(dailyView(began, NOW));
  assert.equal(b.covered, 3);
  assert.equal(b.exact, true);
  assert.equal(b.note, 'Projected from 3 days of data — tracking began inside the 30-day window');
  const longTime = { meta: { days: 30, tz: 'America/New_York', first_activity_at: '2026-01-02T14:00:00Z' }, daily_local: [local('2026-07-11', 6)], daily_summaries: [] };
  const l = monthlyProjectionBasis(dailyView(longTime, NOW));
  assert.equal(l.covered, 30, 'a long-time user whose window opens on idle days: the full window, as the CLI');
  assert.equal(l.note, 'Projected from the full 30-day window');
});

test('monthlyProjectionBasis: a window synced from its first day uses the full window; no data is null', () => {
  const full = { meta: { days: 7 }, daily_summaries: [summary('2026-07-08', 1), summary('2026-07-14', 1)] };
  const b = monthlyProjectionBasis(dailyView(full, NOW));
  assert.equal(b.covered, 7);
  assert.equal(b.note, 'Projected from the full 7-day window');
  assert.equal(monthlyProjectionBasis(dailyView({ meta: { days: 30 }, daily_summaries: [] }, NOW)), null);
});

test('the Agent-SDK pool uses the same covered days', () => {
  const data = {
    meta: { days: 30, tz: 'America/New_York', first_activity_at: '2026-07-12T13:00:00Z' },
    daily_local: [local('2026-07-12', 4, { usage_pool: 'agent_sdk' })],
    daily_summaries: [],
  };
  const a = agentPool(dailyView(data, NOW));
  assert.equal(a.days, 2);
  assert.equal(a.dailyAvg, 2);
});

// devices[].anchored_usd / estimate_usd (contract B): the Combined badge takes
// the in-window mix the server sends, matching the Combined figure it sits on.
test('deviceSummary takes its basis from the per-device window mix when sent', () => {
  const devices = [
    { device_id: 'aaaa1111', session_count: 1, turn_count: 5, cost_usd: 10, anchored_usd: 10, estimate_usd: 0 },
    { device_id: 'bbbb2222', session_count: 1, turn_count: 5, cost_usd: 5, anchored_usd: 0, estimate_usd: 5 },
  ];
  // Whole-session figures say all billing-grade; the window mix says otherwise.
  const sessions = [{ estimated_cost_usd: 40, anchored_cost_usd: 40, estimated_only_cost_usd: 0, cost_basis: 'billing-grade' }];
  const sum = deviceSummary(devices, sessions);
  assert.equal(sum.basis.tier, 'mixed');
  assert.equal(sum.basis.pct, 67);
  const legacy = deviceSummary(devices.map((d) => ({ ...d, anchored_usd: undefined, estimate_usd: undefined })), sessions);
  assert.equal(legacy.basis.tier, 'billing-grade', 'without the fields, the sessions decide as before');
});

// ── RC 0.3.2 (e2e-local): session detail per-turn cost basis ─────────────────
// Mirror of the CLI's turnCostBasis (src/utils/cost.js) on a synced turn row: the
// anchor is billing-grade; an unanchored turn is the list-rate estimate the CLI
// sent (cost_estimate_usd), or — with no estimate on the row — the estimate from
// its tokens when the rate sheet can price its model; a model it can't price is
// not priced. A legacy "$0 anchor" with no cumulative figure is not an anchor.
// (Pinned against the CLI function itself in turnCostBasis.test.js.)
test('turnCostBasis reads a synced turn the way `wtclaude session` does', () => {
  const tok = { input_tokens: 2000, output_tokens: 1000 };
  assert.deepEqual(turnCostBasis({ ...tok, cost_usd: 0.12, cumulative_cost_usd: 2.5 }), { usd: 0.12, basis: 'billing-grade' });
  assert.deepEqual(turnCostBasis({ ...tok, cost_usd: 0, cumulative_cost_usd: 2.5 }), { usd: 0, basis: 'billing-grade' });
  assert.deepEqual(turnCostBasis({ ...tok, cost_usd: null, cumulative_cost_usd: null, cost_estimate_usd: 0.04 }), { usd: 0.04, basis: 'estimated' });
  assert.deepEqual(turnCostBasis({ ...tok, model: 'claude-mystery-9', cost_usd: null, cumulative_cost_usd: null, cost_estimate_usd: null }), { usd: null, basis: 'not-priced' });
  assert.deepEqual(turnCostBasis({ ...tok, model: 'claude-mystery-9', cost_usd: 0, cumulative_cost_usd: null }), { usd: null, basis: 'not-priced' }, 'legacy $0 anchor, unpriceable model');
  assert.deepEqual(turnCostBasis({ input_tokens: 0, output_tokens: 0, cost_usd: null }), { usd: 0, basis: 'estimated' }, 'no tokens costs zero on any rate');
  // RC 0.3.2 regression: no estimate on the row is not "not priced" for a model
  // the rate sheet prices; it is that model's list-rate estimate.
  const list = priceTurn('claude-opus-5-5', tok).usd;
  assert.ok(list > 0);
  assert.deepEqual(turnCostBasis({ ...tok, model: 'claude-opus-5-5', cost_usd: null, cumulative_cost_usd: null }), { usd: list, basis: 'estimated' });
  assert.deepEqual(turnCostBasis({ ...tok, model: 'claude-opus-5-5', cost_usd: 0, cumulative_cost_usd: null }), { usd: list, basis: 'estimated' }, 'legacy $0 anchor, priceable model');
});

// ── RC 0.3.2: the session-detail note says where a turn sits in the header ───
// The header total is the session's stored total. A session synced by 0.3.1
// carries the total that version worked out (it counted a legacy $0 row as $0
// and priced a family-fallback model by its guess), so "counts zero in the total
// above" is said only when the turn list adds up to that total. Synthetic rows.
const TOK2 = { input_tokens: 2000, output_tokens: 800 };
const anchoredTurn = (turn, usd) => ({ turn, model: 'claude-opus-4-8', ...TOK2, cost_usd: usd, cumulative_cost_usd: 1 });

test('sessionTurnSummary: a 0.3.1 session whose total includes the estimate reads as estimated, not "not priced"', () => {
  const est = priceTurn('claude-opus-4-8', TOK2).usd;
  const turns = [anchoredTurn(1, 0.14), { turn: 2, model: 'claude-opus-4-8', ...TOK2, cost_usd: null, cumulative_cost_usd: null }];
  const sum = sessionTurnSummary({ estimated_cost_usd: 0.14 + est, turn_count: 2 }, turns);
  assert.equal(sum.estimatedTurns, 1);
  assert.equal(sum.notPricedTurns, 0);
  assert.equal(sum.reconciles, true);
  const note = turnListNote(sum, (v) => `$${v.toFixed(3)}`);
  assert.equal(note, "1 turn without Claude Code's cost figure is estimated from list rates.");
  assert.doesNotMatch(note, /not priced|counts zero/);
});

test('sessionTurnSummary: an excluded turn counts zero in the total above only when the list adds up to it', () => {
  const fc = (v) => `$${v.toFixed(3)}`;
  const turns = [anchoredTurn(1, 0.14), { turn: 2, model: 'claude-mystery-9', ...TOK2, cost_usd: null, cumulative_cost_usd: null, cost_estimate_usd: null }];
  const ok = sessionTurnSummary({ estimated_cost_usd: 0.14, turn_count: 2 }, turns);
  assert.equal(ok.reconciles, true);
  assert.deepEqual(ok.notPricedModels, ['claude-mystery-9']);
  assert.equal(turnListNote(ok, fc),
    '1 turn is not priced (claude-mystery-9): no cost figure and no rate we can stand behind, so it counts zero in the total above.');
  // An older total that priced it anyway: no claim about the header; the gap is named.
  const legacy = sessionTurnSummary({ estimated_cost_usd: 0.2, turn_count: 2 }, turns);
  assert.equal(legacy.reconciles, false);
  const note = turnListNote(legacy, fc);
  assert.doesNotMatch(note, /in the total above\./);
  assert.match(note, /so wtclaude session counts it as zero\./);
  assert.match(note, /These turns add up to \$0\.140, not the \$0\.200 above: that total was worked out when the session was synced/);
});

test('sessionTurnSummary: a partial turn list is not reconciled, and the gap line is left to the partial-list note', () => {
  const turns = [anchoredTurn(1, 0.14), { turn: 2, model: 'claude-mystery-9', ...TOK2, cost_usd: null }];
  const sum = sessionTurnSummary({ estimated_cost_usd: 0.5, turn_count: 3, total_turns: 3 }, turns);
  assert.equal(sum.complete, false);
  assert.equal(sum.reconciles, false);
  const note = turnListNote(sum, (v) => `$${v.toFixed(2)}`);
  assert.match(note, /counts it as zero\.$/);
  assert.doesNotMatch(note, /add up to/);
  assert.equal(turnListNote(sessionTurnSummary({ estimated_cost_usd: 0.14, turn_count: 1 }, [anchoredTurn(1, 0.14)])), null);
});

// ── RC 0.3.2 (e2e-local): Cost by model and a model the CLI names 'Not priced' ─
// The payload has no per-model cost, so each session's in-window cost is split
// by turn share. An unanchored turn on a model the rate sheet can't price is
// excluded by the CLI ($0, 'Not priced'), but the split gave it the same share
// as a priced turn: a dollar figure for a real zero. (Synthetic sessions.)
//
// Follow-up (RC 0.3.2 regression): the fix gave such a model $0 and 'not priced'
// in every session with an unanchored turn, and its share to the priced models —
// but in a MIXED session its turns may be the anchored ones (a model newer than
// the rate sheet, running under Claude Code, carries Claude Code's cost). The
// payload can't say which, so there its share is neither its own nor the other
// models': it is shown as 'not split by model', and the model is 'not split',
// with no claim that its turns carry no cost. Only where no turn carries the
// anchor (cost_basis 'estimate') is it certainly not priced.
const MIXED = {
  id: 'm1', cost_basis: 'mixed', window_total_usd: 3, estimated_cost_usd: 3, turn_count: 22,
  total_input_tokens: 2200, total_output_tokens: 220,
  models_used: { 'claude-opus-5-5[1m]': 20, 'claude-opus-5-5': 1, 'claude-mystery-9': 1 },
};

test('costByModel: in a mixed session an unpriceable model gets no dollars and is not split, not "not priced"', () => {
  const r = costByModel([MIXED]);
  assert.equal(r.exact, false, 'a turn-share split is approximate');
  assert.deepEqual(r.notPriced, []);
  assert.deepEqual(r.unsplitModels, ['claude-mystery-9']);
  const mystery = r.slices.find((d) => d.name === 'claude-mystery-9');
  assert.equal(mystery.value, 0, 'no dollar figure for a model that may be a real zero');
  assert.equal(mystery.notSplit, true);
  assert.equal(mystery.notPriced, false);
  const bucket = r.slices.find((d) => d.name === NOT_SPLIT_KEY);
  assert.equal(round2(bucket.value), round2(3 / 22));
  assert.equal(round2(r.unsplit), round2(3 / 22));
  assert.equal(round2(r.slices.find((d) => d.name === 'claude-opus-5-5').value), round2(3 / 22), 'a priced model keeps its own share, no more');
  assert.equal(round2(r.slices.reduce((a, d) => a + d.value, 0)), 3, 'the slices, with the unsplit share, sum to the session cost');
  const g = groupSessions([MIXED], 'model');
  const gm = g.find((x) => x.key === 'claude-mystery-9');
  assert.equal(gm.cost, 0);
  assert.equal(gm.notSplit, true);
  assert.equal(gm.notPriced, false);
  assert.equal(gm.turns, 1);
  const gb = g.find((x) => x.key === NOT_SPLIT_KEY);
  assert.equal(gb.bucket, true);
  assert.equal(gb.sessions, 1);
  assert.equal(round2(g.reduce((a, x) => a + x.cost, 0)), 3);
});

// The regression probe: a model newer than the rate sheet (family fallback)
// whose turns carry Claude Code's cost, plus one unanchored priced turn.
test('costByModel: a new model\'s anchored turns in a mixed session are never called "not priced" nor handed to the other model', () => {
  const s = {
    id: 'p1', cost_basis: 'mixed', window_total_usd: 5, estimated_cost_usd: 5, turn_count: 11,
    total_input_tokens: 1100, total_output_tokens: 110, models_used: { 'claude-opus-5-6': 10, 'claude-opus-5-5': 1 },
  };
  const r = costByModel([s]);
  const nu = r.slices.find((d) => d.name === 'claude-opus-5-6');
  assert.equal(nu.notPriced, false);
  assert.equal(nu.notSplit, true);
  assert.equal(round2(r.slices.find((d) => d.name === 'claude-opus-5-5').value), round2(5 / 11), 'not the whole $5');
  assert.equal(round2(r.slices.find((d) => d.name === NOT_SPLIT_KEY).value), round2(50 / 11));
  const g = groupSessions([s], 'model');
  assert.equal(g.find((x) => x.key === 'claude-opus-5-6').notPriced, false);
  assert.equal(round2(g.find((x) => x.key === 'claude-opus-5-5').cost), round2(5 / 11));
  assert.match(modelSplitNote(r), /opus-5-6 has no rate we can stand behind/);
  assert.match(modelSplitNote(r), /not split by model/);
  assert.doesNotMatch(modelSplitNote(r), /carr(y|ies) no Claude Code cost/);
});

test('costByModel: where no turn carries the anchor, an unpriceable model is not priced and the estimate is the priced models\'', () => {
  const est = { ...MIXED, id: 'e1', cost_basis: 'estimate' };
  const r = costByModel([est]);
  assert.deepEqual(r.notPriced, ['claude-mystery-9']);
  assert.deepEqual(r.unsplitModels, []);
  assert.equal(r.slices.find((d) => d.name === NOT_SPLIT_KEY), undefined);
  assert.equal(round2(r.slices.find((d) => d.name === 'claude-opus-5-5').value), round2(3 / 21));
  assert.equal(round2(r.slices.reduce((a, d) => a + d.value, 0)), 3);
  const g = groupSessions([est], 'model');
  assert.equal(g.find((x) => x.key === 'claude-mystery-9').notPriced, true);
  // A $0 estimate session of unpriceable turns only: all not priced.
  const zero = costByModel([{ ...est, id: 'e2', window_total_usd: 0, estimated_cost_usd: 0, models_used: { 'claude-mystery-9': 2 } }]);
  assert.deepEqual(zero.notPriced, ['claude-mystery-9']);
});

test('costByModel keeps an unpriceable model\'s share when every turn carries the cost anchor', () => {
  const anchored = { ...MIXED, id: 'b1', cost_basis: 'billing-grade', window_total_usd: 3, models_used: { 'claude-opus-5-5': 2, 'claude-mystery-9': 1 } };
  const r = costByModel([anchored]);
  assert.deepEqual(r.notPriced, []);
  assert.deepEqual(r.unsplitModels, []);
  assert.equal(r.slices.find((d) => d.name === 'claude-mystery-9').value, 1);
  // A mixed session whose models are all unpriceable still shows its cost somewhere.
  const only = costByModel([{ ...MIXED, id: 'u1', models_used: { 'claude-mystery-9': 2 }, window_total_usd: 1 }]);
  assert.equal(only.slices.find((d) => d.name === NOT_SPLIT_KEY).value, 1);
  // A model priced in one session and not split in another shows its priced
  // share and is marked as having more under 'not split by model'.
  const both = costByModel([anchored, MIXED]);
  const m = both.slices.find((d) => d.name === 'claude-mystery-9');
  assert.equal(m.value, 1);
  assert.equal(m.partlyUnsplit, true);
  assert.equal(m.notSplit, false);
});

test('modelSplitNote says what the per-model figures are', () => {
  assert.equal(modelSplitNote({ exact: true, unsplitModels: [] }), 'Per-model sums of the turns in this window.');
  assert.equal(modelSplitNote({ exact: false, unsplitModels: [] }), 'Approximate: each session’s cost in this window is split across its models by turn count.');
  assert.match(modelSplitNote({ exact: false, unsplitModels: ['claude-a-1', 'claude-b-2'] }), /a-1 and b-2 have no rate we can stand behind/);
});

// With per-model in-window sums from the server (window_models) the figures are
// exact, and a model whose turns were all excluded is not priced.
test('costByModel and groupSessions use window_models sums when the server sends them', () => {
  const s = {
    ...MIXED,
    window_models: {
      'claude-opus-5-5[1m]': { usd: 2.96, turns: 20, excluded_turns: 0, input_tokens: 2000, output_tokens: 200 },
      'claude-opus-5-5': { usd: 0.04, turns: 1, excluded_turns: 0, input_tokens: 100, output_tokens: 10 },
      'claude-mystery-9': { usd: 0, turns: 1, excluded_turns: 1, input_tokens: 100, output_tokens: 10 },
    },
  };
  const r = costByModel([s]);
  assert.equal(r.exact, true);
  assert.deepEqual(r.notPriced, ['claude-mystery-9']);
  assert.equal(r.slices.find((d) => d.name === 'claude-opus-5-5').value, 0.04);
  const g = groupSessions([s], 'model');
  assert.equal(g.find((x) => x.key === 'claude-opus-5-5[1m]').tokens, 2200);
  assert.equal(g.find((x) => x.key === 'claude-mystery-9').notPriced, true);
  // One session without the field makes the whole view approximate.
  assert.equal(costByModel([s, { ...MIXED, id: 'x' }]).exact, false);
});
