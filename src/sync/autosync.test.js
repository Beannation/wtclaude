import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.WTCLAUDE_AUTOSYNC_CHILD = '1';
const { autoSyncDue, autoSyncIntervalMs } = await import('./autosync.js');

const NOW = Date.parse('2026-09-28T12:00:00Z');
const minsAgo = (m) => new Date(NOW - m * 60_000).toISOString();
const yes = () => true;
const no = () => false;

test('no opt-in, no auto-push — whatever else is true', () => {
  assert.equal(autoSyncDue({}, NOW, yes), false);
  assert.equal(autoSyncDue({ sync_enabled: false, last_sync_error: { message: 'x' } }, NOW, yes), false);
});

test('healthy: pushes new data at most once per 10 minutes', () => {
  assert.equal(autoSyncDue({ sync_enabled: true, last_sync_at: minsAgo(5) }, NOW, yes), false);
  assert.equal(autoSyncDue({ sync_enabled: true, last_sync_at: minsAgo(11) }, NOW, yes), true);
  assert.equal(autoSyncDue({ sync_enabled: true, last_sync_at: minsAgo(11) }, NOW, no), false, 'nothing new, nothing to push');
});

test('after a failure the debounce runs from the ATTEMPT, not the last success (BUILD-018)', () => {
  // A stalled install: last success months ago, a failed attempt 2 minutes ago.
  const cfg = { sync_enabled: true, last_sync_at: '2026-07-01T09:00:00.000Z', last_sync_attempt_at: minsAgo(2), last_sync_error: { message: 'server returned 546' }, sync_failures: 1 };
  assert.equal(autoSyncDue(cfg, NOW, yes), false, 'must not re-spawn a full-backlog upload on every command');
  assert.equal(autoSyncDue({ ...cfg, last_sync_attempt_at: minsAgo(11) }, NOW, no), true, 'an unfinished upload is still pending with no new file changes');
});

test('repeated failures back off: 10, 20, 40 … capped at 6 hours', () => {
  assert.equal(autoSyncIntervalMs(0), 10 * 60_000);
  assert.equal(autoSyncIntervalMs(1), 10 * 60_000);
  assert.equal(autoSyncIntervalMs(2), 20 * 60_000);
  assert.equal(autoSyncIntervalMs(3), 40 * 60_000);
  assert.equal(autoSyncIntervalMs(50), 6 * 60 * 60_000);
  const cfg = { sync_enabled: true, last_sync_attempt_at: minsAgo(30), last_sync_error: { message: 'x' }, sync_failures: 3 };
  assert.equal(autoSyncDue(cfg, NOW, yes), false, '3 failures → wait 40 min');
  assert.equal(autoSyncDue({ ...cfg, last_sync_attempt_at: minsAgo(41) }, NOW, yes), true);
});

test('auto-push piggy-backs only on real commands — never statusline, --help, typos or option values', async () => {
  const { autoSyncCommand } = await import('./autosync.js');
  const known = ['today', 'week', 'statusline', 'sync'];
  const run = (...a) => autoSyncCommand(['node', 'wtclaude', ...a], known);
  assert.equal(run('today'), 'today');
  assert.equal(run('week', '--json'), 'week');
  assert.equal(run('statusline'), null, 'statusline can be wired as the status-line command');
  assert.equal(run('today', '--help'), null);
  assert.equal(run('today', '-h'), null);
  assert.equal(run('--version'), null);
  assert.equal(run('todya'), null, 'a typo is not a command');
  assert.equal(run('--days', '7', 'week'), null, 'an option value is not a command');
  assert.equal(run('sync'), null);
  assert.equal(run(), null);
});
