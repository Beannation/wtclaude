import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeJsonl } from './jsonl-reader.js';

// REGRESSION (QA-0610-01): real Claude Code JSONL nests token usage under
// `message.usage`, and writes many streaming partials per API response (same
// message id + request id). The reader previously read top-level `entry.usage`
// (always undefined) → every sum was 0 → the hero `compare` showed the
// session-log estimate as $0 / N/A. These lock in: nested read, dedup, and the
// flat-fixture fallback.

// One streaming partial of an assistant response.
function nested(id, reqId, usage) {
  return { type: 'assistant', requestId: reqId, message: { id, role: 'assistant', usage } };
}
const U = (i, o, cr = 0, cw = 0) => ({
  input_tokens: i, output_tokens: o,
  cache_read_input_tokens: cr, cache_creation_input_tokens: cw,
});

test('summarizeJsonl reads nested message.usage (was 0 before the fix)', () => {
  const sessions = [{ session_id: 's1', entries: [
    nested('m1', 'r1', U(1000, 500, 2000, 300)),
    nested('m2', 'r2', U(1500, 700, 4000, 100)),
  ] }];
  const s = summarizeJsonl(sessions);
  assert.equal(s.input_tokens, 2500);
  assert.equal(s.output_tokens, 1200);
  assert.equal(s.cache_read_tokens, 6000);
  assert.equal(s.cache_write_tokens, 400);
  assert.ok(s.input_tokens > 0, 'nested usage must produce a non-zero estimate');
});

test('summarizeJsonl dedups streaming partials by message.id:requestId', () => {
  const u = U(1000, 500, 2000, 300);
  const sessions = [{ session_id: 's1', entries: [
    nested('m1', 'r1', u), nested('m1', 'r1', u), nested('m1', 'r1', u), // 3 partials, ONE response
  ] }];
  const s = summarizeJsonl(sessions);
  assert.equal(s.input_tokens, 1000, 'one response is counted once, not 3x');
  assert.equal(s.output_tokens, 500);
});

test('summarizeJsonl does NOT dedup distinct responses', () => {
  const u = U(1000, 500);
  const sessions = [{ session_id: 's1', entries: [nested('m1', 'r1', u), nested('m2', 'r2', u)] }];
  assert.equal(summarizeJsonl(sessions).input_tokens, 2000);
});

test('summarizeJsonl falls back to flat top-level usage (fixtures)', () => {
  const sessions = [{ session_id: 's1', entries: [{ usage: U(200, 80) }] }];
  const s = summarizeJsonl(sessions);
  assert.equal(s.input_tokens, 200);
  assert.equal(s.output_tokens, 80);
});

test('summarizeJsonl: a configured user with real JSONL yields a computable gap vs billing-grade', () => {
  // billing-grade (accurate) input vs deduped session-log input → a finite ratio
  const accurateInput = 500000;
  const jsonl = summarizeJsonl([{ session_id: 's1', entries: [
    nested('m1', 'r1', U(40000, 5000)), nested('m1', 'r1', U(40000, 5000)), // dup
    nested('m2', 'r2', U(30000, 4000)),
  ] }]);
  assert.equal(jsonl.input_tokens, 70000); // 40k + 30k (dup dropped)
  const gap = accurateInput / jsonl.input_tokens;
  assert.ok(Number.isFinite(gap) && gap > 1, 'gap computes and is finite');
});
