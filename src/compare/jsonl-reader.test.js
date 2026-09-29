// Pinned before any Date use: the window tests below sit on EDT day edges.
process.env.TZ = 'America/New_York';

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
//      machine it found fewer than a tenth of the transcripts and under half
//      the session-log INPUT tokens — input-token undercount being the exact
//      claim the comparison exists to demonstrate.
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
      type: 'assistant', sessionId: 'sess-1',
      message: { id, role: 'assistant', usage: { input_tokens: 100, output_tokens: 10 } }, requestId: id,
    });
    writeFileSync(join(root, 'projects', 'proj-a', 'top.jsonl'), line('top') + '\n');
    writeFileSync(join(deep, 'agent-1.jsonl'), line('deep') + '\n');

    process.env.CLAUDE_CONFIG_DIR = root;
    const mod = await import('./jsonl-reader.js?b4nested');
    const scan = mod.readJsonlUsage();
    const keys = scan.records.map(r => r.key).sort();
    assert.deepEqual(keys, ['deep:deep', 'top:top'], 'the nested subagent transcript must be found');
    const sum = mod.summarizeUsageRecords(scan.records);
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
    const scan = mod.readJsonlUsage();
    assert.equal(scan.available, false);
    assert.deepEqual(scan.records, []);
  } finally {
    if (prevEnv === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = prevEnv;
    rmSync(root, { recursive: true, force: true });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// BUILD-018 (2026-09-28) — QA-0928-15 / -16 / -67.
//
//  -16  The dedup kept the FIRST streamed record per response. Claude Code
//       writes one line per content block as a response streams; only the last
//       carries the final output count (and stop_reason). Keeping the first
//       undercounted the log side's output several-fold — in our favour.
//  -67  The window compared the UTC date of each record against a LOCAL range,
//       so an EDT evening landed on the wrong day.
//  -15  Every transcript was read whole and every entry kept (content and all);
//       `compare --days 30` and `waste` ran out of heap on ~4 GB of transcripts.
//
// The TZ is pinned at the top of this file (before any Date use) so the window
// edges are deterministic.
// ───────────────────────────────────────────────────────────────────────────

import { mkdtempSync as mkd, mkdirSync as mkdir, writeFileSync as wf, rmSync as rm, utimesSync } from 'node:fs';
import { tmpdir as tmp } from 'node:os';
import { join as pjoin, dirname as pdir } from 'node:path';
import { spawnSync as spawn } from 'node:child_process';
import { fileURLToPath as f2p } from 'node:url';
import { isBetterFinal, usageRecord, foldUsage, summarizeUsageRecords } from './jsonl-reader.js';

// One streamed line of a real-shaped assistant response.
function line({ id = 'm1', req = 'r1', out = 0, stop = null, ts = '2026-09-27T16:00:00.000Z', model = 'claude-opus-5-5',
  session = 'sess-a', input = 10, cr = 1000, cw = 50, sidechain = false, entrypoint = 'cli' } = {}) {
  return JSON.stringify({
    parentUuid: null, isSidechain: sidechain, type: 'assistant', requestId: req, timestamp: ts,
    sessionId: session, entrypoint,
    message: { id, role: 'assistant', model, stop_reason: stop, content: [{ type: 'text', text: 'x' }],
      usage: { input_tokens: input, output_tokens: out, cache_read_input_tokens: cr, cache_creation_input_tokens: cw } },
  });
}

// A throwaway CLAUDE_CONFIG_DIR with transcripts; returns a fresh module instance.
async function withRoot(files, fn, tag) {
  const root = mkd(pjoin(tmp(), 'wtc-jsonl-q-'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  try {
    for (const [rel, lines] of Object.entries(files)) {
      const p = pjoin(root, 'projects', rel);
      mkdir(pdir(p), { recursive: true });
      wf(p, lines.join('\n') + '\n');
    }
    process.env.CLAUDE_CONFIG_DIR = root;
    const mod = await import(`./jsonl-reader.js?${tag}`);
    return await fn(mod, root);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
    rm(root, { recursive: true, force: true });
  }
}

test('QA-0928-16: three streamed records with output 5, 120 and 480 count 480, once', () => {
  const recs = [
    usageRecord(JSON.parse(line({ out: 5 }))),
    usageRecord(JSON.parse(line({ out: 480, stop: 'tool_use' }))),
    usageRecord(JSON.parse(line({ out: 120 }))),
  ];
  const byKey = new Map(), anon = [];
  for (const r of recs) foldUsage(byKey, anon, r);
  const s = summarizeUsageRecords([...byKey.values(), ...anon]);
  assert.equal(s.output_tokens, 480, 'the final record (largest output) is the one counted');
  assert.equal(s.input_tokens, 10, 'input is counted once, not three times');
  assert.equal(s.cache_read_tokens, 1000);
});

test('QA-0928-16: the final-record rule — larger output wins, stop_reason breaks a tie, all-zero never replaces', () => {
  const r = (o) => usageRecord(JSON.parse(line(o)));
  assert.equal(isBetterFinal(r({ out: 5 }), r({ out: 120 })), true);
  assert.equal(isBetterFinal(r({ out: 120 }), r({ out: 5 })), false, 'not "last in scan order"');
  assert.equal(isBetterFinal(r({ out: 7 }), r({ out: 7, stop: 'end_turn' })), true, 'stop_reason set wins a tie');
  assert.equal(isBetterFinal(r({ out: 7, stop: 'end_turn' }), r({ out: 7 })), false);
  const zero = r({ out: 0, input: 0, cr: 0, cw: 0, stop: 'end_turn' });
  assert.equal(isBetterFinal(r({ out: 0, input: 5 }), zero), false, 'an all-zero record never replaces a non-zero one');
  assert.equal(isBetterFinal(zero, r({ out: 0, input: 5 })), true, 'a non-zero record replaces an all-zero one');
});

test('QA-0928-16: summarizeJsonl (entry-shaped callers) keeps the final record too', () => {
  const entries = [5, 480, 120].map(out => JSON.parse(line({ out })));
  assert.equal(summarizeJsonl([{ session_id: 's', entries }]).output_tokens, 480);
});

test('QA-0928-16: one response written to two files is counted once, at its final record', async () => {
  await withRoot({
    'p/sess-a.jsonl': [line({ out: 3 })],
    'p/sess-a/subagents/agent-1.jsonl': [line({ out: 300, stop: 'end_turn' })],
  }, (mod) => {
    const scan = mod.readJsonlUsage({ start: '2026-09-27', end: '2026-09-27' });
    assert.equal(scan.records.length, 1);
    assert.equal(scan.records[0].output_tokens, 300);
  }, 'q16files');
});

test('QA-0928-67: the window is LOCAL dates — 22:00 EDT on both edges', async () => {
  // 2026-09-27T02:00Z is 22:00 EDT on 09-26 (outside a 09-27 window);
  // 2026-09-28T02:00Z is 22:00 EDT on 09-27 (inside it). By UTC date it is the
  // other way round, which is what the old slice(0,10) compare did.
  await withRoot({
    'p/s.jsonl': [
      line({ id: 'before', req: 'b', out: 1, ts: '2026-09-27T02:00:00.000Z' }),
      line({ id: 'inside', req: 'i', out: 2, ts: '2026-09-28T02:00:00.000Z' }),
    ],
  }, (mod) => {
    const scan = mod.readJsonlUsage({ start: '2026-09-27', end: '2026-09-27' });
    assert.deepEqual(scan.records.map(r => r.key), ['inside:i']);
  }, 'q67');
});

test('QA-0928-15: a transcript last written before the window start is never opened', async () => {
  await withRoot({
    'p/old.jsonl': [line({ id: 'old', req: 'o', out: 9 })],   // content claims 09-27, but…
    'p/new.jsonl': [line({ id: 'new', req: 'n', out: 1 })],
  }, (mod, root) => {
    // …its mtime says it was last written on 09-20, so it cannot hold a 09-27 record.
    const old = new Date(2026, 8, 20, 12, 0, 0);
    utimesSync(pjoin(root, 'projects', 'p', 'old.jsonl'), old, old);
    const recent = new Date(2026, 8, 27, 18, 0, 0);
    utimesSync(pjoin(root, 'projects', 'p', 'new.jsonl'), recent, recent);
    const scan = mod.readJsonlUsage({ start: '2026-09-27', end: '2026-09-27' });
    assert.deepEqual(scan.records.map(r => r.key), ['new:n']);
    assert.equal(scan.skipped_files, 1);

    // Injected stat: the prefilter decides from mtime alone.
    const seen = [];
    const { files, skipped } = mod.transcriptFiles({ start: '2026-09-27', end: '2026-09-27' }, {
      stat: (p) => { seen.push(p); return { mtimeMs: p.endsWith('old.jsonl') ? old.getTime() : recent.getTime() }; },
    });
    assert.equal(seen.length, 2);
    assert.deepEqual(files.map(f => f.split('/').pop()), ['new.jsonl']);
    assert.equal(skipped, 1);
  }, 'q15mtime');
});

test('QA-0928-15: a line split across read chunks and multi-byte text survive the streaming reader', async () => {
  const big = 'é'.repeat(700_000);          // ~1.4 MB of 2-byte chars: spans the 1 MB chunk
  const userLine = JSON.stringify({ type: 'user', timestamp: '2026-09-27T16:00:00.000Z', message: { role: 'user', content: big } });
  const longAssistant = JSON.parse(line({ id: 'long', req: 'L', out: 42, stop: 'end_turn' }));
  longAssistant.message.content = [{ type: 'text', text: big }];
  await withRoot({
    'p/s.jsonl': [userLine, line({ id: 'a', req: 'A', out: 1 }), JSON.stringify(longAssistant), line({ id: 'b', req: 'B', out: 2 })],
  }, (mod) => {
    const scan = mod.readJsonlUsage({ start: '2026-09-27', end: '2026-09-27' });
    assert.deepEqual(scan.records.map(r => r.key).sort(), ['a:A', 'b:B', 'long:L']);
    assert.equal(summarizeUsageRecords(scan.records).output_tokens, 45);
  }, 'q15chunks');
});

test('QA-0928-15: memory stays bounded on a large synthetic corpus (64 MB heap)', () => {
  // ~96 MB of transcripts, mostly bulky tool-result lines. Reading each file whole
  // and keeping every entry needs well over the 64 MB heap; streaming and keeping
  // one compact record per response does not.
  const root = mkd(pjoin(tmp(), 'wtc-jsonl-big-'));
  try {
    const bulk = JSON.stringify({ type: 'user', timestamp: '2026-09-27T16:00:00.000Z',
      message: { role: 'user', content: [{ type: 'tool_result', content: 'z'.repeat(200_000) }] } });
    for (let f = 0; f < 24; f++) {
      const lines = [];
      for (let i = 0; i < 20; i++) {
        lines.push(bulk);
        lines.push(line({ id: `m${f}-${i}`, req: `r${f}-${i}`, out: 1 }));
      }
      const p = pjoin(root, 'projects', `p${f % 3}`, `s${f}.jsonl`);
      mkdir(pdir(p), { recursive: true });
      wf(p, lines.join('\n') + '\n');
    }
    const reader = pjoin(pdir(f2p(import.meta.url)), 'jsonl-reader.js');
    const script = `import(${JSON.stringify(reader)}).then(m => {
      const s = m.readJsonlUsage({ start: '2026-09-27', end: '2026-09-27' });
      console.log(JSON.stringify({ n: s.records.length, out: m.summarizeUsageRecords(s.records).output_tokens }));
    });`;
    const res = spawn(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e', script], {
      env: { ...process.env, CLAUDE_CONFIG_DIR: root, HOME: root, WTCLAUDE_DIR: pjoin(root, '.wtclaude'), TZ: 'America/New_York' }, encoding: 'utf8',
    });
    assert.equal(res.status, 0, `reader ran out of memory or crashed: ${res.stderr.slice(0, 300)}`);
    assert.deepEqual(JSON.parse(res.stdout.trim()), { n: 480, out: 480 });
  } finally {
    rm(root, { recursive: true, force: true });
  }
});
