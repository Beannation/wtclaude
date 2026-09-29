import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Privacy surfaces outside `sync` (BUILD-018 / QA-0928): share, leaderboard,
// invite, dashboard, export — and the config.json safety they all rely on.
// Every run uses a throwaway WTCLAUDE_DIR and HOME, autosync off, and a PATH
// shim whose `open` / `xdg-open` only record their argv (never a real browser).

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', '..', 'bin', 'wtclaude.js');
process.env.WTCLAUDE_DIR = mkdtempSync(join(tmpdir(), 'wtclaude-priv-mod-'));
const { SYNC_TURN_FIELDS } = await import('../sync/index.js');

const ID = '0a1b2c3d-0000-4000-8000-00000000abcd';   // synthetic anonymous id
const SALT = 'feedfacefeedfacefeedfacefeedface';        // synthetic salt
const INVITE = 'c0ffee123456';

const dirs = [];
function tmp() {
  const d = mkdtempSync(join(tmpdir(), 'wtclaude-priv-'));
  dirs.push(d);
  return d;
}
after(() => { for (const d of [...dirs, process.env.WTCLAUDE_DIR]) rmSync(d, { recursive: true, force: true }); });

// A browser-opener shim: records argv to calls.log; exits `code`.
function shim(code = 0) {
  const d = tmp();
  for (const name of ['open', 'xdg-open']) {
    const p = join(d, name);
    writeFileSync(p, `#!/bin/sh\necho "${name} $*" >> "${join(d, 'calls.log')}"\nexit ${code}\n`);
    chmodSync(p, 0o755);
  }
  return d;
}
const shimCalls = (d) => (existsSync(join(d, 'calls.log')) ? readFileSync(join(d, 'calls.log'), 'utf8') : '');

function run(args, dir, { shimDir = shim(), home = tmp() } = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, WTCLAUDE_DIR: dir, HOME: home, TZ: 'America/New_York',
      PATH: `${shimDir}:${process.env.PATH}`,
      WTCLAUDE_NO_AUTOSYNC: '1', WTCLAUDE_AUTOSYNC_CHILD: '1',
    },
  });
}

function dataDir(config = null, { turns = 0 } = {}) {
  const dir = tmp();
  if (config) writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2));
  if (turns) {
    mkdirSync(join(dir, 'sessions'));
    const rows = [];
    for (let n = 1; n <= turns; n++) {
      rows.push(JSON.stringify({
        ts: `2026-09-2${n}T14:00:00.000Z`, session_id: 's1', turn: n, model: 'claude-opus-5-5',
        input_tokens: 10, output_tokens: 20, cache_read_tokens: 30, cache_write_tokens: 0,
        cost_usd: 0.01, cumulative_cost_usd: 0.01 * n, git_branch: 'feature/client-x', project_hash: 'abcdefabcdef',
        user_identifier: ID, device_id: '11111111-0000-4000-8000-000000000001',
      }));
    }
    writeFileSync(join(dir, 'sessions', 's1.ndjson'), rows.join('\n') + '\n');
  }
  return dir;
}
const fullConfig = (extra = {}) => ({
  anonymous_id: ID, user_identifier: ID, edit_hash_salt: SALT, invite_code: INVITE,
  device_id: '11111111-0000-4000-8000-000000000001', supabase_publishable_key: 'sb_publishable_test', ...extra,
});
const BROKEN = `{\n  "anonymous_id": "${ID}",\n  "edit_hash_salt": "${SALT}",\n}\n`;
function brokenDir() {
  const dir = tmp();
  writeFileSync(join(dir, 'config.json'), BROKEN);
  return dir;
}
function assertCleanConfigError(r, dir) {
  assert.equal(r.status, 1, 'exit 1');
  assert.match(r.stderr, /config\.json is not valid JSON \(line 4, column 1\)/);
  assert.doesNotMatch(r.stderr, /\n\s+at /, 'no stack trace');
  assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), BROKEN, 'file untouched');
}
const mode = (p) => statSync(p).mode & 0o777;

// ── share (QA-0928-05, QA-0928-39, QA-0928-144) ────────────────────────────────

test('`share --preview` lists everything sync uploads and what the leaderboard shows', () => {
  const r = run(['share', '--preview'], dataDir(fullConfig()));
  assert.equal(r.status, 0);
  for (const g of SYNC_TURN_FIELDS) assert.ok(r.stdout.includes(g.label), `lists "${g.label}"`);
  assert.match(r.stdout, /total tokens, sessions and turns/i);
  assert.doesNotMatch(r.stdout, /sonnet-4-6/, 'no stale example model');
  assert.match(r.stdout, /claude-opus-5-5/);
  assert.ok(r.stdout.includes('0a1b2c3d…') && !r.stdout.includes(ID), 'id truncated');
});

test('`share --preview` never writes: no config is created on a fresh install', () => {
  const dir = join(tmp(), 'fresh');
  const r = run(['share', '--preview'], dir);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(existsSync(join(dir, 'config.json')), false, 'a preview mints no id');
});

test('`share` status hint follows the state', () => {
  const on = run(['share'], dataDir(fullConfig({ sharing_enabled: true })));
  assert.match(on.stdout, /share --disable/);
  assert.doesNotMatch(on.stdout, /share --enable` to opt in/);
  const off = run(['share'], dataDir(fullConfig({ sharing_enabled: false })));
  assert.match(off.stdout, /share --enable/);
});

test('`share --enable --disable` is rejected and changes nothing', () => {
  const dir = dataDir(fullConfig({ sharing_enabled: false }));
  const before = readFileSync(join(dir, 'config.json'), 'utf8');
  const r = run(['share', '--enable', '--disable'], dir);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /either --enable or --disable/i);
  assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), before);
});

test('`share --enable` says it reaches the leaderboard with the next sync, and promises nothing else', () => {
  const r = run(['share', '--enable'], dataDir(fullConfig({ sync_enabled: true })));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /next sync/);
  assert.doesNotMatch(r.stdout, /community benchmarks/i);
  const off = run(['share', '--enable'], dataDir(fullConfig({ sync_enabled: false })));
  assert.match(off.stdout, /sync --enable/, 'with sync off it says sync is needed');
});

test('`share --enable` on a fresh install creates the data dir and a 0600 config', () => {
  const dir = join(tmp(), 'fresh');
  const r = run(['share', '--enable'], dir);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).sharing_enabled, true);
  assert.equal(mode(dir), 0o700);
  assert.equal(mode(join(dir, 'config.json')), 0o600);
});

test('`share --disable` with sync on says the leaderboard drops you after the next sync', () => {
  const r = run(['share', '--disable'], dataDir(fullConfig({ sync_enabled: true, sharing_enabled: true })));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /next sync/);
});

for (const args of [['share', '--enable'], ['share', '--disable'], ['share', '--preview'], ['share']]) {
  test(`\`${args.join(' ')}\` on an unparsable config.json: one-line error, file untouched`, () => {
    const dir = brokenDir();
    assertCleanConfigError(run(args, dir), dir);
  });
}

// ── leaderboard (QA-0928-05) ────────────────────────────────────────────────────

test('`leaderboard` preview no longer claims "ONLY these aggregates" and lists what sync uploads', () => {
  const r = run(['leaderboard'], dataDir(fullConfig(), { turns: 2 }));
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /ONLY these aggregates/i);
  assert.match(r.stdout, /total tokens, sessions and turns/i);
  for (const g of SYNC_TURN_FIELDS) assert.ok(r.stdout.includes(g.label), `lists "${g.label}"`);
});

// schema_version 1.0 pins leaderboard --json (src/utils/schema.js): shared_fields
// keeps its keys and {key, label, value} shape; what the leaderboard shows and
// what sync uploads ride as ADDITIVE fields.
test('`leaderboard --json` keeps the 1.0 shared_fields shape; what the leaderboard shows and sync uploads are additive', () => {
  const r = run(['leaderboard', '--json'], dataDir(fullConfig(), { turns: 2 }));
  assert.equal(r.status, 0);
  const j = JSON.parse(r.stdout);
  assert.equal(j.schema_version, '1.0');
  assert.deepEqual(j.shared_fields.map((f) => f.key),
    ['total_tokens', 'total_sessions', 'active_days', 'longest_streak', 'badges_earned', 'tier']);
  for (const f of j.shared_fields) {
    assert.equal(typeof f.label, 'string');
    assert.equal(f.value, j.stats[f.key], `${f.key} carries its value`);
  }
  assert.deepEqual(j.leaderboard_shows.map((f) => f.key), ['total_tokens', 'session_count', 'turn_count']);
  assert.deepEqual(j.synced_fields, SYNC_TURN_FIELDS.map((g) => g.label));
});

// ── invite (QA-0928-40, QA-0928-07, QA-0928-08) ─────────────────────────────────

test('`invite` promises no badge or attribution that does not exist', () => {
  const r = run(['invite'], dataDir(fullConfig()));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /https:\/\/wtclaude\.com\?ref=c0ffee123456/);
  assert.doesNotMatch(r.stdout, /Recruiter|badge/i);
  assert.doesNotMatch(r.stdout, /JSONL accuracy bug explained/);
});

test('`invite` on a fresh install creates the data dir instead of crashing', () => {
  const dir = join(tmp(), 'fresh');
  const r = run(['invite'], dir);
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.match(JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8')).invite_code, /^[0-9a-f]{12}$/);
  assert.equal(mode(join(dir, 'config.json')), 0o600);
});

test('`invite` on an unparsable config.json: one-line error, file untouched', () => {
  const dir = brokenDir();
  assertCleanConfigError(run(['invite'], dir), dir);
});

// ── dashboard (QA-0928-09, QA-0928-143, contract D) ─────────────────────────────

test('`dashboard` opens /settings#link=<id> (fragment, never ?link=) without a shell, and prints no id', () => {
  const s = shim();
  const r = run(['dashboard'], dataDir(fullConfig()), { shimDir: s });
  assert.equal(r.status, 0);
  const calls = shimCalls(s);
  assert.match(calls, new RegExp(`^(open|xdg-open) https://dashboard\\.wtclaude\\.com/settings#link=${ID}\\n$`));
  assert.doesNotMatch(calls, /\?link=/);
  assert.ok(!r.stdout.includes(ID), 'the id is not printed when the browser opened');
});

test('`dashboard` prints the link only when no browser opens, and warns it is private', () => {
  const s = shim(1);
  const r = run(['dashboard'], dataDir(fullConfig()), { shimDir: s });
  assert.equal(r.status, 0);
  assert.ok(r.stdout.includes(`https://dashboard.wtclaude.com/settings#link=${ID}`));
  assert.match(r.stdout, /private/i);
});

// Privacy copy must be literally true (Peter, 2026-09-28): the README's "first 8
// characters" claim has to name the one place the full id is printed.
test('the README id claim names the dashboard link as the exception', () => {
  const readme = readFileSync(join(HERE, '..', '..', 'README.md'), 'utf8');
  const claim = /shows only its first 8 characters([^.]*)\./.exec(readme);
  assert.ok(claim, 'README states the truncation');
  assert.match(claim[1], /except/i);
  assert.match(claim[1], /no browser opens/i);
});

test('`dashboard` refuses a tampered (non-UUID) id: nothing is spawned', () => {
  const s = shim();
  const home = tmp();
  const marker = join(home, 'pwned');
  const dir = dataDir(fullConfig({ anonymous_id: `x"; touch ${marker}; echo "` }));
  const r = run(['dashboard'], dir, { shimDir: s, home });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /not a valid id/);
  assert.doesNotMatch(r.stderr, /\n\s+at /);
  assert.equal(shimCalls(s), '', 'no browser/shell spawned');
  assert.equal(existsSync(marker), false, 'no command injection');
});

test('`dashboard` on a never-set-up machine says to run setup, mints nothing, opens nothing', () => {
  const s = shim();
  const dir = join(tmp(), 'fresh');
  const r = run(['dashboard'], dir, { shimDir: s });
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /wtclaude setup/);
  assert.equal(existsSync(join(dir, 'config.json')), false);
  assert.equal(shimCalls(s), '');
});

test('`dashboard` on an unparsable config.json: one-line error, nothing opened, file untouched', () => {
  const s = shim();
  const dir = brokenDir();
  assertCleanConfigError(run(['dashboard'], dir, { shimDir: s }), dir);
  assert.equal(shimCalls(s), '');
});

// ── export (QA-0928-06, QA-0928-66) ─────────────────────────────────────────────

test('`export --out` redacts the id, salt, invite code and keys, strips user_identifier, and writes 0600', () => {
  const dir = dataDir(fullConfig(), { turns: 3 });
  const out = join(tmp(), 'e.json');
  const r = run(['export', '--out', out], dir);
  assert.equal(r.status, 0);
  const text = readFileSync(out, 'utf8');
  for (const secret of [ID, SALT, INVITE, 'sb_publishable_test']) assert.ok(!text.includes(secret), `no ${secret.slice(0, 6)}… in the export`);
  const b = JSON.parse(text);
  for (const k of ['anonymous_id', 'user_identifier', 'edit_hash_salt', 'invite_code', 'supabase_publishable_key']) {
    assert.equal(b.config[k], '[redacted]', `${k} redacted`);
  }
  assert.ok(b.sessions[0].turns.every((t) => !('user_identifier' in t)), 'rows carry no user_identifier');
  assert.equal(b.sessions[0].turns[0].git_branch, 'feature/client-x', 'local data is exported as stored');
  assert.match(b.note, /anonymous_id/);
  assert.match(b.note, /branch names/i, 'the note admits raw branch names');
  assert.doesNotMatch(b.note, /salted hashes —|counts\/flags \+ salted hashes/);
  assert.equal(mode(out), 0o600);
});

test('`export --out` onto an existing world-readable file leaves it 0600', () => {
  const out = join(tmp(), 'old.json');
  writeFileSync(out, 'old contents\n', { mode: 0o644 });
  chmodSync(out, 0o644);
  const r = run(['export', '--out', out], dataDir(fullConfig(), { turns: 2 }));
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).turn_count, 2, 'the file holds the new export');
  assert.equal(mode(out), 0o600);
});

test('`export` to stdout is redacted the same way', () => {
  const r = run(['export'], dataDir(fullConfig(), { turns: 1 }));
  assert.equal(r.status, 0);
  for (const secret of [ID, SALT, INVITE]) assert.ok(!r.stdout.includes(secret));
});

test('`export --out` into a missing directory: one clean line, exit 1', () => {
  const out = join(tmp(), 'no-such-dir', 'x.json');
  const r = run(['export', '--out', out], dataDir(fullConfig(), { turns: 1 }));
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Can't write .*x\.json: no such directory/);
  assert.doesNotMatch(r.stderr, /\n\s+at |ENOENT/);
});

// ── setup can no longer clobber an unparsable config (QA-0928-07) ───────────────

test('`setup --yes` on an unparsable config.json exits non-zero and leaves the file untouched', () => {
  const dir = brokenDir();
  const r = run(['setup', '--yes'], dir);
  assert.notEqual(r.status, 0);
  assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), BROKEN, 'ids and salt survive');
});
