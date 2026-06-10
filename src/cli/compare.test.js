import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');

// Run the real `compare` command against an isolated WTCLAUDE_DIR fixture.
function runCompare(dir, extraArgs = []) {
  const res = spawnSync(process.execPath, [BIN, 'compare', ...extraArgs], {
    env: { ...process.env, WTCLAUDE_DIR: dir },
    encoding: 'utf8',
  });
  return res.stdout + res.stderr;
}

// A YYYY-MM-DD label local-day-offset days in the past. Used to seed a turn that
// is inside the 7-day window but outside today's 1-day window — the exact shape
// of the reported bug (data this week, none today).
function daysAgoTs(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0); // local noon → unambiguously falls on the local day n days back
  return d.toISOString();
}

// Configured fixture: per-install salt present (setup is "complete") + one
// billing-grade turn dated `n` days ago, with NO turn today.
function configuredWithOldData(daysBack) {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-compare-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'),
    JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  const turn = {
    ts: daysAgoTs(daysBack),
    model: 'opus-4-8', speed_tier: 'standard',
    input_tokens: 300000, output_tokens: 120000,
    cache_read_tokens: 400000, cache_write_tokens: 200000,
    cost_usd: 18.42, session_id: 'sess-old',
  };
  writeFileSync(join(dir, 'sessions', 'sess-old.ndjson'), JSON.stringify(turn) + '\n');
  return dir;
}

// REGRESSION (PM-BUILD-bugfix-001): a set-up user with data this week but none
// *today* runs bare `compare` (defaults to the 1-day/today window). Before the
// fix this printed "Run: wtclaude setup" — telling a correctly-configured user
// the product is broken. It must NOT, and must show the honest set-up-aware copy.
test('compare: empty today-window does not tell a configured user to run setup', () => {
  const dir = configuredWithOldData(3);
  try {
    const out = runCompare(dir); // default --days 1 → today only → empty
    assert.doesNotMatch(out, /wtclaude setup/, 'must NOT prompt a configured user to re-run setup');
    assert.match(out, /set up and capturing/, 'should show the honest set-up-aware empty state');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The same data IS reachable through a wider window — proves the data is intact
// and only the today-window was empty (so the old "no data, run setup" framing
// was doubly wrong).
test('compare --days 7: surfaces the prior-day data the default window missed', () => {
  const dir = configuredWithOldData(3);
  try {
    const out = runCompare(dir, ['--days', '7']);
    assert.match(out, /Billing-grade/, 'the comparison table renders');
    assert.match(out, /18\.42/, 'the billing-grade cost from 3 days ago is included');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// REGRESSION (QA-0610-01): the hero comparison must render a NON-ZERO session-log
// estimate + a gap from real-shaped JSONL (usage nested under message.usage, with
// duplicate streaming partials). Before the fix this column was $0 / N/A. Fixtures
// both sides via HOME: ~/.claude/projects (JSONL) + ~/.wtclaude (billing-grade).
test('compare: renders a non-zero, deduped session-log estimate + gap from nested message.usage', () => {
  const home = mkdtempSync(join(tmpdir(), 'wtc-home-'));
  const ts = new Date(); ts.setHours(12, 0, 0, 0); // local noon → today's local window
  const tsIso = ts.toISOString();

  // Billing-grade (accurate) side: one big-input turn today.
  const wt = join(home, '.wtclaude');
  mkdirSync(join(wt, 'sessions'), { recursive: true });
  writeFileSync(join(wt, 'config.json'),
    JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  writeFileSync(join(wt, 'sessions', 's.ndjson'), JSON.stringify({
    ts: tsIso, model: 'opus-4-8', speed_tier: 'standard',
    input_tokens: 500000, output_tokens: 50000, cache_read_tokens: 10000, cache_write_tokens: 10000,
    cost_usd: 20, session_id: 's',
  }) + '\n');

  // Session-log (JSONL) side: m1 written twice (streaming dup) + m2 → deduped input 2000.
  const proj = join(home, '.claude', 'projects', 'p');
  mkdirSync(proj, { recursive: true });
  const entry = (n) => JSON.stringify({
    type: 'assistant', timestamp: tsIso, requestId: 'r' + n,
    message: { id: 'm' + n, role: 'assistant',
      usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 } },
  });
  writeFileSync(join(proj, 'sess.jsonl'), [entry(1), entry(1), entry(2)].join('\n') + '\n');

  const res = spawnSync(process.execPath, [BIN, 'compare'], {
    env: { ...process.env, HOME: home, WTCLAUDE_DIR: wt }, encoding: 'utf8',
  });
  const out = res.stdout + res.stderr;
  try {
    assert.doesNotMatch(out, /\$0\.0000/, 'session-log estimate must NOT render as $0');
    assert.match(out, /\d+(\.\d+)?x/, 'a numeric gap (Nx) must render');
    assert.match(out, /\b2K\b/, 'deduped session-log input is 2K (m1 once + m2), not 3K');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A genuinely-unconfigured install (no salt) SHOULD still be told to run setup —
// the fix must not swallow the real first-run guidance.
test('compare: an unconfigured install is still told to run setup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-compare-fresh-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  try {
    const out = runCompare(dir);
    assert.match(out, /wtclaude setup/, 'a fresh install must still be guided to setup');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
