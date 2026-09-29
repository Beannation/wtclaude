// Fixed zone first, so nothing here depends on the machine: the pages read
// first_activity_at on the server calendar (meta.tz), never the browser zone.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as compareModels from '../../web/src/lib/compareModels.js';
import { dailyView, monthlyProjectionBasis, coveredDays } from '../../web/src/lib/derive.js';
import { describeError, edgeError, ApiError } from '../../web/src/lib/errors.js';
import { coveredDays as cliCoveredDays, projectionNote as cliProjectionNote } from '../utils/window.js';

const { windowDays, billedFromPayload, billedLabel, deltaTone, fmtPct, loadErrorView } = compareModels;

// ───────────────────────────────────────────────────────────────────────────
// Pure helpers behind /compare-models and /whatif (BUILD-018), and the shared
// /mo rule both pages call (derive.monthlyProjectionBasis / coveredDays on
// dailyView). The rule's cases below pin the rule and its parity with the CLI;
// they read derive directly, so they would pass on a page that ignored it.
// That the pages call it is pinned where the pages run: the render tests in
// web/src/pages (WhatIf.test.js: the /mo figure and note; CompareModels.test.js:
// comparisonFor's covered_days), in the web suite, plus the source check below.
//  • QA-0928-26: /mo figures scaled by 30 ÷ (days WITH usage) — daily rows exist
//    only for active days — so a month with idle days read well above the CLI.
//  • RC 0.3.2 (dash-prod): the second fix divided by the whole requested window
//    whenever the server did not say when tracking began ("earlier days count
//    as idle"). Today's server never says, so a 365-day window read several
//    times below `wtclaude whatif --days 365` for anyone tracked for under a year.
//    Both pages now read the Overview's rule (derive.monthlyProjectionBasis /
//    coveredDays): meta.first_activity_at when sent — the CLI rule exactly —
//    else the first synced day in the window, flagged as not exact.
//  • Contract B: without daily_local the days are UTC, and the page says so.
//  • QA-0928-93: an empty window must not show "$0.000/mo" and plan verdicts.
//  • QA-0928-107: the billed total is the page's one absolute figure.
//  • QA-0928-183: a 0% row is neutral, not a saving.
//  • Unsynced / unknown ids: the shared description from errorInfo, the same
//    command every other page gives, never raw JSON.
// ───────────────────────────────────────────────────────────────────────────

// Noon UTC on 2026-09-28: "today" on the UTC calendar and in New York alike.
const NOW = new Date('2026-09-28T16:00:00Z');
// The rule /whatif shows (monthlyProjectionBasis) and /compare-models divides
// by (coveredDays(...).days), for a payload at NOW.
const pageBasis = (data) => monthlyProjectionBasis(dailyView(data, NOW));
const compareCovered = (data) => coveredDays(dailyView(data, NOW)).days;

// 15 active days (synthetic: every other day from 09-06, then daily from
// 09-20) in the 30-day window 2026-08-30..09-28, which opens on idle days.
const sparseDays = ['2026-09-06', '2026-09-08', '2026-09-10', '2026-09-12', '2026-09-14', '2026-09-16',
  '2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27',
  '2026-09-28'];
const row = (date, total, anchored = total) => ({ date, estimated_cost_usd: total, anchored_cost_usd: anchored, estimated_only_cost_usd: total - anchored, turn_count: 3 });

test('RC 0.3.2: compareModels.js keeps no projection basis of its own, so there is one rule for every page', () => {
  assert.equal(compareModels.projectionBasis, undefined, 'the "earlier days count as idle" basis is gone');
  assert.equal(compareModels.coveredDaysFromPayload, undefined);
  const here = new URL('../../web/src/pages/', import.meta.url);
  // Code only: a call left behind in a comment must not satisfy the match.
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const whatIf = code(readFileSync(new URL('WhatIf.jsx', here), 'utf8'));
  const compare = code(readFileSync(new URL('CompareModels.jsx', here), 'utf8'));
  assert.match(whatIf, /monthlyProjectionBasis\(dailyView\(/, '/whatif reads the shared basis');
  assert.match(compare, /coveredDays\(dailyView\([^)]*\)\)\.days/, '/compare-models divides by the shared covered days');
  for (const src of [whatIf, compare]) {
    assert.match(src, /from '\.\.\/lib\/derive'/);
    assert.doesNotMatch(src, /\bprojectionBasis\(|coveredDaysFromPayload/);
  }
});

test('QA-0928-26: a 15-row payload that opens on idle days divides by the days since its first synced day, never by 15', () => {
  const data = { meta: { days: 30 }, daily_summaries: sparseDays.map(d => row(d, 10)) };
  assert.equal(sparseDays.length, 15);
  assert.equal(windowDays(data), 30);
  const basis = pageBasis(data);
  // 09-06 … 09-28 inclusive. The server doesn't say when tracking began, so the
  // first synced day stands in, flagged: the page says so and says which way
  // the figure moves if tracking began earlier.
  assert.equal(basis.covered, 23);
  assert.equal(basis.exact, false);
  assert.equal(compareCovered(data), 23);
  assert.equal(basis.note, 'Projected from 23 days of synced data, from 2026-09-06 UTC, your first synced day in the 30-day window '
    + "(this server doesn't say when tracking began; if it began earlier, the monthly figure is lower)");
  assert.doesNotMatch(basis.note, /count as idle/);
  assert.equal(windowDays({ meta: {} }), 30, 'mock / older payloads default to 30');
  assert.equal(windowDays({ meta: { days: 7 } }), 7);
});

test('RC 0.3.2: a 365-day window whose data starts on day 240 divides by 126 days, not 365', () => {
  // The window opens 2025-09-29; its day 240 is 2026-05-26.
  const data = { meta: { days: 365 }, daily_summaries: [row('2026-05-26', 100), row('2026-09-01', 26)] };
  const basis = pageBasis(data);
  assert.equal(basis.covered, 126, '2026-05-26 … 2026-09-28 inclusive');
  assert.equal(compareCovered(data), 126);
  // $126 billed: $30/mo on this basis; the old whole-window basis said about $10.36.
  const billed = billedFromPayload(data).usd;
  assert.equal((billed / basis.covered) * 30, 30);
  assert.match(basis.note, /^Projected from 126 days of synced data, from 2026-05-26 UTC/);
});

test('QA-0928-26: a window whose first day has usage uses the full window', () => {
  const data = { meta: { days: 30 }, daily_summaries: ['2026-08-30', ...sparseDays].map(d => row(d, 10)) };
  assert.equal(pageBasis(data).note, 'Projected from the full 30-day window');
  assert.equal(compareCovered(data), 30);
});

test('QA-0928-22 on the web: with meta.first_activity_at the pages follow the CLI rule exactly', () => {
  const data = { meta: { days: 30 }, daily_summaries: [row('2026-09-26', 5), row('2026-09-28', 5)] };
  const cli = (first) => {
    const covered = cliCoveredDays(30, first, '2026-09-28');
    const note = cliProjectionNote(covered, 30);
    return { covered, note: note[0].toUpperCase() + note.slice(1) };
  };
  // Tracking began 09-26: three days, said as the CLI says it.
  const began = { ...data, meta: { days: 30, first_activity_at: '2026-09-26T14:00:00Z' } };
  assert.deepEqual({ covered: pageBasis(began).covered, note: pageBasis(began).note }, cli('2026-09-26'));
  assert.equal(pageBasis(began).note, 'Projected from 3 days of data — tracking began inside the 30-day window');
  assert.equal(compareCovered(began), 3);
  // Tracking began before the window, which opens on idle days: the full window.
  const longTime = { ...data, meta: { days: 30, first_activity_at: '2026-03-01T14:00:00Z' } };
  assert.deepEqual({ covered: pageBasis(longTime).covered, note: pageBasis(longTime).note }, cli('2026-03-01'));
  assert.equal(compareCovered(longTime), 30);
  // Local rows read first_activity_at on the server's calendar (meta.tz):
  // 02:00Z on 09-26 is 22:00 EDT on 09-25.
  const local = { meta: { days: 30, tz: 'America/New_York', first_activity_at: '2026-09-26T02:00:00Z' }, daily_local: [{ date: '2026-09-26', total_usd: 1, anchored_usd: 1, estimate_usd: 0, turn_count: 1 }] };
  assert.equal(pageBasis(local).covered, 4);
  assert.equal(compareCovered(local), 4);
});

test('no synced day in the window: no projection on /whatif, the whole window on /compare-models', () => {
  const empty = { meta: { days: 30 }, daily_summaries: [] };
  assert.equal(pageBasis(empty), null);
  assert.equal(compareCovered(empty), 30);
});

test('contract B fallback: UTC daily_summaries are labelled as UTC days; daily_local is not', () => {
  const utc = billedFromPayload({ daily_summaries: [row('2026-09-28', 5)] });
  assert.equal(billedLabel(utc, 30), 'Billed in the last 30 days (days are UTC)');
  const local = billedFromPayload({ daily_local: [{ date: '2026-09-28', total_usd: 5, anchored_usd: 5, estimate_usd: 0 }] });
  assert.equal(billedLabel(local, 1), 'Billed in the last 1 day');
  // The /mo note names UTC days too; on daily_local rows it does not.
  assert.match(pageBasis({ meta: { days: 30 }, daily_summaries: sparseDays.map(d => row(d, 10)) }).note, /from 2026-09-06 UTC,/);
  assert.match(pageBasis({ meta: { days: 30, tz: 'UTC' }, daily_local: [{ date: '2026-09-06', total_usd: 1, turn_count: 1 }] }).note, /from 2026-09-06, your first/);
});

test('the billed total prefers contract-B daily_local rows and falls back to daily_summaries', () => {
  const legacy = billedFromPayload({ daily_summaries: [row('2026-09-27', 10, 9), row('2026-09-28', 5)] });
  assert.deepEqual(legacy, { usd: 15, anchored_usd: 14, estimated_usd: 1, first_date: '2026-09-27', local_days: false });
  const local = billedFromPayload({
    daily_summaries: [row('2026-09-28', 999)],
    daily_local: [
      { date: '2026-09-27', usage_pool: 'interactive', anchored_usd: 3, estimate_usd: 1, total_usd: 4 },
      { date: '2026-09-27', usage_pool: 'agent_sdk', anchored_usd: 2, estimate_usd: 0, total_usd: 2 },
    ],
  });
  assert.deepEqual(local, { usd: 6, anchored_usd: 5, estimated_usd: 1, first_date: '2026-09-27', local_days: true });
});

test('QA-0928-183: a 0% difference is neutral, and signs are explicit', () => {
  assert.equal(deltaTone(0), 'same');
  assert.equal(deltaTone(12), 'more');
  assert.equal(deltaTone(-60), 'less');
  assert.equal(fmtPct(0), '0% (no change)');
  assert.equal(fmtPct(97), '+97%');
  assert.equal(fmtPct(-60), '−60%');
});

// Web stream (cross-stream regression): useDashboard's `error` is now a friendly
// string, so parsing it for "(404)" made these pages say "Couldn't load …" for
// an id with nothing synced. They read useDashboard().errorInfo instead — the
// structured describeError() result.
// RC 0.3.2 (dash-prod): these two pages then gave that state their own wording
// and `wtclaude sync`, while every other page (ErrorState on describeError)
// gave `wtclaude sync --enable`. An id with nothing synced may never have
// enabled sync, so the pages now pass describeError's description through.
test('an unsynced id gets the same description and command on /compare-models and /whatif as on every other page', () => {
  const info = describeError(edgeError('get-dashboard', 404, '{"error":"User not found"}'));
  assert.equal(info.code, 'user-not-found');
  const cm = loadErrorView(info, "Couldn't load Compare Models");
  const wi = loadErrorView(info, "Couldn't load What-If");
  assert.equal(cm.command, 'wtclaude sync --enable');
  // What ErrorState (/, /sessions, /timeline, /devices, /badges, /context-waste)
  // renders from the same info: title, body || message, command, detail.
  const shared = { title: info.title, body: info.body || info.message, command: info.command, details: info.detail };
  assert.deepEqual(cm, shared);
  assert.deepEqual(wi, shared);
  assert.equal(cm.command, info.command, 'the command is identical across pages');
  assert.doesNotMatch(`${cm.title} ${cm.body} ${cm.command}`, /[{}"]|404|User not found/);
  assert.equal(cm.details, null, 'a known state needs no technical detail');
});

test('any other failure shows the shared description, with server detail kept out of the headline', () => {
  const http = loadErrorView(describeError(edgeError('get-dashboard', 500, '{"error":"boom"}')), "Couldn't load What-If");
  assert.equal(http.title, "Couldn't load your dashboard");
  assert.doesNotMatch(http.title + http.body, /boom|500|\{/);
  assert.match(http.details, /boom/, 'the detail stays available behind the toggle');
  const net = loadErrorView(describeError(new TypeError('Failed to fetch')), "Couldn't load What-If");
  assert.match(net.title, /Couldn.t reach the WTClaude cloud/);
  assert.equal(net.command, 'wtclaude sync --status');
  const notLinked = loadErrorView(describeError(new ApiError('not-linked', 'x')), "Couldn't load What-If");
  assert.equal(notLinked.command, 'wtclaude dashboard');
  // No info at all still renders a title.
  assert.equal(loadErrorView(null, "Couldn't load What-If").title, "Couldn't load What-If");
});
