import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeWaste } from './compute.js';
import { estimateTokens } from './tokens.js';

function item(id, tokens) {
  return { id, type: 'skill', name: id, source: '~/.claude/skills', tokens, chars: tokens * 4 };
}

test('dead-weight cost is cache-read based: deadTokens x inputRate x 0.10 x turns', () => {
  // 3 items; 2 unused (1000 + 2000 = 3000 dead tokens). Sonnet 5 input $2, cache 10%.
  const items = [item('used-one', 500), item('dead-a', 1000), item('dead-b', 2000)];
  const r = computeWaste({
    items, usedIds: new Set(['used-one']), turns: 100, days: 30,
    model: 'claude-sonnet-5', today: '2026-07-15',
  });
  assert.equal(r.loaded_count, 3);
  assert.equal(r.used_count, 1);
  assert.equal(r.dead_count, 2);
  assert.equal(r.dead_tokens, 3000);
  assert.equal(r.cache_read_multiplier, 0.10);
  assert.equal(r.input_rate, 2);
  // perTurn = 3000/1e6 * 2 * 0.10 = 0.0006 ; window = x100 = 0.06 ; monthly (30/30) = 0.06
  assert.equal(round(r.per_turn_usd), 0.0006);
  assert.equal(round(r.window_usd), 0.06);
  assert.equal(round(r.monthly_usd), 0.06);
});

test('monthly projection scales a short window up to 30 days', () => {
  const r = computeWaste({
    items: [item('dead', 1000)], usedIds: new Set(), turns: 50, days: 15,
    model: 'claude-sonnet-5', today: '2026-07-15',
  });
  // window = 1000/1e6*2*0.1*50 = 0.01 ; monthly = 0.01 * (30/15) = 0.02
  assert.equal(round(r.window_usd), 0.01);
  assert.equal(round(r.monthly_usd), 0.02);
});

test('verdicts are REVIEW (dead) / KEEP (used) — never a destructive remove', () => {
  const r = computeWaste({ items: [item('a', 100), item('b', 100)], usedIds: new Set(['a']) });
  const a = r.items.find(i => i.id === 'a');
  const b = r.items.find(i => i.id === 'b');
  assert.equal(a.verdict, 'KEEP');
  assert.equal(b.verdict, 'REVIEW');
  assert.match(b.why, /never used ≠ never useful/);
});

test('empty / cold-start: no items => zero dead weight, zero cost, no crash', () => {
  const r = computeWaste({ items: [], usedIds: new Set(), turns: 0, days: 30 });
  assert.equal(r.loaded_count, 0);
  assert.equal(r.dead_count, 0);
  assert.equal(r.dead_tokens, 0);
  assert.equal(r.monthly_usd, 0);
});

test('--json labels each number billing-grade vs estimate', () => {
  const r = computeWaste({ items: [item('a', 100)], usedIds: new Set(), turns: 10, model: 'claude-sonnet-5', today: '2026-07-15' });
  assert.equal(r.labels.dead_tokens, 'estimate');
  assert.equal(r.labels.monthly_usd, 'estimate');
  assert.equal(r.labels.turns, 'billing-grade');
  assert.equal(r.labels.cache_read_multiplier, 'billing-grade');
  assert.equal(r.labels.input_rate, 'billing-grade');
});

test('honesty: no first/only/free, no prune/delete language, no "cache hit rate"', () => {
  const r = computeWaste({ items: [item('a', 100), item('b', 100)], usedIds: new Set(['a']), turns: 10 });
  const blob = JSON.stringify(r).toLowerCase();
  assert.ok(!/\bfirst\b|\bonly\b/.test(blob), 'no first/only');
  assert.ok(!/\bfree\b/.test(blob), 'no free');
  assert.ok(!/\bprune\b|\bdelete\b|\breap\b/.test(blob), 'no prune/delete/reap');
  assert.ok(!/cache.?hit.?rate/.test(blob), 'no cache-hit-rate claim');
});

test('estimateTokens is word-aware, not chars/3.7, and non-negative', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens('   '), 0);
  const t = estimateTokens('hello world foo bar');
  assert.ok(t > 0);
  // 4 words * 1.3 = 5.2 -> 6 ; chars 19/4=4.75 -> 5 ; max = 6
  assert.equal(t, 6);
});

function round(n) { return Math.round(n * 1e6) / 1e6; }
