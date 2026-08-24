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

// A2 (2026-08-24): these three tests used to pin the "Fable cliff" — a config
// date after which every Fable turn was stamped usage_credits. Fable has been
// permanent and PLAN-CONDITIONAL since 2026-07-20, so the plan decides, not a
// date. Rewritten to assert the plan-conditional rule.

test('collector bills Fable to usage credits on a credits plan (Pro)', () => {
  const dir = setup('s');
  try {
    writeFileSync(join(dir, 'config.json'),
      JSON.stringify({ edit_hash_salt: 's', plan: 'pro' }));
    runCollector(dir, fablePayload('fable-pro', { cost: 0.05, input: 1000, output: 100, cwd: '/Users/x/p' }));
    const rec = JSON.parse(readFileSync(join(dir, 'sessions', 'fable-pro.ndjson'), 'utf8').trim());
    assert.equal(rec.model, 'claude-fable-5[1m]');
    assert.equal(rec.usage_pool, 'interactive');
    assert.equal(rec.billing_basis, 'usage_credits');
    assert.equal(rec.fable_billing, 'usage_credits');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collector keeps Fable on subscription limits for an included plan (Max)', () => {
  const dir = setup('s');
  try {
    writeFileSync(join(dir, 'config.json'),
      JSON.stringify({ edit_hash_salt: 's', plan: 'max20' }));
    runCollector(dir, fablePayload('fable-max', { cost: 0.05, input: 1000, output: 100, cwd: '/Users/x/p' }));
    const rec = JSON.parse(readFileSync(join(dir, 'sessions', 'fable-max.ndjson'), 'utf8').trim());
    assert.equal(rec.billing_basis, 'subscription_limits',
      'included Fable draws the weekly limit — it is not a credits wallet');
    assert.equal(rec.fable_billing, 'included_weekly');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collector never fabricates a Fable credits charge when no plan is set', () => {
  const dir = setup('s');
  try {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 's' }));
    runCollector(dir, fablePayload('fable-noplan', { cost: 0.05, input: 1000, output: 100, cwd: '/Users/x/p' }));
    const rec = JSON.parse(readFileSync(join(dir, 'sessions', 'fable-noplan.ndjson'), 'utf8').trim());
    assert.equal(rec.billing_basis, 'subscription_limits', 'neutral default — never a guessed charge');
    assert.equal(rec.fable_billing, 'unknown', 'and the unknown is recorded so surfaces can show both readings');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('collector never labels a non-Fable model usage_credits, on any plan', () => {
  const dir = setup('s');
  try {
    writeFileSync(join(dir, 'config.json'),
      JSON.stringify({ edit_hash_salt: 's', plan: 'pro' }));
    runCollector(dir, payload('opus-pro', { cost: 0.05, input: 1000, output: 100, cwd: '/Users/x/p' }));
    const rec = JSON.parse(readFileSync(join(dir, 'sessions', 'opus-pro.ndjson'), 'utf8').trim());
    assert.equal(rec.billing_basis, 'subscription_limits');
    assert.equal(rec.fable_billing, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// B5 REGRESSION — the duplicate guard must actually suppress duplicates.
//
// It compared the RAW payload cumulative against the stored one, which had been
// written through round6(). On an unchanged payload that leaves a sub-microcent
// residue, the guard sees a non-zero cost delta and writes a row whose own cost
// rounds to $0. Measured in the real local corpus on 2026-08-24: 3,432 such rows
// out of 24,751 (13.9%), every one carrying a cumulative identical to its
// predecessor and zero counter-examples. They carry no money but they inflate the
// denominator of every per-turn metric ($/turn, turns/day, $/active-minute).
// ───────────────────────────────────────────────────────────────────────────
test('an unchanged payload with sub-microcent cost precision writes NO second row', () => {
  const dir = setup('s');
  try {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 's' }));
    // A cumulative with more precision than round6 keeps — exactly the shape the
    // live payload produces.
    const p = payload('dup', { cost: 2.7441944999, input: 1000, output: 100, cwd: '/Users/x/p' });
    runCollector(dir, p);
    runCollector(dir, p);   // byte-identical repeat: must be suppressed
    runCollector(dir, p);
    const lines = readFileSync(join(dir, 'sessions', 'dup.ndjson'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 1, `expected 1 record, got ${lines.length} (phantom duplicate rows are back)`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a real cost movement after a duplicate still records', () => {
  const dir = setup('s');
  try {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 's' }));
    runCollector(dir, payload('mv', { cost: 1.0000004999, input: 1000, output: 100, cwd: '/Users/x/p' }));
    runCollector(dir, payload('mv', { cost: 1.0000004999, input: 1000, output: 100, cwd: '/Users/x/p' }));
    runCollector(dir, payload('mv', { cost: 2.50, input: 2000, output: 200, cwd: '/Users/x/p' }));
    const lines = readFileSync(join(dir, 'sessions', 'mv.ndjson'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 2, 'the duplicate is suppressed but the real movement is kept');
    const last = JSON.parse(lines[1]);
    assert.ok(last.cost_usd > 1.4, `real delta must survive, got ${last.cost_usd}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('B2: every record records that the model stamp is the session setting, not the serving model', () => {
  const dir = setup('s');
  try {
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 's' }));
    runCollector(dir, payload('src', { cost: 0.05, input: 1000, output: 100, cwd: '/Users/x/p' }));
    const rec = JSON.parse(readFileSync(join(dir, 'sessions', 'src.ndjson'), 'utf8').trim());
    assert.equal(rec.model_source, 'session_setting',
      'the payload carries no serving-model field, so provenance must be recorded');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
