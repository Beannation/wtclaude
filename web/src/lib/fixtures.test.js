// Demo-mode fixtures (QA-0928-177). They price every demo turn with the
// browser rate mirror in compareModels.js (priceTurn / PRICING, owned by the
// analysis stream and pinned to the rate sheet by
// src/compare-models/web-parity.test.js), so no rate is typed into them. This
// pins that dependency from the demo's side: if those exports are renamed or
// change shape, this fails here instead of the demo dashboard going blank.
// The assertions are invariants, so they hold whatever today's date is.
process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mockDashboard, mockSession } from './fixtures.js';
import { priceTurn } from './compareModels.js';

const round6 = (n) => Math.round(n * 1e6) / 1e6;

test('demo fixtures build and every demo turn is priced by the shared rate mirror', () => {
  const d = mockDashboard({ days: 30, tz: 'America/New_York' });
  assert.ok(d.sessions.length > 0, 'the demo has sessions');
  let standard = 0;
  for (const s of d.sessions) {
    const detail = mockSession(s.id);
    assert.equal(detail.total_turns, detail.turns.length);
    for (const t of detail.turns) {
      const cost = t.cost_usd ?? t.cost_estimate_usd;
      const priced = priceTurn(t.model, t);
      assert.equal(priced.priceable, true, `${t.model} resolves in the mirror`);
      assert.ok(priced.usd > 0);
      if (t.speed_tier === 'fast') assert.ok(cost > priced.usd, 'fast mode bills above the standard rate');
      else { assert.equal(cost, round6(priced.usd)); standard++; }
    }
  }
  assert.ok(standard > 0);
});

// QA-0928-05 (0.3.2): the demo shows branches the way a sync uploads them.
test('demo sessions carry hashed branches or none — never a raw branch name', () => {
  const d = mockDashboard({ days: 30, tz: 'America/New_York' });
  for (const s of d.sessions) {
    assert.ok(s.git_branch === null || /^#[0-9a-f]{12}$/.test(s.git_branch), `raw branch in the demo: ${s.git_branch}`);
    for (const t of mockSession(s.id).turns) assert.equal(t.git_branch, s.git_branch);
  }
});

// The demo /context-waste inventory uses only the item types `wtclaude waste`
// judges (skills and subagents), matching the page copy.
test('the demo context inventory holds only skills and subagents', () => {
  const inv = mockDashboard({ days: 30 }).context_inventory;
  assert.ok(inv.items.length > 0);
  for (const it of inv.items) assert.ok(['skill', 'agent'].includes(it.type), `${it.id} is a ${it.type}`);
});

// RC 0.3.2: the demo's plan-limit reading is built from synced-turn readings by
// the `wtclaude limit` rule (lib/rateLimits.js), including a lagging concurrent
// session whose newer row carries a lower, older figure. The newest-row rule
// would show that row's 61%; the gauge shows 62%, as the CLI would.
test('the demo plan-limit reading follows the CLI rule, not the newest row', () => {
  const d = mockDashboard({ days: 30, tz: 'America/New_York' });
  const rl = d.rate_limits;
  assert.equal(rl.source, 'payload');
  assert.equal(rl.five_hour.used_percentage, 62);
  assert.equal(rl.seven_day.used_percentage, 41);
  assert.equal(rl.captured_at, d.meta.last_activity_at, 'as of the newest reading, the last synced turn');
  assert.ok(Date.parse(rl.five_hour.resets_at) > Date.parse(rl.captured_at));
});
