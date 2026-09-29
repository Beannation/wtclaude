process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentDailyRunRate, poolSpend } from './agentpool.js';

const agent = (ts, cost_usd) => ({ ts, cost_usd, usage_pool: 'agent_sdk', billing_basis: 'agent_sdk_credits', model: 'claude-opus-5-5' });

test('QA-0928-73: agentDailyRunRate over 7 days with spend on 2 days equals sum / 7', () => {
  const rr = agentDailyRunRate([agent('2026-09-20T12:00:00Z', 2.1), agent('2026-09-22T12:00:00Z', 2.1)], { coveredDays: 7 });
  assert.equal(rr.days, 2);
  assert.ok(Math.abs(rr.avgPerDay - 4.2 / 7) < 1e-9, `got ${rr.avgPerDay}`);
  assert.equal(agentDailyRunRate([agent('2026-09-20T12:00:00Z', 1)]).avgPerDay, null, 'no basis -> no average');
});

test('agent-pool days are LOCAL days', () => {
  // 02:30Z on Sep 21 is 22:30 EDT on Sep 20.
  const rr = agentDailyRunRate([agent('2026-09-21T02:30:00Z', 1)], { coveredDays: 1 });
  assert.deepEqual(Object.keys(rr.perDay), ['2026-09-20']);
});

test('QA-0928-77: poolSpend separates payload-sourced from inferred fast-mode turns', () => {
  const fast = (source) => ({ ts: '2026-09-20T12:00:00Z', cost_usd: 1, speed_tier: 'fast', speed_tier_source: source, billing_basis: 'fast_mode_usage_credits' });
  const s = poolSpend([fast('payload'), fast('inferred'), fast('inferred')]);
  assert.equal(s.fastTurns, 3);
  assert.equal(s.fastPayloadTurns, 1);
  assert.equal(s.fastInferredTurns, 2);
});

// QA-0928-54 reaches the pools (RC 2026-09-28): an unanchored turn on a model
// this version cannot price — a family fallback or a partner-platform id — is
// left out of every pool's dollars and counted by model, as `today` does; an
// unanchored turn on a priceable model is a labelled estimate, never
// billing-grade.
const TOK = { input_tokens: 200_000, output_tokens: 50_000, cache_read_tokens: 100_000, cache_write_tokens: 100_000 };
const FIVE = [
  { ts: '2026-09-20T12:00:00Z', model: 'claude-sonnet-5', usage_pool: 'agent_sdk', billing_basis: 'agent_sdk_credits', cost_usd: 1, ...TOK },
  { ts: '2026-09-20T12:01:00Z', model: 'claude-opus-6', usage_pool: 'agent_sdk', billing_basis: 'agent_sdk_credits', cost_usd: null, ...TOK },
  { ts: '2026-09-20T12:02:00Z', model: 'us.anthropic.claude-opus-5-5-v1:0', usage_pool: 'agent_sdk', billing_basis: 'agent_sdk_credits', cost_usd: null, ...TOK },
  { ts: '2026-09-20T12:03:00Z', model: 'claude-opus-6', speed_tier: 'fast', speed_tier_source: 'payload', billing_basis: 'fast_mode_usage_credits', cost_usd: null, ...TOK },
  { ts: '2026-09-20T12:04:00Z', model: 'claude-opus-5-5', speed_tier: 'fast', speed_tier_source: 'payload', billing_basis: 'fast_mode_usage_credits', cost_usd: 2, ...TOK },
];

test('poolSpend leaves unpriceable unanchored turns out of the dollars and names them per pool', () => {
  const s = poolSpend(FIVE);
  assert.equal(s.agent, 1);
  assert.equal(s.fast, 2);
  assert.equal(s.total, 3, 'the same total `today` shows for these turns');
  assert.equal(s.agentBasis.anchored_turns, 1);
  assert.equal(s.agentBasis.estimated_turns, 0);
  assert.equal(s.agentBasis.excluded_turns, 2);
  assert.deepEqual(s.agentBasis.excluded_models, { 'claude-opus-6': 1, 'us.anthropic.claude-opus-5-5-v1:0': 1 });
  assert.equal(s.fastBasis.anchored_turns, 1);
  assert.equal(s.fastBasis.excluded_turns, 1);
  assert.deepEqual(s.fastBasis.excluded_models, { 'claude-opus-6': 1 });
  assert.equal(s.fastTurns, 1, 'only priced fast turns carry the fast-mode label');
});

test('poolSpend: an unanchored priceable agent turn is an estimate, not billing-grade', () => {
  const s = poolSpend([
    { ...FIVE[0] },
    { ...FIVE[0], ts: '2026-09-20T13:00:00Z', model: 'claude-opus-5-5', cost_usd: null },
  ]);
  assert.equal(s.agentBasis.anchored_turns, 1);
  assert.equal(s.agentBasis.estimated_turns, 1);
  assert.ok(s.agentBasis.estimated_cost > 0);
  assert.equal(s.agent, s.agentBasis.anchored_cost + s.agentBasis.estimated_cost);
});

test('agentDailyRunRate sums priced agent turns only and counts the excluded ones', () => {
  const rr = agentDailyRunRate(FIVE, { coveredDays: 1 });
  assert.equal(rr.sum, 1);
  assert.equal(rr.avgPerDay, 1);
  assert.equal(rr.days, 1);
  assert.equal(rr.agentTurns, 3);
  assert.equal(rr.basis.anchored_turns, 1);
  assert.equal(rr.basis.excluded_turns, 2);
  const none = agentDailyRunRate([FIVE[1], FIVE[2]], { coveredDays: 7 });
  assert.equal(none.sum, 0);
  assert.equal(none.days, 0, 'a day of excluded turns only is not a day with spend');
  assert.equal(none.agentTurns, 2);
  assert.equal(none.basis.excluded_turns, 2);
});
