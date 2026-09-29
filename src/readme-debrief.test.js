// Fixed zone first: the fixture is anchored to today's LOCAL midnight.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// RC 0.3.2 (site stream handoff): the README's usage block still described
// `wtclaude debrief` as an "End-of-day summary with costliest turn and tips".
// 0.3.2 removed the tip (QA-0928-85). debrief prints the day's total with its
// cost basis, the costliest turn, and the cache-read share of input-side
// tokens. The README ships in the npm tarball, so its one line must say what
// the command prints. Checked against a real run on synthetic data.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'wtclaude.js');

test('the README describes debrief as it prints: total with its basis, costliest turn, cache-read share; no tips', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
  const m = readme.match(/^# (.+)\nwtclaude debrief$/m);
  assert.ok(m, 'the README usage block has a comment line over `wtclaude debrief`');
  const line = m[1];
  assert.doesNotMatch(line, /\btips?\b/i, 'debrief prints no tips');
  assert.match(line, /total cost with its basis/i);
  assert.match(line, /costliest turn/i);
  assert.match(line, /cache-read share of input-side tokens/i);

  const dir = mkdtempSync(join(tmpdir(), 'wtc-readme-debrief-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  const d = new Date(); d.setHours(0, 0, 0, 0);
  const ts = d.toISOString();
  writeFileSync(join(dir, 'sessions', 's.ndjson'), [
    { turn: 1, cost_usd: 2.5, input_tokens: 5_000, output_tokens: 300, cache_read_tokens: 4_000, cache_write_tokens: 1_000 },
    { turn: 2, cost_usd: 0.5, input_tokens: 1_000, output_tokens: 100, cache_read_tokens: 500, cache_write_tokens: 0 },
  ].map(t => JSON.stringify({ ts, session_id: 's', model: 'claude-opus-5-5', ...t })).join('\n') + '\n');
  try {
    const out = spawnSync(process.execPath, [BIN, 'debrief'], {
      env: { ...process.env, WTCLAUDE_NO_AUTOSYNC: '1', TZ: 'America/New_York', WTCLAUDE_DIR: dir, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude') },
      encoding: 'utf8',
    }).stdout;
    assert.match(out, /Total cost:\s+\$3\.00\s+\(billing-grade\)/, 'the total, with its basis');
    assert.match(out, /Costliest turn: #1/);
    // Reads 4,500 over an input side of 5,000 + 1,000 (each input already
    // holds its cache reads and writes) = 75%.
    assert.match(out, /Cache-read share of recorded input-side tokens: 75%/);
    assert.doesNotMatch(out, /\btips?\b/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
