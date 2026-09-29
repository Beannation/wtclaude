process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDaysOption, coveredDays, splitHistory, windowStart, projectionNote } from './window.js';

// ───────────────────────────────────────────────────────────────────────────
// QA-0928-74: `--days abc` printed "No usage data for NaN-NaN-NaN to …",
// `--days 0` an inverted range, and forecast clamped 0 to 7 without a word.
// QA-0928-22 / 73: every "/month" projection divided by the requested window
// (30x understated on a first-day user) or by the days WITH usage (3.5x
// overstated on a part-time one). One helper for both, pinned here.
// ───────────────────────────────────────────────────────────────────────────

test('parseDaysOption accepts whole positive days and rejects everything else', () => {
  assert.equal(parseDaysOption('30'), 30);
  assert.equal(parseDaysOption('1'), 1);
  assert.equal(parseDaysOption(' 7 '), 7);
  assert.equal(parseDaysOption('365'), 365);
  for (const bad of ['abc', '0', '-3', '1.5', '', '7d', 'NaN', '366']) {
    assert.throws(() => parseDaysOption(bad), /whole number of days, 1 or more/, `"${bad}" must be refused`);
  }
});

test('coveredDays: the whole window when tracking predates it, else since the first tracked day', () => {
  // 3 days of data in a 30-day window divides by 3 (QA-0928-22's pinned case).
  assert.equal(coveredDays(30, '2026-09-26', '2026-09-28'), 3);
  // Tracking began long before the window: the window, never the active days.
  assert.equal(coveredDays(30, '2026-06-15', '2026-09-28'), 30);
  assert.equal(coveredDays(7, '2026-09-28', '2026-09-28'), 1);
  assert.equal(coveredDays(30, null, '2026-09-28'), null, 'nothing tracked -> no projection basis');
  // Whole calendar days across the DST change (Nov 1 2026, America/New_York).
  assert.equal(coveredDays(30, '2026-10-30', '2026-11-02'), 4);
});

test('windowStart counts back in LOCAL calendar days', () => {
  assert.equal(windowStart(1, new Date('2026-09-28T02:30:00Z')), '2026-09-27', '22:30 EDT is still the 27th');
  assert.equal(windowStart(7, new Date('2026-09-28T16:00:00Z')), '2026-09-22');
});

test('splitHistory keeps the window and remembers the first tracked local day', () => {
  const sessions = [
    { session_id: 'a', turns: [{ ts: '2026-09-01T03:00:00Z' }, { ts: '2026-09-27T15:00:00Z' }] },
    { session_id: 'b', turns: [{ ts: '2026-09-20T12:00:00Z' }] },
  ];
  const r = splitHistory(sessions, '2026-09-20', '2026-09-28');
  // 2026-09-01T03:00Z is 23:00 EDT on Aug 31 — the local day is what counts.
  assert.equal(r.firstDate, '2026-08-31');
  assert.deepEqual(r.sessions.map(s => [s.session_id, s.turns.length]), [['a', 1], ['b', 1]]);
  assert.deepEqual(splitHistory([], '2026-09-20', '2026-09-28'), { sessions: [], firstDate: null });
});

test('projectionNote says which basis a projection used', () => {
  assert.equal(projectionNote(30, 30), 'projected from the full 30-day window');
  assert.equal(projectionNote(3, 30), 'projected from 3 days of data — tracking began inside the 30-day window');
  assert.equal(projectionNote(1, 1), 'projected from the full 1-day window');
});

// End to end: the commands this stream owns refuse a bad --days with a usage
// error (exit 1) instead of a NaN date, an inverted range or a silent clamp.
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');
test('whatif, compare-models, forecast and fable reject a bad --days with a usage error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-days-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  try {
    for (const cmd of ['whatif', 'compare-models', 'forecast', 'fable']) {
      for (const bad of ['abc', '0', '-3', '366']) {
        const r = spawnSync(process.execPath, [BIN, cmd, `--days=${bad}`], {
          env: { ...process.env, WTCLAUDE_NO_AUTOSYNC: '1', WTCLAUDE_DIR: dir, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude'), WTCLAUDE_COWORK_AUDIT: join(dir, 'none.jsonl') },
          encoding: 'utf8',
        });
        assert.equal(r.status, 1, `${cmd} --days=${bad} must exit 1:\n${r.stdout}${r.stderr}`);
        assert.match(r.stderr, /whole number of days, 1 or more/, `${cmd} --days=${bad}`);
        assert.doesNotMatch(r.stdout + r.stderr, /NaN|No usage data/, `${cmd} --days=${bad}`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
