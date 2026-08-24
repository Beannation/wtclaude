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

// ───────────────────────────────────────────────────────────────────────────
// B4 (2026-08-24) — transcript discovery.
//
// Two defects, both silent, both biased in OUR favour in a comparison whose
// whole point is that the session logs undercount:
//
//   1. The walk read exactly one level (`projects/<dir>/*.jsonl`). Claude Code
//      nests subagent and workflow transcripts several levels down. On a real
//      machine: 49 of 621 transcripts found, and 2.4M of 5.4M session-log INPUT
//      tokens — input-token undercount being the exact claim the comparison
//      exists to demonstrate.
//   2. `CLAUDE_CONFIG_DIR` relocates the whole tree ("Claude Code then stores
//      your settings, session history, and plugins there instead" — settings
//      docs). Hardcoding ~/.claude meant those users silently compared against
//      zero.
// ───────────────────────────────────────────────────────────────────────────
test('B4: finds transcripts nested below the first level', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'wtc-jsonl-'));
  const prevEnv = process.env.CLAUDE_CONFIG_DIR;
  try {
    const deep = join(root, 'projects', 'proj-a', 'sess-1', 'subagents', 'workflows', 'wf-1');
    mkdirSync(deep, { recursive: true });
    const line = (id) => JSON.stringify({
      message: { id, usage: { input_tokens: 100, output_tokens: 10 } }, requestId: id,
    });
    writeFileSync(join(root, 'projects', 'proj-a', 'top.jsonl'), line('top') + '\n');
    writeFileSync(join(deep, 'agent-1.jsonl'), line('deep') + '\n');

    process.env.CLAUDE_CONFIG_DIR = root;
    const mod = await import('./jsonl-reader.js?b4nested');
    const sessions = mod.readJsonlSessions();
    const ids = sessions.map(s => s.session_id).sort();
    assert.deepEqual(ids, ['agent-1', 'top'], 'the nested subagent transcript must be found');
    const sum = mod.summarizeJsonl(sessions);
    assert.equal(sum.input_tokens, 200, 'both transcripts must contribute');
  } finally {
    if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevEnv;
    rmSync(root, { recursive: true, force: true });
  }
});

test('B4: "no transcript directory" is distinguishable from "zero usage"', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = mkdtempSync(join(tmpdir(), 'wtc-jsonl-empty-'));
  const prevEnv = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = root;   // exists, but has no projects/ dir
    const mod = await import('./jsonl-reader.js?b4missing');
    assert.equal(mod.transcriptsAvailable(), false,
      'absence of transcript data must be reportable, not silently rendered as zero usage');
    assert.deepEqual(mod.readJsonlSessions(), []);
  } finally {
    if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevEnv;
    rmSync(root, { recursive: true, force: true });
  }
});
