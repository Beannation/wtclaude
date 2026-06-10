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
