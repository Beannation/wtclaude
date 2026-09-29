import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOneShot } from './quality.js';

test('computeOneShot: a target hit once is a one-shot success', () => {
  const r = computeOneShot([
    { session_id: 's1', edit_target_hash: 'aaa' },
    { session_id: 's1', edit_target_hash: 'bbb' },
  ]);
  assert.equal(r.targets, 2);
  assert.equal(r.oneShot, 2);
});

test('computeOneShot: the same target twice in a session is a retry (not one-shot)', () => {
  const r = computeOneShot([
    { session_id: 's1', edit_target_hash: 'aaa' },
    { session_id: 's1', edit_target_hash: 'aaa' },
  ]);
  assert.equal(r.targets, 1);
  assert.equal(r.oneShot, 0);
});

test('computeOneShot: the same hash in different sessions is two separate targets', () => {
  const r = computeOneShot([
    { session_id: 's1', edit_target_hash: 'aaa' },
    { session_id: 's2', edit_target_hash: 'aaa' },
  ]);
  assert.equal(r.targets, 2);
  assert.equal(r.oneShot, 2);
});

test('computeOneShot: turns without an edit_target_hash are ignored (coverage)', () => {
  const r = computeOneShot([
    { session_id: 's1', edit_target_hash: null },
    { session_id: 's1' },
    { session_id: 's1', edit_target_hash: 'aaa' },
  ]);
  assert.equal(r.total, 3);
  assert.equal(r.withHash, 1);
  assert.equal(r.targets, 1);
  assert.equal(r.oneShot, 1);
});

test('computeOneShot: all-null payloads yield zero targets (honest empty state)', () => {
  const r = computeOneShot([{ session_id: 's1' }, { session_id: 's1' }]);
  assert.equal(r.withHash, 0);
  assert.equal(r.targets, 0);
});

// ───────────────────────────────────────────────────────────────────────────
// QA-0928-169 (BUILD-018): `quality` echoed "foo"/"bar" back as its range, and
// with no turns at all blamed the Claude Code payload for a null field.
// ───────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');
function quality(args, dir) {
  const r = spawnSync(process.execPath, [BIN, 'quality', ...args], {
    env: { ...process.env, WTCLAUDE_NO_AUTOSYNC: '1', TZ: 'America/New_York', WTCLAUDE_DIR: dir, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude') }, encoding: 'utf8',
  });
  return { out: r.stdout + r.stderr, status: r.status };
}

test('QA-0928-169: bad --since/--until are refused like today/week do', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-quality-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  try {
    const r = quality(['--since', 'foo', '--until', 'bar', '--json'], dir);
    assert.equal(r.status, 1);
    assert.match(r.out, /--since must be YYYY-MM-DD \(got "foo"\)/);
    assert.doesNotMatch(r.out, /"since": "foo"/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-169: with no turns, the cold-start copy — not a payload excuse', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-quality-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  try {
    const { out } = quality([], dir);
    assert.match(out, /No usage data for \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2} yet\./);
    assert.doesNotMatch(out, /null on the current Claude Code payloads/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// QA-0928-56 (quality half): --until alone kept the default start, anchored on
// today, so `quality --until <a past date>` covered today-29..<date> — an empty
// or inverted range. It now ends quality's own 30-day window on that day.
test('QA-0928-56: --until alone ends the 30-day window on that day; both bounds are kept as given', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-quality-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  try {
    const r = quality(['--until', '2026-07-01', '--json'], dir);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(JSON.parse(r.out).range, { since: '2026-06-02', until: '2026-07-01' });
    const both = JSON.parse(quality(['--since', '2026-06-10', '--until', '2026-06-20', '--json'], dir).out);
    assert.deepEqual(both.range, { since: '2026-06-10', until: '2026-06-20' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
