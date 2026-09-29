import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', '..', 'bin', 'wtclaude.js');
// Only the manifest constants are read from the sync module; point it at a
// throwaway dir anyway so nothing here could touch a real ~/.wtclaude.
const MOD_DIR = mkdtempSync(join(tmpdir(), 'wtclaude-cli-mod-'));
process.env.WTCLAUDE_DIR = MOD_DIR;
const { SYNC_TURN_FIELDS } = await import('../sync/index.js');
const ISSUES_URL = JSON.parse(readFileSync(join(HERE, '..', '..', 'package.json'), 'utf8')).bugs.url;
const ID = '0a1b2c3d-0000-4000-8000-00000000abcd'; // synthetic

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
    env: { ...process.env, WTCLAUDE_DIR: dir, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude'), WTCLAUDE_NO_AUTOSYNC: '1', WTCLAUDE_AUTOSYNC_CHILD: '1' },
  });
}

after(() => { for (const d of [...dirs, MOD_DIR]) rmSync(d, { recursive: true, force: true }); });

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
  for (const g of SYNC_TURN_FIELDS) assert.ok(r.stdout.includes(g.label), `preview lists "${g.label}"`);
  assert.doesNotMatch(r.stdout, /salted hashes only/, 'the old understatement is gone');
  assert.match(r.stdout, /Confirmed via --yes/);
  assert.match(r.stdout, /Cloud sync enabled/);
  assert.match(r.stdout, /Syncing\.\.\./, 'initial push runs after opt-in');
  assert.equal(readConfig(dir).sync_enabled, true);
});

test('`sync --disable` flips off and keeps local config', () => {
  const dir = tmp();
  writeConfig(dir, { sync_enabled: true, anonymous_id: ID, last_sync_at: '2026-06-01T00:00:00Z' });
  const r = run(['sync', '--disable'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /turned off/i);
  const cfg = readConfig(dir);
  assert.equal(cfg.sync_enabled, false);
  assert.equal(cfg.anonymous_id, ID, 'local data/config retained');
  assert.equal(cfg.last_sync_at, '2026-06-01T00:00:00Z', 'last sync time retained');
});

// QA-0928-42: turning sync off doesn't delete the cloud copy — say so. Peter's
// decision: GitHub issues are public and a deletion request there would need
// the id, so the CLI never points at them; deletion isn't self-serve yet, and
// the copy promises no route that doesn't exist.
test('`sync --disable` after a sync says the cloud copy stays and never points at a public issue tracker', () => {
  const dir = tmp();
  writeConfig(dir, { sync_enabled: true, anonymous_id: ID, last_sync_at: '2026-06-01T00:00:00Z' });
  const r = run(['sync', '--disable'], dir);
  assert.match(r.stdout, /already synced stays in the cloud/i);
  assert.match(r.stdout, /isn't self-serve yet/);
  assert.doesNotMatch(r.stdout, /coming/i, 'no promise of a route that does not exist');
  assert.match(r.stdout, /don't post your anonymous id anywhere public/i);
  assert.ok(!r.stdout.includes(ISSUES_URL), 'no public issues URL');
  assert.doesNotMatch(r.stdout, /github/i);
  assert.ok(!r.stdout.includes(ID), 'never prints the full id');
});

test('the README says the same: deletion is not self-serve yet, and no public issue tracker is offered for it', () => {
  const readme = readFileSync(join(HERE, '..', '..', 'README.md'), 'utf8');
  const para = readme.split('\n').find((l) => l.includes("doesn't delete what was already uploaded")) || '';
  assert.match(para, /isn't self-serve yet/);
  assert.doesNotMatch(para, /coming/i);
  assert.doesNotMatch(para, /github|issues/i);
});

test('`sync --disable` that never synced does not claim a cloud copy', () => {
  const dir = tmp();
  writeConfig(dir, { sync_enabled: true, anonymous_id: ID });
  const r = run(['sync', '--disable'], dir);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /stays in the cloud/);
});

// QA-0928-08: a fresh install (no data dir at all) must not crash.
test('`sync --disable` on a fresh install is a clean no-op', () => {
  const dir = join(tmp(), 'never-set-up');
  const r = run(['sync', '--disable'], dir);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /already off/i);
  assert.equal(existsSync(join(dir, 'config.json')), false, 'nothing written for a no-op');
});

// QA-0928-07: an unparsable config.json is reported, never rewritten.
for (const args of [['sync', '--disable'], ['sync', '--status'], ['sync', '--enable', '--yes']]) {
  test(`\`${args.join(' ')}\` on an unparsable config.json: one-line error, exit 1, file untouched`, () => {
    const dir = tmp();
    const broken = `{\n  "sync_enabled": true,\n  "anonymous_id": "${ID}",\n}\n`;
    writeFileSync(join(dir, 'config.json'), broken);
    const r = run(args, dir);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /config\.json is not valid JSON \(line 4, column 1\)/);
    assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
    assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), broken);
  });
}

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
  writeConfig(dir, { sync_enabled: false, anonymous_id: ID });
  const r = run(['sync', '--status'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Sync:\s+off/);
  assert.match(r.stdout, /Backend:\s+ready/, 'hosted backend reads as ready out-of-the-box');
  assert.doesNotMatch(r.stdout, /--configure/, 'no leftover --configure dev-speak');
});

// QA-0928-41: the id is a dashboard password — show only its start.
test('`sync --status` and the --enable preview show the id truncated, never in full', () => {
  const dir = tmp();
  writeConfig(dir, { sync_enabled: false, anonymous_id: ID });
  for (const args of [['sync', '--status'], ['sync', '--enable']]) {
    const r = run(args, dir);
    assert.ok(r.stdout.includes('0a1b2c3d…'), `${args.join(' ')} shows the first 8 characters`);
    assert.ok(!r.stdout.includes(ID), `${args.join(' ')} never prints the full id`);
    assert.match(r.stdout, /full id: `wtclaude dashboard` links this browser/);
  }
});

// ── BUILD-018: --status tells the truth about a stuck sync ──────────────────

test('`sync --status` shows a failed last attempt and what is still waiting', () => {
  const dir = tmp();
  writeConfig(dir, {
    sync_enabled: true, anonymous_id: 'anon-stuck',
    last_sync_at: '2026-07-01T09:00:00.000Z',
    last_sync_error: { at: new Date().toISOString(), message: 'server returned 546 (WORKER_LIMIT)' },
    sync_failures: 4,
  });
  mkdirSync(join(dir, 'sessions'));
  const row = (n) => JSON.stringify({ turn: n, ts: `2026-09-2${n}T10:00:00.000Z`, model: 'claude-opus-5-5', input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.01 });
  writeFileSync(join(dir, 'sessions', 's1.ndjson'), [row(1), row(2), row(3)].join('\n') + '\n');
  const r = run(['sync', '--status'], dir);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Last sync:\s+2026-07-01T09:00:00\.000Z \(\d+ weeks ago\)/);
  assert.match(r.stdout, /Last try:\s+FAILED .*546/);
  assert.match(r.stdout, /Waiting:\s+3 turns from 1 session/);
  assert.match(r.stdout, /resume where they stopped/);
});

// QA-0928-34: a history uploaded before the server could fill missing fields
// owes a one-time re-send (sync-state version < 2); --status says so, and says
// it is automatic. A version-2 state says nothing.
test('`sync --status` names a pending one-time re-send, and only while it is pending', () => {
  const dir = tmp();
  writeConfig(dir, { sync_enabled: true, anonymous_id: ID, last_sync_at: '2026-09-27T10:00:00.000Z' });
  mkdirSync(join(dir, 'sessions'));
  const row = (n) => JSON.stringify({ turn: n, ts: `2026-09-2${n}T10:00:00.000Z`, model: 'claude-opus-5-5', input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.01 });
  writeFileSync(join(dir, 'sessions', 's1.ndjson'), [row(1), row(2)].join('\n') + '\n');
  writeFileSync(join(dir, 'sync-state.json'), JSON.stringify({ version: 1, cursors: { s1: 2 } }));
  let r = run(['sync', '--status'], dir);
  assert.equal(r.status, 0);
  // RC 2026-09-28: not "the cloud is up to date" while a re-send is owed.
  assert.match(r.stdout, /Waiting:\s+no new turns\n/);
  assert.doesNotMatch(r.stdout, /the cloud is up to date/);
  assert.match(r.stdout, /Re-send:\s+pending — earlier turns go up once more, automatically/);
  writeFileSync(join(dir, 'sync-state.json'), JSON.stringify({ version: 2, cursors: { s1: 2 } }));
  r = run(['sync', '--status'], dir);
  assert.doesNotMatch(r.stdout, /Re-send:/);
  assert.match(r.stdout, /Waiting:\s+nothing — the cloud is up to date/);
});

// QA-0928-14: an unreadable session line is skipped, never fatal — and `sync`
// and `sync --status` name the file (id and count only, never content).
test('`sync` and `sync --status` name a session file with an unreadable line', () => {
  const dir = tmp();
  writeConfig(dir, { sync_enabled: true, anonymous_id: ID, supabase_url: 'http://127.0.0.1:9' });
  mkdirSync(join(dir, 'sessions'));
  const good = JSON.stringify({ turn: 1, ts: '2026-09-27T10:00:00.000Z', model: 'claude-opus-5-5', input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.01 });
  writeFileSync(join(dir, 'sessions', 'badf00d1-0000-4000-8000-000000000001.ndjson'), good + '\n{"ts":"2026-09-27T11:00:00.000Z","input_tok\n');
  for (const args of [['sync'], ['sync', '--status']]) {
    const r = run(args, dir);
    assert.match(r.stdout, /skipped 1 unreadable line in 1 session file \(badf00d1\)/, `${args.join(' ')}:\n${r.stdout}`);
    assert.doesNotMatch(r.stdout, /input_tok/, 'never the line itself');
  }
  assert.match(run(['sync'], dir).stdout, /those lines aren't uploaded/);
});

test('`sync --status` calls a config holding the HOSTED url "ready", not self-host', () => {
  const dir = tmp();
  writeConfig(dir, { sync_enabled: false, supabase_url: 'https://dddinnggyyabbmrsrhnq.supabase.co' });
  const r = run(['sync', '--status'], dir);
  assert.match(r.stdout, /Backend:\s+ready/);
  assert.doesNotMatch(r.stdout, /self-host/);
});

test('`sync --status` still names a real self-host backend', () => {
  const dir = tmp();
  writeConfig(dir, { sync_enabled: false, supabase_url: 'https://self.example.co' });
  assert.match(run(['sync', '--status'], dir).stdout, /Backend:\s+self-host \(https:\/\/self\.example\.co\)/);
});

test('a failed manual sync exits non-zero and says nothing was lost', () => {
  const dir = tmp();
  writeConfig(dir, { sync_enabled: true, anonymous_id: ID, supabase_url: 'http://127.0.0.1:9' });
  mkdirSync(join(dir, 'sessions'));
  writeFileSync(join(dir, 'sessions', 's1.ndjson'), JSON.stringify({ turn: 1, ts: '2026-09-27T10:00:00.000Z', model: 'claude-opus-5-5', input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.01 }) + '\n');
  const r = run(['sync'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Uploaded 0 of 1 turns; 1 still waiting/);
  assert.match(r.stdout, /Nothing is lost/);
  const cfg = readConfig(dir);
  assert.match(cfg.last_sync_error.message, /network error/);
  assert.equal(cfg.last_sync_at, undefined, 'a failed sync is not recorded as a sync');
});
