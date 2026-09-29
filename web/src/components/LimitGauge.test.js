// Plan-limit gauge render tests (node --test via src/test-support/jsx.js).
process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, text } from '../test-support/jsx.js';

const GAUGE = new URL('./LimitGauge.jsx', import.meta.url);
const BADGE = new URL('./HonestyBadge.jsx', import.meta.url);
const NOW = Date.parse('2026-09-28T14:00:00Z');
const LIMITS = {
  source: 'payload', captured_at: '2026-09-28T13:36:59Z',
  five_hour: { used_percentage: 15, resets_at: '2026-09-28T15:10:00Z' },
  seven_day: { used_percentage: 40, resets_at: '2026-10-04T00:00:00Z' },
};

// QA-0928-31: the deployed (pre-0.3.2) get-dashboard picks the newest reading
// among its first 1,000 turns — live, days=30 and days=365 returned different
// captured_at values, both older than the newest synced activity. Calling that
// "your latest" status update was false. Only the fixed function (it always
// sends meta.tz and meta.last_activity_at) returns the truly latest reading.
test('LimitGauge: on the old get-dashboard the reading is not called "latest"', async () => {
  const t = text(await render(GAUGE, 'default', { rateLimits: LIMITS, meta: { source: 'live', days: 30 }, now: NOW }));
  assert.match(t, /As of Sep 28, 9:36 AM \(23m ago\) — a synced status reading \(may not be the newest\)/);
  assert.doesNotMatch(t, /latest/i);
});

test('LimitGauge: with the 0.3.2 get-dashboard (meta.tz / last_activity_at) it is the latest reading', async () => {
  const meta = { source: 'live', days: 30, tz: 'America/New_York', window_start: '2026-08-30', last_activity_at: '2026-09-28T13:48:00Z' };
  const t = text(await render(GAUGE, 'default', { rateLimits: LIMITS, meta, now: NOW }));
  assert.match(t, /— your latest synced Claude Code status update\./);
  assert.match(t, /From your latest synced Claude Code status update/);
  assert.doesNotMatch(t, /may not be the newest/);
});

test('HonestyBadge: the "as reported" tier does not claim "latest" on its own', async () => {
  const t = text(await render(BADGE, 'default', { tier: 'reported' }));
  assert.match(t, /as reported/);
  assert.doesNotMatch(t, /latest/i);
});

// RC 0.3.2: mirror `wtclaude limit` — a limit with no reading shows "—", not a
// 0% bar (QA-0928-61: a null reading stays null, never 0).
test('LimitGauge: a limit with no reading shows —, not 0% used', async () => {
  const meta = { source: 'live', days: 30, tz: 'America/New_York', last_activity_at: '2026-09-28T13:48:00Z' };
  const limits = { ...LIMITS, seven_day: { used_percentage: null, resets_at: null } };
  const html = await render(GAUGE, 'default', { rateLimits: limits, meta, now: NOW });
  const t = text(html);
  assert.match(t, /7-day window — no reading/);
  assert.doesNotMatch(t, /7-day window 0% used/);
  assert.match(t, /5-hour window 15% used/);
});
