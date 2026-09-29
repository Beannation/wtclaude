import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, appendFileSync, statSync, readdirSync, utimesSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { saltedHash } from '../utils/hash.js';

const COLLECTOR = join(dirname(fileURLToPath(import.meta.url)), 'index.js');

// Run the real collector with a piped payload against an isolated WTCLAUDE_DIR.
// A string payload is piped as-is (for malformed-input tests).
function runCollector(dir, payload, extraEnv = {}) {
  const res = spawnSync(process.execPath, [COLLECTOR], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    env: { ...process.env, WTCLAUDE_DIR: dir, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude'), TZ: 'America/New_York', ...extraEnv },
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
// rounds to $0. In a real local corpus these were a sizeable share of all rows,
// every one carrying a cumulative identical to its predecessor, with no
// counter-examples. They carry no money but they inflate the
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

// ── BUILD-018: the status-line context figure (it read about twice the context) ─
// Claude Code's statusline docs (read 2026-09-28): context_window.total_input_tokens
// is the tokens CURRENTLY IN THE CONTEXT WINDOW, and it already includes
// cache_creation + cache_read; used_percentage uses the same input-only sum.
// The old figure added total_input + total_output + current_usage cache read +
// cache write — counting cached tokens twice — and labelled a context snapshot
// "tok" as if it were session usage.
function payload280(sessionId, cost) {
  return {
    session_id: sessionId,
    model: { id: 'claude-opus-5-5[1m]' },
    cost: { total_cost_usd: cost },
    context_window: {
      total_input_tokens: 150_000, total_output_tokens: 1_000,
      context_window_size: 1_000_000, used_percentage: 15,
      current_usage: { input_tokens: 500, output_tokens: 1_000, cache_creation_input_tokens: 1_500, cache_read_input_tokens: 148_000 },
    },
    fast_mode: false,
  };
}

test('status line shows the context size once, labelled as context — cache not double-counted', () => {
  const dir = setup('s-ctx');
  try {
    const r = runCollector(dir, payload280('ctx1', 2.4567));
    assert.equal(r.stdout, 'wtclaude · $2.46 · context 150K');
    assert.equal(r.stderr, '');
    // The duplicate-update path (nothing changed) renders the same figure.
    const r2 = runCollector(dir, payload280('ctx1', 2.4567));
    assert.equal(r2.stdout, 'wtclaude · $2.46 · context 150K');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('status line omits the context figure before the first API response (total 0)', () => {
  const dir = setup('s-ctx0');
  try {
    const p = payload280('ctx0', 0);
    p.context_window = { total_input_tokens: 0, total_output_tokens: 0, current_usage: null, used_percentage: null };
    const r = runCollector(dir, p);
    assert.equal(r.stdout, 'wtclaude · $0.00');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('`wtclaude statusline` preview renders the same context figure from the stored turn', () => {
  const dir = setup('s-ctx-cli');
  try {
    runCollector(dir, payload280('ctx2', 1.5));
    const bin = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');
    const r = spawnSync(process.execPath, [bin, 'statusline'], {
      env: { ...process.env, WTCLAUDE_DIR: dir, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude'), WTCLAUDE_NO_AUTOSYNC: '1' }, encoding: 'utf8',
    });
    assert.equal(r.stdout.trim(), 'wtclaude · $1.50 · context 150K');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── BUILD-018 / QA-0928 collector fixes ─────────────────────────────────────

function rows(dir, id) {
  const f = join(dir, 'sessions', `${id}.ndjson`);
  if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter(Boolean).flatMap(l => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}
const sumCost = rs => Math.round(rs.reduce((a, r) => a + (typeof r.cost_usd === 'number' ? r.cost_usd : 0), 0) * 1e6) / 1e6;

// QA-0928-12: a resume/restart resets cost.total_cost_usd inside one session_id.
// The drop used to be clamped to $0 and every later turn compared against the
// stale pre-reset figure, so $1.10 vanished and the status line said $3.00.
test('QA-0928-12: a large drop in the cumulative cost is a counter reset — nothing is lost', () => {
  const dir = setup('s-reset');
  try {
    const cwd = '/Users/x/p';
    runCollector(dir, payload('rs', { cost: 3.00, input: 90_000, output: 9_000, cwd }));
    const r2 = runCollector(dir, payload('rs', { cost: 0.20, input: 5_000, output: 500, cwd }));
    const r3 = runCollector(dir, payload('rs', { cost: 1.10, input: 20_000, output: 2_000, cwd }));
    assert.match(r2.stdout, /^wtclaude · \$0\.20/, 'status shows the payload figure, never the stale $3.00');
    assert.match(r3.stdout, /^wtclaude · \$1\.10/);
    const rs = rows(dir, 'rs');
    assert.equal(rs.length, 3);
    assert.equal(rs[1].counter_reset, true, 'the reset row is stamped');
    assert.ok(Math.abs(rs[1].cost_usd - 0.20) < 1e-9, `post-reset delta is the new cumulative, got ${rs[1].cost_usd}`);
    assert.ok(Math.abs(rs[2].cost_usd - 0.90) < 1e-9, `next delta is against the reset row, got ${rs[2].cost_usd}`);
    assert.equal(sumCost(rs), 4.10, 'rows sum to $3.00 + $1.10');
    assert.equal(rs[2].counter_reset, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-12: a resume that restarts at $0 with unchanged tokens still records the reset (S6f)', () => {
  const dir = setup('s-resume');
  try {
    const cwd = '/Users/x/p';
    runCollector(dir, payload('rz', { cost: 0.40, input: 50_000, output: 1_000, cwd }));
    // Resume: counter restarts at $0; context tokens are restored unchanged.
    const r = runCollector(dir, payload('rz', { cost: 0, input: 50_000, output: 1_000, cwd }));
    assert.equal(r.stdout.startsWith('wtclaude · $0.00'), true);
    runCollector(dir, payload('rz', { cost: 0.60, input: 60_000, output: 2_000, cwd }));
    const rs = rows(dir, 'rz');
    assert.equal(rs.length, 3, 'the $0 reset row is the new baseline');
    assert.equal(sumCost(rs), 1.00, 'the $0.60 post-resume turn counts in full (was recorded as $0.20)');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-12: a small downward recompute is not a reset (no double count), but the status shows the payload figure', () => {
  const dir = setup('s-dip');
  try {
    const cwd = '/Users/x/p';
    runCollector(dir, payload('dp', { cost: 3.00, input: 10_000, output: 1_000, cwd }));
    const r = runCollector(dir, payload('dp', { cost: 2.98, input: 10_000, output: 1_000, cwd }));
    assert.match(r.stdout, /^wtclaude · \$2\.98/);
    runCollector(dir, payload('dp', { cost: 3.10, input: 11_000, output: 1_100, cwd }));
    const rs = rows(dir, 'dp');
    assert.equal(rs.length, 2, 'the dip writes nothing');
    assert.equal(sumCost(rs), 3.10);
    assert.equal(rs.some(x => x.counter_reset), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// QA-0928-146: a reading after an unanchored row counted as $0, and a numeric
// string was not accepted as a cost.
test('QA-0928-146: the first numeric anchor after an unanchored row counts in full', () => {
  const dir = setup('s-146');
  try {
    const noCost = { session_id: 'na', model: { id: 'claude-opus-4-8' }, context_window: { total_input_tokens: 1000, total_output_tokens: 100 } };
    runCollector(dir, noCost);
    runCollector(dir, payload('na', { cost: 2.5, input: 2000, output: 200, cwd: '/Users/x/p' }));
    const rs = rows(dir, 'na');
    assert.equal(rs.length, 2);
    assert.equal(rs[1].cost_usd, 2.5, 'the $2.50 anchor is not lost behind the unanchored row');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-146: deltas walk back past an unanchored row to the last anchor', () => {
  const dir = setup('s-146b');
  try {
    runCollector(dir, payload('wb', { cost: 1.0, input: 1000, output: 100, cwd: '/Users/x/p' }));
    runCollector(dir, { session_id: 'wb', model: { id: 'claude-opus-4-8' }, context_window: { total_input_tokens: 1500, total_output_tokens: 150 } });
    runCollector(dir, payload('wb', { cost: 1.5, input: 2000, output: 200, cwd: '/Users/x/p' }));
    const rs = rows(dir, 'wb');
    assert.equal(rs.length, 3);
    assert.equal(rs[1].cost_usd, null);
    assert.ok(Math.abs(rs[2].cost_usd - 0.5) < 1e-9, `delta from the $1.00 anchor, got ${rs[2].cost_usd}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-146: a finite numeric-string cost is coerced', () => {
  const dir = setup('s-146c');
  try {
    const p = payload('str', { cost: 0, input: 1000, output: 100, cwd: '/Users/x/p' });
    p.cost.total_cost_usd = '0.75';
    const r = runCollector(dir, p);
    assert.match(r.stdout, /^wtclaude · \$0\.75/);
    assert.equal(rows(dir, 'str')[0].cost_usd, 0.75);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// QA-0928-13: a truncated last line (crash mid-append) made getLastRecord
// return null → the next payload was recorded as turn 1 with the FULL
// cumulative (double count), glued onto the fragment.
test('QA-0928-13: after a truncated last line the next record starts a new line and deltas from the last good row', () => {
  const dir = setup('s-13');
  try {
    const f = join(dir, 'sessions', 'tr.ndjson');
    runCollector(dir, payload('tr', { cost: 1.0, input: 1000, output: 100, cwd: '/Users/x/p' }));
    appendFileSync(f, '{"ts":"2026-09-28T00:00:00.000Z","session_id":"tr","turn":2,"cost_us'); // no newline
    runCollector(dir, payload('tr', { cost: 13.0, input: 5000, output: 500, cwd: '/Users/x/p' }));
    const lines = readFileSync(f, 'utf8').split('\n').filter(Boolean);
    assert.equal(lines.length, 3, 'good row, the untouched fragment, the new row on its own line');
    const last = JSON.parse(lines[2]);
    assert.equal(last.turn, 2);
    assert.equal(last.cost_usd, 12, 'delta from the last good row, not the full cumulative');
    assert.equal(sumCost(rows(dir, 'tr')), 13);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// QA-0928-147: only the tail is read. The last record is still found when it
// is longer than the first tail window, and in a large file.
test('QA-0928-147: the last record is found in a large file and past a >64 KB last line', () => {
  const dir = setup('s-147');
  try {
    const f = join(dir, 'sessions', 'big.ndjson');
    const base = { session_id: 'big', model: 'claude-opus-4-8', cumulative_input: 0, cumulative_output: 0, cumulative_cache_read: 0, cumulative_cache_write: 0 };
    let buf = '';
    for (let i = 1; i <= 20_000; i++) buf += JSON.stringify({ ...base, turn: i, cost_usd: 0.0001, cumulative_cost_usd: Math.round(i * 1e-4 * 1e6) / 1e6, cumulative_input: i, pad: 'x'.repeat(400) }) + '\n';
    // A last row wider than 64 KB (e.g. a long tool list).
    buf += JSON.stringify({ ...base, turn: 20_001, cost_usd: 0.0001, cumulative_cost_usd: 2.0001, cumulative_input: 20_001, tool_names: Array(20_000).fill('Read') }) + '\n';
    writeFileSync(f, buf);
    assert.ok(statSync(f).size > 8 * 1024 * 1024);
    runCollector(dir, payload('big', { cost: 2.5001, input: 30_000, output: 0, cwd: '/Users/x/p' }));
    const last = JSON.parse(readFileSync(f, 'utf8').trim().split('\n').pop());
    assert.equal(last.turn, 20_002);
    assert.ok(Math.abs(last.cost_usd - 0.5) < 1e-9, `got ${last.cost_usd}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// QA-0928-49: the session-start payload (cost 0, tokens 0) wrote a $0 turn-1 row
// in almost every real session, and a no-cost, no-token payload wrote a junk row.
test('QA-0928-49: the session-start payload writes nothing; the first real turn is turn 1', () => {
  const dir = setup('s-49');
  try {
    const start = { session_id: 'st', model: { id: 'claude-opus-5-5' }, cost: { total_cost_usd: 0 },
      context_window: { total_input_tokens: 0, total_output_tokens: 0, current_usage: null, used_percentage: null } };
    const r = runCollector(dir, start);
    assert.equal(r.stdout, 'wtclaude · $0.00', 'the status line still renders');
    assert.equal(existsSync(join(dir, 'sessions', 'st.ndjson')), false, 'no row for an unbilled, unused start payload');
    runCollector(dir, payload('st', { cost: 0.05, input: 1000, output: 100, cwd: '/Users/x/p' }));
    const rs = rows(dir, 'st');
    assert.equal(rs.length, 1);
    assert.equal(rs[0].turn, 1);

    // No cost anchor AND no tokens: breadcrumb only, never a row.
    runCollector(dir, { session_id: 'junk', model: { id: 'claude-opus-5-5' }, context_window: {} });
    assert.equal(existsSync(join(dir, 'sessions', 'junk.ndjson')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// QA-0928-52: a payload with tokens but no cost block was stored as cost_usd 0,
// which every reader shows as a billing-grade $0.
test('QA-0928-52: a missing cost anchor is stored as null, and an unchanged unanchored payload still dedupes', () => {
  const dir = setup('s-52');
  try {
    const p = { session_id: 'nc', model: { id: 'claude-opus-5-5' }, context_window: { total_input_tokens: 90_000, total_output_tokens: 20_000 } };
    const r = runCollector(dir, p);
    assert.equal(r.stdout.startsWith('wtclaude · $—'), true);
    runCollector(dir, p);
    const rs = rows(dir, 'nc');
    assert.equal(rs.length, 1, 'duplicate guard still holds with no anchor');
    assert.equal(rs[0].cost_usd, null, 'unanchored → null, so readers label it an estimate');
    assert.equal(rs[0].cumulative_cost_usd, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// QA-0928-48: collector.log gained a line per turn for fallback ids and never
// rotated (a real install's grew to megabytes of identical fallback lines).
test('QA-0928-48: a fallback model id is logged once per session, not once per turn', () => {
  const dir = setup('s-48');
  try {
    for (let i = 1; i <= 50; i++) {
      const p = payload('fb', { cost: i * 0.01, input: i * 100, output: i * 10, cwd: '/Users/x/p' });
      p.model = { id: 'claude-opus-6' };
      runCollector(dir, p);
    }
    assert.equal(rows(dir, 'fb').length, 50);
    const log = readFileSync(join(dir, 'collector.log'), 'utf8').trim().split('\n');
    assert.equal(log.length, 1, `expected 1 breadcrumb, got ${log.length}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-48: collector.log rotates at its size cap and never stores raw payload bytes', () => {
  const dir = setup('s-48b');
  try {
    const logFile = join(dir, 'collector.log');
    writeFileSync(logFile, 'x'.repeat(300 * 1024) + '\n');
    runCollector(dir, '{"cwd":"/Users/secret-person/secret-project", broken');
    assert.ok(existsSync(logFile + '.1'), 'the full log was rotated to collector.log.1');
    assert.ok(statSync(logFile).size < 1024, 'and a fresh log started');
    const text = readFileSync(logFile, 'utf8');
    assert.match(text, /unparseable payload/);
    assert.ok(!text.includes('secret'), 'no raw payload bytes (the cwd) in the log');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// QA-0928-50: git_branch was cached for the whole cwd stretch, so a mid-session
// checkout kept the old branch (and one git timeout cached null).
test('QA-0928-50: a checkout between turns records the new branch (worktree .git files too)', () => {
  const dir = setup('s-50');
  const repo = mkdtempSync(join(tmpdir(), 'wtc-repo-'));
  try {
    mkdirSync(join(repo, '.git'));
    mkdirSync(join(repo, 'src', 'deep'), { recursive: true });
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/alpha\n');
    const cwd = join(repo, 'src', 'deep');
    runCollector(dir, payload('gb', { cost: 0.10, input: 1000, output: 100, cwd }));
    writeFileSync(join(repo, '.git', 'HEAD'), 'ref: refs/heads/feature/beta\n');
    runCollector(dir, payload('gb', { cost: 0.20, input: 2000, output: 200, cwd }));
    writeFileSync(join(repo, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n'); // detached
    runCollector(dir, payload('gb', { cost: 0.30, input: 3000, output: 300, cwd }));
    assert.deepEqual(rows(dir, 'gb').map(r => r.git_branch), ['alpha', 'feature/beta', null]);

    // A linked worktree: .git is a file pointing at the real gitdir.
    const wt = join(repo, 'wt');
    mkdirSync(join(repo, '.git', 'worktrees', 'w1'), { recursive: true });
    writeFileSync(join(repo, '.git', 'worktrees', 'w1', 'HEAD'), 'ref: refs/heads/gamma\n');
    mkdirSync(wt);
    writeFileSync(join(wt, '.git'), `gitdir: ${join(repo, '.git', 'worktrees', 'w1')}\n`);
    runCollector(dir, payload('gw', { cost: 0.10, input: 1000, output: 100, cwd: wt }));
    assert.equal(rows(dir, 'gw')[0].git_branch, 'gamma');
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(repo, { recursive: true, force: true });
  }
});

// QA-0928-149: with no per-install salt, project_hash fell back to the public
// constant 'wtclaude' (or the anonymous id), so a guessed path could be confirmed.
test('QA-0928-149: no per-install salt → project_hash null, never a constant or the anonymous id', () => {
  for (const cfg of [null, { anonymous_id: '00000000-0000-4000-8000-000000000000' }, '{ not json,']) {
    const dir = mkdtempSync(join(tmpdir(), 'wtc-collector-'));
    try {
      mkdirSync(join(dir, 'sessions'), { recursive: true });
      if (cfg !== null) writeFileSync(join(dir, 'config.json'), typeof cfg === 'string' ? cfg : JSON.stringify(cfg));
      runCollector(dir, payload('ns', { cost: 0.01, input: 100, output: 10, cwd: '/Users/x/projectZ' }));
      const [r] = rows(dir, 'ns');
      assert.equal(r.project_hash, null, `config ${JSON.stringify(cfg)}`);
      assert.equal(r.git_branch, null);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

// QA-0928-150: a crafted session_id wrote outside ~/.wtclaude/sessions.
test('QA-0928-150: a traversal session_id writes nothing outside sessions/ and still exits 0', () => {
  const outer = mkdtempSync(join(tmpdir(), 'wtc-trav-'));
  const dir = join(outer, 'a', 'b');
  try {
    mkdirSync(join(dir, 'sessions'), { recursive: true });
    writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 's' }));
    runCollector(dir, payload('../../escaped', { cost: 0.01, input: 100, output: 10, cwd: '/Users/x/p' }));
    runCollector(dir, payload('../../../escaped2', { cost: 0.01, input: 100, output: 10, cwd: '/Users/x/p' }));
    assert.equal(existsSync(join(outer, 'a', 'escaped.ndjson')), false);
    assert.equal(existsSync(join(outer, 'escaped2.ndjson')), false);
    assert.deepEqual(readdirSync(join(dir, 'sessions')), []);
  } finally {
    rmSync(outer, { recursive: true, force: true });
  }
});

// QA-0928-152: the CI/GITHUB_ACTIONS env heuristic stamped interactive turns
// agent_sdk / agent_sdk_credits — a pool whose split is paused.
test('QA-0928-152: CI=true in the environment does not relabel an interactive turn', () => {
  const dir = setup('s-152');
  try {
    runCollector(dir, payload('ci', { cost: 0.05, input: 1000, output: 100, cwd: '/Users/x/p' }), { CI: 'true', GITHUB_ACTIONS: 'true' });
    const [r] = rows(dir, 'ci');
    assert.equal(r.usage_pool, 'interactive');
    assert.equal(r.billing_basis, 'subscription_limits');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// QA-0928-151: overlapping runs for one session both booked the same interval
// (34 of 40 forced trials). The final re-read + append is now serialised.
test('QA-0928-151: two collectors started together never over-record', async () => {
  const dir = setup('s-151');
  try {
    const env = { ...process.env, WTCLAUDE_DIR: dir, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude'), TZ: 'America/New_York' };
    const start = (p) => new Promise(res => {
      const c = spawn(process.execPath, [COLLECTOR], { env });
      c.on('exit', res);
      c.stdin.end(JSON.stringify(p));
    });
    for (let t = 0; t < 8; t++) {
      const id = `race${t}`;
      runCollector(dir, payload(id, { cost: 1.0, input: 1000, output: 10, cwd: '/Users/x/p' }));
      await Promise.all([
        start(payload(id, { cost: 1.5, input: 1500, output: 10, cwd: '/Users/x/p' })),
        start(payload(id, { cost: 2.0, input: 2000, output: 10, cwd: '/Users/x/p' })),
      ]);
      assert.ok(sumCost(rows(dir, id)) <= 2.0, `trial ${t}: rows sum to ${sumCost(rows(dir, id))} > the final $2.00`);
      assert.equal(existsSync(join(dir, 'sessions', `${id}.ndjson.lock`)), false, 'the lock is released');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-151: a held lock skips the update without losing money; a stale lock is taken over', () => {
  const dir = setup('s-151b');
  try {
    const lock = join(dir, 'sessions', 'lk.ndjson.lock');
    runCollector(dir, payload('lk', { cost: 1.0, input: 1000, output: 10, cwd: '/Users/x/p' }));
    writeFileSync(lock, '');                                   // another run holds it
    const r = runCollector(dir, payload('lk', { cost: 1.5, input: 1500, output: 10, cwd: '/Users/x/p' }));
    assert.match(r.stdout, /^wtclaude · \$1\.50/, 'the status line still renders');
    assert.equal(rows(dir, 'lk').length, 1, 'contended update skipped');
    unlinkSync(lock);
    runCollector(dir, payload('lk', { cost: 2.0, input: 2000, output: 10, cwd: '/Users/x/p' }));
    assert.equal(sumCost(rows(dir, 'lk')), 2.0, 'the next update books what the skipped one carried');

    writeFileSync(lock, '');                                   // left behind by a killed run
    const old = new Date(Date.now() - 10_000);
    utimesSync(lock, old, old);
    runCollector(dir, payload('lk', { cost: 2.5, input: 2500, output: 10, cwd: '/Users/x/p' }));
    assert.equal(sumCost(rows(dir, 'lk')), 2.5, 'a stale lock never blocks capture');
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── RC 2026-09-28: telling a stale payload from a counter restart ────────────
// The 50% rule alone could not: a stale payload from an overlapping run that
// dropped below half was booked as a reset (double counting), and a restart
// whose first reading stayed at or above half was clamped (losing it). Claude
// Code's cost.total_duration_ms is wall-clock time since its process started
// and restarts with the cost counter (a real reset in a local corpus
// did exactly that), so "reading time − duration" dates the process: a new
// process started after the last anchored row is a restart; the same process
// is an out-of-order older payload, which is skipped.
function payloadD(sessionId, cost, durationMs, input = 10_000) {
  return { ...payload(sessionId, { cost, input, output: 1_000, cwd: '/Users/x/p' }), cost: { total_cost_usd: cost, total_duration_ms: durationMs } };
}

test('an out-of-order stale payload from the same process is skipped, not booked as a reset', () => {
  const dir = setup('s-stale');
  try {
    runCollector(dir, payloadD('st1', 0.20, 600_000, 10_000));
    runCollector(dir, payloadD('st1', 0.05, 300_000, 5_000));   // older snapshot, arriving late
    runCollector(dir, payloadD('st1', 0.30, 610_000, 12_000));
    const rs = rows(dir, 'st1');
    assert.equal(sumCost(rs), 0.30, `rows ${JSON.stringify(rs.map(r => r.cost_usd))}`);
    assert.ok(rs.every(r => r.counter_reset !== true), 'no reset');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a restart whose first reading is still above half the old total is booked in full', () => {
  const dir = setup('s-restart');
  try {
    runCollector(dir, payloadD('rs2', 1.00, 600_000, 50_000));
    // The previous process's last reading was an hour ago.
    const f = join(dir, 'sessions', 'rs2.ndjson');
    const [first] = readFileSync(f, 'utf8').trim().split('\n').map(JSON.parse);
    first.ts = new Date(Date.now() - 3_600_000).toISOString();
    writeFileSync(f, JSON.stringify(first) + '\n');
    // A new process (30 s old) whose $0 start-up payload was missed.
    runCollector(dir, payloadD('rs2', 0.60, 30_000, 20_000));
    runCollector(dir, payloadD('rs2', 0.90, 40_000, 25_000));
    const rs = rows(dir, 'rs2');
    assert.equal(sumCost(rs), 1.90, `rows ${JSON.stringify(rs.map(r => r.cost_usd))}`);
    assert.equal(rs[1].counter_reset, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
