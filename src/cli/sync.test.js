import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', '..', 'bin', 'wtclaude.js');

const dirs = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'wtclaude-cli-'));
  dirs.push(d);
  return d;
}
function writeConfig(dir, obj) { writeFileSync(join(dir, 'config.json'), JSON.stringify(obj, null, 2)); }
function readConfig(dir) {
  const p = join(dir, 'config.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
}

// spawnSync leaves stdin as a (non-TTY) pipe — exactly the non-interactive case
// the opt-in must refuse without --yes. WTCLAUDE_AUTOSYNC_CHILD/NO_AUTOSYNC keep
// the test from spawning any detached background sync.
function run(args, dir) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, WTCLAUDE_DIR: dir, WTCLAUDE_NO_AUTOSYNC: '1', WTCLAUDE_AUTOSYNC_CHILD: '1' },
  });
}

after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

// ── A2 / A4(a): a bare `sync` never uploads unless already opted in ──────────

test('bare `sync` with sync disabled uploads nothing and points to --enable', () => {
  const dir = tmp();
  writeConfig(dir, { sync_enabled: false, anonymous_id: 'anon-x' });
  const r = run(['sync'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Cloud sync is off/);
  assert.match(r.stdout, /sync --enable/);
  assert.doesNotMatch(r.stdout, /Syncing\.\.\./, 'must not start an upload');
  const cfg = readConfig(dir);
  assert.equal(cfg.sync_enabled, false, 'bare sync must not enable');
  assert.equal(cfg.last_sync_at, undefined, 'bare sync must not record an upload');
});

test('bare `sync` with no opt-in key at all also refuses (defaults to off)', () => {
  const dir = tmp();
  const r = run(['sync'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Cloud sync is off/);
  assert.notEqual(readConfig(dir).sync_enabled, true);
});

// ── A4(d): --enable / --disable flip state ───────────────────────────────────

test('`sync --enable --yes` shows the preview, flips on, and does an initial push', () => {
  const dir = tmp();
  const r = run(['sync', '--enable', '--yes'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /privacy preview/i);
  assert.match(r.stdout, /salted hashes only/);
  assert.match(r.stdout, /Confirmed via --yes/);
  assert.match(r.stdout, /Cloud sync enabled/);
  assert.match(r.stdout, /Syncing\.\.\./, 'initial push runs after opt-in');
  assert.equal(readConfig(dir).sync_enabled, true);
});

test('`sync --disable` flips off and keeps local config', () => {
  const dir = tmp();
  writeConfig(dir, { sync_enabled: true, anonymous_id: 'keep-me', last_sync_at: '2026-06-01T00:00:00Z' });
  const r = run(['sync', '--disable'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /turned off/i);
  const cfg = readConfig(dir);
  assert.equal(cfg.sync_enabled, false);
  assert.equal(cfg.anonymous_id, 'keep-me', 'local data/config retained');
  assert.equal(cfg.last_sync_at, '2026-06-01T00:00:00Z', 'last sync time retained');
});

// ── A4(e): --enable honors --yes / refuses on non-TTY without --yes ──────────

test('`sync --enable` refuses on a non-TTY without --yes (no enable, no upload)', () => {
  const dir = tmp();
  const r = run(['sync', '--enable'], dir); // stdin is a pipe → not a TTY
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Non-interactive shell/);
  assert.match(r.stdout, /--yes/);
  assert.match(r.stdout, /NOT enabled/);
  assert.notEqual(readConfig(dir).sync_enabled, true);
});

// ── A2: the public `--configure` paste-your-key flow is gone ─────────────────

test('the public `sync --configure` flow has been removed', () => {
  const dir = tmp();
  const r = run(['sync', '--configure'], dir);
  assert.notEqual(r.status, 0, '--configure is no longer a valid option');
  assert.match(r.stderr, /unknown option/i);
  assert.doesNotMatch(r.stdout, /Supabase Configuration/, 'no paste-your-key instructions');
});

// ── --status: clean wording, no dev-speak ────────────────────────────────────

test('`sync --status` reports on/off + backend without dev-speak', () => {
  const dir = tmp();
  writeConfig(dir, { sync_enabled: false, anonymous_id: 'anon-id-123' });
  const r = run(['sync', '--status'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Sync:\s+off/);
  assert.match(r.stdout, /Backend:\s+ready/, 'hosted backend reads as ready out-of-the-box');
  assert.match(r.stdout, /anon-id-123/);
  assert.doesNotMatch(r.stdout, /--configure/, 'no leftover --configure dev-speak');
});
