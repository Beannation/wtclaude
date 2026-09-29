// Devices page render tests (node --test via src/test-support/jsx.js).
process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, text } from '../test-support/jsx.js';

const PAGE = new URL('./Devices.jsx', import.meta.url);
const EMPTY = { meta: { source: 'live', days: 30 }, daily_summaries: [], sessions: [], badges: [], devices: [], rate_limits: null };

// QA-0928-92: an empty window showed the empty state AND, under it,
// "COMBINED COST ● BILLING-GRADE $0.000 · DEVICES 0 · SESSIONS 0 · TURNS 0".
test('Devices: an empty window shows the empty state only — no $0 billing-grade cards', async () => {
  const t = text(await render(PAGE, 'DevicesView', { data: EMPTY, windowDays: 30, currency: 'USD' }));
  assert.match(t, /Nothing synced in the last 30 days/);
  assert.doesNotMatch(t, /Combined cost/i);
  assert.doesNotMatch(t, /billing-grade/i);
  assert.doesNotMatch(t, /\$0\.00/);
});

test('Devices: a window with activity still shows the combined cards', async () => {
  const data = {
    ...EMPTY,
    devices: [{ device_id: 'aaaa1111-0000-4000-8000-000000000000', label: 'aaaa1111-0000-4000-8000-000000000000', session_count: 2, turn_count: 9, cost_usd: 4.5 }],
    sessions: [{ session_id: 's1', started_at: '2026-09-27T14:00:00Z', ended_at: '2026-09-27T15:00:00Z', anchored_cost_usd: 4.5, estimated_only_cost_usd: 0, estimated_cost_usd: 4.5, cost_basis: 'billing-grade' }],
  };
  const t = text(await render(PAGE, 'DevicesView', { data, windowDays: 30, currency: 'USD' }));
  assert.match(t, /Combined cost/i);
  assert.match(t, /\$4\.50/);
  assert.doesNotMatch(t, /Nothing synced/);
});
