import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCoworkTurns } from './cowork-reader.js';

// Write a fixture audit.jsonl (the real Cowork transcript shape) and point the
// WTCLAUDE_COWORK_AUDIT override at it — the same test seam the reader documents.
function withFixture(objs, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-cowork-'));
  const path = join(dir, 'audit.jsonl');
  writeFileSync(path, objs.map((o) => JSON.stringify(o)).join('\n') + '\n');
  const prev = process.env.WTCLAUDE_COWORK_AUDIT;
  process.env.WTCLAUDE_COWORK_AUDIT = path;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.WTCLAUDE_COWORK_AUDIT;
    else process.env.WTCLAUDE_COWORK_AUDIT = prev;
    rmSync(dir, { recursive: true, force: true });
  }
}

// An `assistant` line in the Cowork transcript shape (message.model + message.usage).
const asst = (id, model, usage, ts = '2026-07-01T10:00:00.000Z', reqId = null) => ({
  type: 'assistant',
  request_id: reqId,
  _audit_timestamp: ts,
  message: { id, model, role: 'assistant', usage },
});

test('parses the Cowork transcript audit.jsonl into reprice-ready turns', () => {
  const turns = withFixture(
    [
      { type: 'user', message: { role: 'user' }, _audit_timestamp: '2026-07-01T10:00:00.000Z' },
      { type: 'system', subtype: 'init' },
      { type: 'rate_limit_event', rate_limit_info: {} },
      asst('msg_a', 'claude-sonnet-4-6', {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 200,
      }),
    ],
    () => readCoworkTurns(),
  );
  assert.equal(turns.length, 1); // non-assistant lines ignored
  assert.deepEqual(turns[0], {
    model: 'claude-sonnet-4-6',
    input_tokens: 100,
    output_tokens: 50,
    cache_read_tokens: 1000,
    cache_write_tokens: 200,
  });
});

test('dedups streaming repeats of one response (message.id + request id)', () => {
  const u = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const turns = withFixture(
    [asst('msg_dup', 'claude-opus-4-8', u), asst('msg_dup', 'claude-opus-4-8', u), asst('msg_dup', 'claude-opus-4-8', u), asst('msg_other', 'claude-opus-4-8', u)],
    () => readCoworkTurns(),
  );
  assert.equal(turns.length, 2); // msg_dup counted once + msg_other
});

test('honors the date filter via _audit_timestamp', () => {
  const u = { input_tokens: 1, output_tokens: 1 };
  const turns = withFixture(
    [asst('m1', 'claude-sonnet-5', u, '2026-05-01T00:00:00.000Z'), asst('m2', 'claude-sonnet-5', u, '2026-07-01T00:00:00.000Z')],
    () => readCoworkTurns({ start: '2026-06-15', end: '2026-07-02' }),
  );
  assert.equal(turns.length, 1); // only the in-window response
  assert.equal(turns[0].model, 'claude-sonnet-5');
});

test('missing override path degrades to [] (never a fabricated zero)', () => {
  const prev = process.env.WTCLAUDE_COWORK_AUDIT;
  process.env.WTCLAUDE_COWORK_AUDIT = '/nonexistent-wtc-cowork-xyz.jsonl';
  try {
    assert.deepEqual(readCoworkTurns(), []);
  } finally {
    if (prev === undefined) delete process.env.WTCLAUDE_COWORK_AUDIT;
    else process.env.WTCLAUDE_COWORK_AUDIT = prev;
  }
});
