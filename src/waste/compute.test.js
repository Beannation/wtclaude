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

// ───────────────────────────────────────────────────────────────────────────
// THE FAMILY-FALLBACK CLASS (BUILD-017, 2026-09-27). computeWaste() used to take
// getRates() at face value, so when Opus 5.5 shipped and `claude-opus-5-5` fell
// to the opus family fallback, an Opus 5.5 user's dead weight was priced at Opus
// 5's $0.50 cache read (true: $0.20, 2.5x) and the rate labelled billing-grade.
// Decision: a guessed rate WITHHOLDS the figure. The next Opus lands here on day
// one, so the guard is on the class, not the row.
// ───────────────────────────────────────────────────────────────────────────

test('opus-5-5 dead weight is priced at its own $0.20/MTok cache read, not Opus 5\'s $0.50', () => {
  const r = computeWaste({ items: [item('dead', 1_000_000)], usedIds: new Set(), turns: 1, days: 30,
    model: 'claude-opus-5-5[1m]', today: '2026-09-27' });
  assert.equal(r.priced, true);
  assert.equal(r.model, 'opus-5-5');
  assert.equal(r.input_rate, 4);
  assert.equal(r.cache_read_multiplier, 0.05);
  assert.equal(round(r.per_turn_usd), 0.2);
  assert.equal(r.labels.input_rate, 'billing-grade');
});

test('a family-fallback model WITHHOLDS the dollar figure — never a guess presented as ours', () => {
  const r = computeWaste({ items: [item('used', 100), item('dead', 1_000_000)], usedIds: new Set(['used']),
    turns: 50, days: 30, model: 'claude-opus-9-20270101', today: '2026-09-27' });
  assert.equal(r.priced, false);
  assert.equal(r.unpriced_reason, 'family-fallback:opus-5-5');
  assert.equal(r.model, null, 'never name the guess as the model the user ran');
  assert.equal(r.model_id, 'claude-opus-9-20270101');
  for (const k of ['per_turn_usd', 'window_usd', 'monthly_usd', 'input_rate', 'cache_read_multiplier']) {
    assert.equal(r[k], null, `${k} must be withheld`);
  }
  assert.equal(r.labels.monthly_usd, 'withheld');
  assert.equal(r.labels.input_rate, 'unavailable', 'a guessed rate is never labelled billing-grade');
  assert.equal(r.labels.cache_read_multiplier, 'unavailable');
  // The rate-independent parts still stand.
  assert.equal(r.dead_count, 1);
  assert.equal(r.dead_tokens, 1_000_000);
  assert.equal(r.labels.turns, 'billing-grade');
});

test('partner-platform, unknown and missing models withhold too, each with its reason', () => {
  const run = model => computeWaste({ items: [item('dead', 1000)], usedIds: new Set(), turns: 10, days: 30, model, today: '2026-09-27' });
  assert.equal(run('vertex_ai/claude-opus-5-5').unpriced_reason, 'partner-platform:vertex_ai');
  assert.equal(run('claude-sonnet-9').unpriced_reason, 'unresolved-model');
  assert.equal(run(undefined).unpriced_reason, 'no-model');
  for (const m of ['vertex_ai/claude-opus-5-5', 'claude-sonnet-9', undefined]) {
    assert.equal(run(m).monthly_usd, null, `${m}: withheld`);
    assert.notEqual(run(m).labels.input_rate, 'billing-grade', `${m}: never billing-grade`);
  }
});

test('with nothing to re-read, the figure is a true $0 even when the rate is withheld', () => {
  // No dead tokens, or no turns: $0 on any rate, so stating it is not a guess.
  const noTurns = computeWaste({ items: [item('dead', 1000)], usedIds: new Set(), turns: 0, days: 30, model: 'claude-opus-9' });
  assert.equal(noTurns.monthly_usd, 0);
  const allUsed = computeWaste({ items: [item('a', 1000)], usedIds: new Set(['a']), turns: 10, days: 30 });
  assert.equal(allUsed.monthly_usd, 0);
  assert.equal(allUsed.labels.monthly_usd, 'estimate');
});
