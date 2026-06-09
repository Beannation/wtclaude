import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saltedHash } from '../utils/hash.js';

const COLLECTOR = join(dirname(fileURLToPath(import.meta.url)), 'index.js');

// Run the real collector with a piped payload against an isolated WTCLAUDE_DIR.
function runCollector(dir, payload) {
  const res = spawnSync(process.execPath, [COLLECTOR], {
    input: JSON.stringify(payload),
    env: { ...process.env, WTCLAUDE_DIR: dir },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0, 'collector must always exit 0 (safe-fail)');
  return res;
}

function payload(sessionId, { cost, input, output, cwd }) {
  return {
    session_id: sessionId,
    model: { id: 'claude-opus-4-8' },
    cost: { total_cost_usd: cost },
    context_window: { total_input_tokens: input, total_output_tokens: output, used_percentage: 5 },
    cwd,
    fast_mode: false,
  };
}

function setup(salt) {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-collector-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: salt }));
  return dir;
}

test('collector computes per-turn deltas from cumulative totals', () => {
  const dir = setup('test-salt-1');
  try {
    const cwd = '/Users/x/projectZ';
    runCollector(dir, payload('sess1', { cost: 0.05, input: 10000, output: 2000, cwd }));
    runCollector(dir, payload('sess1', { cost: 0.12, input: 16000, output: 5000, cwd }));

    const records = readFileSync(join(dir, 'sessions', 'sess1.ndjson'), 'utf8')
      .trim().split('\n').map(JSON.parse);
    assert.equal(records.length, 2, 'two distinct turns recorded');

    const [t1, t2] = records;
    assert.equal(t1.turn, 1);
    assert.equal(t2.turn, 2);
    // Turn 2 deltas = cumulative(2) - cumulative(1).
    assert.ok(Math.abs(t2.cost_usd - 0.07) < 1e-9, `delta cost 0.07, got ${t2.cost_usd}`);
    assert.equal(t2.input_tokens, 6000);
    assert.equal(t2.output_tokens, 3000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collector salts project_hash with the configured per-install salt (R-14)', () => {
  const cwd = '/Users/x/projectZ';
  const dirA = setup('salt-AAA');
  const dirB = setup('salt-BBB');
  try {
    runCollector(dirA, payload('s', { cost: 0.01, input: 100, output: 10, cwd }));
    runCollector(dirB, payload('s', { cost: 0.01, input: 100, output: 10, cwd }));
    const recA = JSON.parse(readFileSync(join(dirA, 'sessions', 's.ndjson'), 'utf8').trim());
    const recB = JSON.parse(readFileSync(join(dirB, 'sessions', 's.ndjson'), 'utf8').trim());

    // The configured salt is the one the collector reads...
    assert.equal(recA.project_hash, saltedHash('salt-AAA', cwd));
    // ...and a different per-install salt yields a different, non-correlatable hash.
    assert.notEqual(recA.project_hash, recB.project_hash);
    // ...and never the old global-constant value.
    assert.notEqual(recA.project_hash, saltedHash('wtclaude', cwd));
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test('collector dedupes an unchanged status update (no phantom turn)', () => {
  const dir = setup('s');
  try {
    const cwd = '/Users/x/p';
    const p = payload('dup', { cost: 0.05, input: 1000, output: 100, cwd });
    runCollector(dir, p);
    runCollector(dir, p); // identical cumulative — should not write a 2nd record
    const records = readFileSync(join(dir, 'sessions', 'dup.ndjson'), 'utf8').trim().split('\n');
    assert.equal(records.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// FABLE-001 PART 2 — billing-basis on the June-23 "Fable cliff". Interactive
// Fable bills usage credits from the cliff date, NOT subscription limits. The
// test pins the cliff via the config override (same knob used if Anthropic
// moves the date) so it stays deterministic.

function fablePayload(sessionId, { cost, input, output, cwd }) {
  const p = payload(sessionId, { cost, input, output, cwd });
  p.model = { id: 'claude-fable-5[1m]' }; // literal id from the June-9 live capture
  return p;
}

test('collector labels interactive Fable usage_credits once the cliff has passed', () => {
  const dir = setup('s');
  try {
    writeFileSync(join(dir, 'config.json'),
      JSON.stringify({ edit_hash_salt: 's', fable_cliff_date: '2020-01-01' }));
    runCollector(dir, fablePayload('fable-post', { cost: 0.05, input: 1000, output: 100, cwd: '/Users/x/p' }));
    const rec = JSON.parse(readFileSync(join(dir, 'sessions', 'fable-post.ndjson'), 'utf8').trim());
    assert.equal(rec.model, 'claude-fable-5[1m]');
    assert.equal(rec.usage_pool, 'interactive');
    assert.equal(rec.billing_basis, 'usage_credits');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collector keeps subscription_limits for Fable during the included window', () => {
  const dir = setup('s');
  try {
    writeFileSync(join(dir, 'config.json'),
      JSON.stringify({ edit_hash_salt: 's', fable_cliff_date: '2099-01-01' }));
    runCollector(dir, fablePayload('fable-pre', { cost: 0.05, input: 1000, output: 100, cwd: '/Users/x/p' }));
    const rec = JSON.parse(readFileSync(join(dir, 'sessions', 'fable-pre.ndjson'), 'utf8').trim());
    assert.equal(rec.billing_basis, 'subscription_limits');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collector never labels non-Fable models usage_credits, even past the cliff', () => {
  const dir = setup('s');
  try {
    writeFileSync(join(dir, 'config.json'),
      JSON.stringify({ edit_hash_salt: 's', fable_cliff_date: '2020-01-01' }));
    runCollector(dir, payload('opus-post', { cost: 0.05, input: 1000, output: 100, cwd: '/Users/x/p' }));
    const rec = JSON.parse(readFileSync(join(dir, 'sessions', 'opus-post.ndjson'), 'utf8').trim());
    assert.equal(rec.billing_basis, 'subscription_limits');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
