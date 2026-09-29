import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync,
  statSync, chmodSync, cpSync, symlinkSync, realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLatestPricing } from '../utils/pricing.js';
import { shellQuote } from '../utils/claude-settings.js';

// `wtclaude setup` end to end, in a throwaway HOME. The environment is built
// from scratch (never inherited), so the real ~/.claude, ~/.wtclaude,
// CLAUDE_CONFIG_DIR and any globally installed wtclaude-collector on the
// developer's PATH can't leak in or be touched.

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO, 'bin', 'wtclaude.js');
const COLLECTOR = join(REPO, 'src', 'collector', 'index.js');

function sandbox({ binDirName = 'bin', homeName = 'home' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'wtc-setup-'));
  const home = join(root, homeName);
  mkdirSync(home, { recursive: true });
  // A stable, "globally installed" collector on PATH (a shim onto this checkout).
  const fakeBin = join(root, binDirName);
  mkdirSync(fakeBin, { recursive: true });
  const shim = join(fakeBin, 'wtclaude-collector');
  writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${COLLECTOR}"\n`, { mode: 0o755 });
  return { root, home, fakeBin, shim, dataDir: join(home, '.wtclaude'), settings: join(home, '.claude', 'settings.json') };
}

function run(sb, args, { env = {}, bin = BIN, path } = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    env: {
      HOME: sb.home,
      PATH: path ?? `${sb.fakeBin}:/usr/bin:/bin`,
      WTCLAUDE_DIR: sb.dataDir,
      WTCLAUDE_NO_AUTOSYNC: '1',
      TZ: 'America/New_York',
      ...env,
    },
    input: '',
    encoding: 'utf8',
  });
}
const setup = (sb, extra = [], opts) => run(sb, ['setup', '--yes', ...extra], opts);
const readJSON = p => JSON.parse(readFileSync(p, 'utf8'));
const backups = p => existsSync(dirname(p)) ? readdirSync(dirname(p)).filter(n => n.startsWith('settings.json.wtclaude-backup-')) : [];
const CAPTURING = /capturing starts now/;

// ── QA-0928-10: the statusLine must carry "type": "command" ──────────────────
// Claude Code's statusline docs (read 2026-09-28): 'Set `type` to "command" and
// point `command` to a script path'; the 2.1.283 runner returns early when
// type !== 'command'. Every tag from v0.1.3 to 0.3.1 wrote { command } only.
test('QA-0928-10: a fresh setup writes { type: "command", command } and says so', () => {
  const sb = sandbox();
  try {
    const r = setup(sb);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readJSON(sb.settings).statusLine, { type: 'command', command: sb.shim });
    assert.match(r.stdout, CAPTURING);
    assert.ok(r.stdout.includes(sb.settings), '[4/4] names the settings file it edited');
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

test('QA-0928-10: an existing typeless wtclaude entry is repaired (keys kept, backup taken) and a re-run is idempotent', () => {
  const sb = sandbox();
  try {
    mkdirSync(dirname(sb.settings), { recursive: true });
    const original = JSON.stringify({ model: 'opus', permissions: { allow: ['Bash(ls:*)'] }, statusLine: { command: sb.shim, padding: 2 } }, null, 2);
    writeFileSync(sb.settings, original);
    const r = setup(sb);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Repaired/);
    const s = readJSON(sb.settings);
    assert.deepEqual(s.statusLine, { type: 'command', command: sb.shim, padding: 2 });
    assert.equal(s.model, 'opus');
    assert.deepEqual(s.permissions, { allow: ['Bash(ls:*)'] });
    const b = backups(sb.settings);
    assert.equal(b.length, 1, 'one backup before the write');
    assert.equal(readFileSync(join(dirname(sb.settings), b[0]), 'utf8'), original);

    const after = readFileSync(sb.settings, 'utf8');
    const r2 = setup(sb);
    assert.match(r2.stdout, /already runs the wtclaude collector/);
    assert.equal(readFileSync(sb.settings, 'utf8'), after, 'a second run changes nothing');
    assert.equal(backups(sb.settings).length, 1, 'and takes no second backup');
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

test('QA-0928-10: a wtclaude entry pointing at a path that no longer exists is repointed', () => {
  const sb = sandbox();
  try {
    mkdirSync(dirname(sb.settings), { recursive: true });
    writeFileSync(sb.settings, JSON.stringify({ statusLine: { type: 'command', command: '/gone/away/bin/wtclaude-collector' } }));
    const r = setup(sb);
    assert.match(r.stdout, /Repaired/);
    assert.deepEqual(readJSON(sb.settings).statusLine, { type: 'command', command: sb.shim });
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

// ── QA-0928-11: never clobber a settings.json we can't safely use ───────────
test('QA-0928-11: JSONC, BOM, truncated, empty and non-object settings files are left byte-identical', () => {
  const cases = {
    jsonc: '{\n  // my settings\n  "permissions": { "allow": ["Bash(ls:*)"], },\n  "env": { "A": "1" },\n  "hooks": {},\n}\n',
    bom: '﻿{ "model": "opus" }\n',
    truncated: '{ "model": "opus", "permissions": { "allow": [',
    empty: '',
    null: 'null',
    array: '[]',
    string: '"hi"',
    number: '42',
  };
  for (const [name, bytes] of Object.entries(cases)) {
    const sb = sandbox();
    try {
      mkdirSync(dirname(sb.settings), { recursive: true });
      writeFileSync(sb.settings, bytes);
      const r = setup(sb);
      assert.equal(r.status, 0, `${name}: ${r.stderr}`);
      assert.equal(r.stderr, '', `${name}: no stack trace`);
      assert.equal(readFileSync(sb.settings, 'utf8'), bytes, `${name}: settings.json must be untouched`);
      assert.equal(backups(sb.settings).length, 0, `${name}: nothing written, so no backup`);
      assert.ok(r.stdout.includes(`"statusLine": { "type": "command", "command": ${JSON.stringify(sb.shim)} }`),
        `${name}: prints the exact typed snippet to add by hand`);
      assert.doesNotMatch(r.stdout, CAPTURING, `${name}: must not claim capture`);
      assert.match(r.stdout, /Not capturing yet/);
    } finally { rmSync(sb.root, { recursive: true, force: true }); }
  }
});

// ── QA-0928-45: "capturing" only when the statusLine now runs the collector ──
test('QA-0928-45: a foreign statusLine or an unwritable settings file never prints "capturing starts now"', () => {
  const sb = sandbox();
  try {
    mkdirSync(dirname(sb.settings), { recursive: true });
    const foreign = JSON.stringify({ statusLine: { type: 'command', command: 'npx -y ccusage statusline' } });
    writeFileSync(sb.settings, foreign);
    const r = setup(sb);
    assert.doesNotMatch(r.stdout, CAPTURING);
    assert.match(r.stdout, /"statusLine": \{ "type": "command", "command": /);
    assert.equal(readFileSync(sb.settings, 'utf8'), foreign);
  } finally { rmSync(sb.root, { recursive: true, force: true }); }

  const sb2 = sandbox();
  try {
    mkdirSync(dirname(sb2.settings), { recursive: true });
    writeFileSync(sb2.settings, '{ "model": "opus" }\n');
    chmodSync(sb2.settings, 0o444);
    const r = setup(sb2);
    assert.doesNotMatch(r.stdout, CAPTURING);
    assert.match(r.stdout, /Not capturing yet/);
    assert.equal(readFileSync(sb2.settings, 'utf8'), '{ "model": "opus" }\n');
    assert.equal(backups(sb2.settings).length, 0, 'a failed write leaves no stray backup');
  } finally { rmSync(sb2.root, { recursive: true, force: true }); }
});

// ── QA-0928-47 (setup side): a wrapper that mentions wtclaude is not "already" ─
test('QA-0928-47: a combined statusLine that merely mentions wtclaude is left alone, not called "already"', () => {
  const sb = sandbox();
  try {
    mkdirSync(dirname(sb.settings), { recursive: true });
    const combo = JSON.stringify({ statusLine: { type: 'command', command: '~/bin/combo.sh ccusage+wtclaude-collector' } });
    writeFileSync(sb.settings, combo);
    const r = setup(sb);
    // The old code said "statusline already points at wtclaude" here.
    assert.doesNotMatch(r.stdout, /already (points at|runs the) wtclaude/);
    assert.doesNotMatch(r.stdout, CAPTURING);
    assert.equal(readFileSync(sb.settings, 'utf8'), combo);
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

// Reviewer: a wrapper that takes the collector PATH as an argument was classed
// ours and rewritten to the bare collector path ("Repaired…", wrapper dropped).
test('QA-0928-47: a wrapper that passes the collector path as an argument stays byte-identical', () => {
  for (const cmd of ['/Users/x/bin/multi-status /opt/homebrew/bin/wtclaude-collector', 'bash /Users/x/bin/wtclaude-collector']) {
    const sb = sandbox();
    try {
      mkdirSync(dirname(sb.settings), { recursive: true });
      const bytes = JSON.stringify({ model: 'opus', statusLine: { type: 'command', command: cmd } }, null, 2) + '\n';
      writeFileSync(sb.settings, bytes);
      const r = setup(sb);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readFileSync(sb.settings, 'utf8'), bytes, `${cmd}: untouched`);
      assert.equal(backups(sb.settings).length, 0, `${cmd}: nothing written`);
      assert.doesNotMatch(r.stdout, /Repaired|already runs the wtclaude collector/, cmd);
      assert.doesNotMatch(r.stdout, CAPTURING, cmd);
      assert.match(r.stdout, /Capture not verified/, cmd);
    } finally { rmSync(sb.root, { recursive: true, force: true }); }
  }
});

// ── QA-0928-46: CLAUDE_CONFIG_DIR ────────────────────────────────────────────
test('QA-0928-46: with CLAUDE_CONFIG_DIR set, setup edits only $CLAUDE_CONFIG_DIR/settings.json', () => {
  const sb = sandbox();
  try {
    const alt = join(sb.home, 'alt');
    mkdirSync(alt);
    writeFileSync(join(alt, 'settings.json'), JSON.stringify({ model: 'opus' }));
    const r = setup(sb, [], { env: { CLAUDE_CONFIG_DIR: alt } });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readJSON(join(alt, 'settings.json')), { model: 'opus', statusLine: { type: 'command', command: sb.shim } });
    assert.equal(existsSync(sb.settings), false, 'no stray ~/.claude/settings.json');
    assert.ok(r.stdout.includes(join(alt, 'settings.json')));
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

// ── QA-0928-44: npx cache, quoting ───────────────────────────────────────────
// A copy of the package inside an npx-style cache dir (…/_npx/<hash>/node_modules/wtclaude).
function npxCopy(sb) {
  const pkg = join(sb.home, '.npm', '_npx', 'a1b2c3', 'node_modules', 'wtclaude');
  mkdirSync(pkg, { recursive: true });
  for (const d of ['bin', 'src']) cpSync(join(REPO, d), join(pkg, d), { recursive: true });
  cpSync(join(REPO, 'package.json'), join(pkg, 'package.json'));
  symlinkSync(realpathSync(join(REPO, 'node_modules')), join(pkg, 'node_modules'));
  const npxBin = join(sb.home, '.npm', '_npx', 'a1b2c3', 'node_modules', '.bin');
  mkdirSync(npxBin, { recursive: true });
  writeFileSync(join(npxBin, 'wtclaude-collector'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return { bin: join(pkg, 'bin', 'wtclaude.js'), npxBin };
}

test('QA-0928-44: run from the npx cache with no stable install, setup pins nothing and says to install globally', () => {
  const sb = sandbox();
  try {
    const { bin, npxBin } = npxCopy(sb);
    const r = setup(sb, [], { bin, path: `${npxBin}:/usr/bin:/bin` });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(sb.settings), false, 'no ephemeral _npx path is written');
    assert.match(r.stdout, /npm i -g wtclaude/);
    assert.doesNotMatch(r.stdout, CAPTURING);
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

test('QA-0928-44: run from the npx cache with a global install on PATH, setup uses the global collector', () => {
  const sb = sandbox();
  try {
    const { bin, npxBin } = npxCopy(sb);
    const r = setup(sb, [], { bin, path: `${npxBin}:${sb.fakeBin}:/usr/bin:/bin` });
    assert.equal(readJSON(sb.settings).statusLine.command, sb.shim, 'the _npx .bin entry is skipped');
    assert.match(r.stdout, CAPTURING);
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

test('QA-0928-44: a collector path with a space is quoted, and the command runs through /bin/sh -c and records a turn', () => {
  const sb = sandbox({ binDirName: 'my tools/bin', homeName: 'Jane Doe' });
  try {
    const r = setup(sb);
    assert.equal(r.status, 0, r.stderr);
    const { command } = readJSON(sb.settings).statusLine;
    assert.equal(command, `'${sb.shim}'`);
    const payload = JSON.stringify({ session_id: 'sh1', model: { id: 'claude-opus-5-5' }, cost: { total_cost_usd: 0.05 },
      context_window: { total_input_tokens: 1000, total_output_tokens: 100 }, fast_mode: false });
    const out = spawnSync('/bin/sh', ['-c', command], {
      input: payload, encoding: 'utf8',
      env: { HOME: sb.home, PATH: '/usr/bin:/bin', WTCLAUDE_DIR: sb.dataDir, TZ: 'America/New_York' },
    });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /^wtclaude · \$0\.05/);
    assert.ok(existsSync(join(sb.dataDir, 'sessions', 'sh1.ndjson')), 'a row was written');
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

// Reviewer: a bare `wtclaude-collector` (what setup wrote when `which` failed)
// was kept and blessed even when nothing on PATH provides it — /bin/sh -c
// exits 127 while setup said "capturing starts now".
test('QA-0928-44: a bare wtclaude-collector entry with no collector on PATH is repointed at this copy, never blessed as is', () => {
  for (const sl of [{ type: 'command', command: 'wtclaude-collector' }, { command: 'wtclaude-collector', padding: 1 }]) {
    const sb = sandbox();
    try {
      mkdirSync(dirname(sb.settings), { recursive: true });
      writeFileSync(sb.settings, JSON.stringify({ statusLine: sl }));
      const r = setup(sb, [], { path: '/usr/bin:/bin' });   // no global install: run from a clone
      assert.equal(r.status, 0, r.stderr);
      assert.match(r.stdout, /Repaired/, JSON.stringify(sl));
      assert.doesNotMatch(r.stdout, /already runs/);
      assert.match(r.stdout, /isn't on your PATH/, 'says it points at this copy');
      const { command, type, padding } = readJSON(sb.settings).statusLine;
      assert.equal(type, 'command');
      assert.equal(command, shellQuote(COLLECTOR));
      assert.equal(padding, sl.padding, 'other keys kept');
      const payload = JSON.stringify({ session_id: 'bare1', model: { id: 'claude-opus-5-5' }, cost: { total_cost_usd: 0.05 },
        context_window: { total_input_tokens: 1000, total_output_tokens: 100 }, fast_mode: false });
      // node on PATH (the collector's #!/usr/bin/env node needs it), and no wtclaude-collector.
      const nodeBin = join(sb.root, 'nodebin');
      mkdirSync(nodeBin);
      symlinkSync(process.execPath, join(nodeBin, 'node'));
      const out = spawnSync('/bin/sh', ['-c', command], { input: payload, encoding: 'utf8',
        env: { HOME: sb.home, PATH: `${nodeBin}:/usr/bin:/bin`, WTCLAUDE_DIR: sb.dataDir, WTCLAUDE_NO_AUTOSYNC: '1', TZ: 'America/New_York' } });
      assert.equal(out.status, 0, 'the repointed command runs under /bin/sh -c');
      assert.ok(existsSync(join(sb.dataDir, 'sessions', 'bare1.ndjson')));
    } finally { rmSync(sb.root, { recursive: true, force: true }); }
  }
});

test('QA-0928-44: a bare wtclaude-collector entry, run from the npx cache with nothing on PATH, is left alone with no capture claim', () => {
  for (const sl of [{ type: 'command', command: 'wtclaude-collector' }, { command: 'wtclaude-collector' }]) {
    const sb = sandbox();
    try {
      const { bin, npxBin } = npxCopy(sb);
      mkdirSync(dirname(sb.settings), { recursive: true });
      const bytes = JSON.stringify({ statusLine: sl });
      writeFileSync(sb.settings, bytes);
      const r = setup(sb, [], { bin, path: `${npxBin}:/usr/bin:/bin` });
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stdout, CAPTURING, JSON.stringify(sl));
      assert.doesNotMatch(r.stdout, /Repaired|already runs/);
      assert.match(r.stdout, /npm i -g wtclaude/);
      assert.equal(readFileSync(sb.settings, 'utf8'), bytes, 'untouched');
    } finally { rmSync(sb.root, { recursive: true, force: true }); }
  }
});

test('QA-0928-44: with a global collector on PATH, a typed bare wtclaude-collector entry stays "already" and unchanged', () => {
  const sb = sandbox();
  try {
    mkdirSync(dirname(sb.settings), { recursive: true });
    const bytes = JSON.stringify({ statusLine: { type: 'command', command: 'wtclaude-collector' } });
    writeFileSync(sb.settings, bytes);
    const r = setup(sb);
    assert.match(r.stdout, /already runs the wtclaude collector/);
    assert.match(r.stdout, CAPTURING);
    assert.equal(readFileSync(sb.settings, 'utf8'), bytes);
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

// ── QA-0928-07 (setup part): never rotate identity over a corrupt config ────
test('QA-0928-07: an unparsable config.json makes setup refuse, exit 1, and leave every file untouched', () => {
  const sb = sandbox();
  try {
    mkdirSync(sb.dataDir, { recursive: true });
    const corrupt = '{\n  "anonymous_id": "00000000-0000-4000-8000-000000000000",\n  "edit_hash_salt": "abc",\n}\n';
    writeFileSync(join(sb.dataDir, 'config.json'), corrupt);
    const r = setup(sb, ['--plan', 'pro']);
    assert.equal(r.status, 1);
    assert.match(r.stdout + r.stderr, /config\.json is not valid JSON/);
    assert.equal(readFileSync(join(sb.dataDir, 'config.json'), 'utf8'), corrupt, 'identity never rotated');
    assert.equal(existsSync(sb.settings), false, 'nothing else was touched either');
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

// ── QA-0928-153 / QA-0928-170: plans ─────────────────────────────────────────
test('QA-0928-153: an unknown --plan is refused with the accepted list, exit 1, nothing written', () => {
  const sb = sandbox();
  try {
    const r = setup(sb, ['--plan', 'bogus']);
    assert.equal(r.status, 1);
    const out = r.stdout + r.stderr;
    assert.match(out, /Unknown plan "bogus"/);
    for (const k of ['pro', 'max5', 'max20', 'team_standard', 'team_premium', 'enterprise_standard', 'enterprise_premium']) {
      assert.ok(out.includes(k), `accepted list names ${k}`);
    }
    assert.equal(existsSync(join(sb.dataDir, 'config.json')), false);
    assert.equal(existsSync(sb.settings), false);
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

test('QA-0928-170: setup records every plan the rate sheet\'s Fable plan rows know', () => {
  const fable = getLatestPricing().fable;
  const sheetPlans = new Set([...fable.included_plans, ...fable.credits_plans, 'enterprise_standard']);
  const inputs = {
    pro: 'pro', max5: 'max_5x', 'max-5': 'max_5x', max20: 'max_20x', 'Max 20x': 'max_20x',
    team_standard: 'team_standard', 'Team Premium': 'team_premium',
    'enterprise-standard': 'enterprise_standard', enterprise_premium: 'enterprise_premium',
  };
  assert.deepEqual(new Set(Object.values(inputs)), sheetPlans, 'the accepted keys are exactly the sheet\'s plan rows');
  for (const [flag, key] of Object.entries(inputs)) {
    const sb = sandbox();
    try {
      const r = setup(sb, ['--plan', flag]);
      assert.equal(r.status, 0, `${flag}: ${r.stderr}`);
      assert.equal(readJSON(join(sb.dataDir, 'config.json')).plan, key, flag);
    } finally { rmSync(sb.root, { recursive: true, force: true }); }
  }
});

// Reviewer: `readiness` exited 1 (TypeError reading plan.label) once setup had
// recorded an Enterprise plan, because the rate sheet's plans block has no
// enterprise rows. Fixed in src/cli/readiness.js (null-plan fallback).
test('QA-0928-170: `readiness` still runs after setup records an Enterprise plan', () => {
  for (const plan of ['enterprise_standard', 'enterprise_premium']) {
    const sb = sandbox();
    try {
      assert.equal(setup(sb, ['--plan', plan]).status, 0);
      const r = run(sb, ['readiness']);
      assert.equal(r.status, 0, `${plan}: ${r.stderr}`);
      assert.match(r.stdout, /Plan tier set: +Enterprise (Standard|Premium)|Plan tier set: +enterprise_/);
    } finally { rmSync(sb.root, { recursive: true, force: true }); }
  }
});

// ── QA-0928-142: private data dir + config ───────────────────────────────────
test('QA-0928-142: setup leaves ~/.wtclaude 0700 and config.json 0600, tightening an existing 0755 dir', () => {
  const sb = sandbox();
  try {
    mkdirSync(sb.dataDir, { mode: 0o755 });
    chmodSync(sb.dataDir, 0o755);
    const r = setup(sb);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(statSync(sb.dataDir).mode & 0o777, 0o700);
    assert.equal(statSync(join(sb.dataDir, 'config.json')).mode & 0o777, 0o600);
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

// ── QA-0928-45 (first-run side): `today` says "not wired", not "capturing" ──
test('QA-0928-45: the cold start says the collector is not wired when the statusLine is missing or typeless', () => {
  const sb = sandbox();
  try {
    mkdirSync(join(sb.dataDir, 'sessions'), { recursive: true });
    writeFileSync(join(sb.dataDir, 'config.json'), JSON.stringify({ edit_hash_salt: 'abc' }));

    let r = run(sb, ['today']);
    assert.doesNotMatch(r.stdout, /set up and capturing/);
    assert.match(r.stdout, /not wired/);

    mkdirSync(dirname(sb.settings), { recursive: true });
    writeFileSync(sb.settings, JSON.stringify({ statusLine: { command: sb.shim } }));
    r = run(sb, ['today']);
    assert.match(r.stdout, /not wired/, 'a typeless entry never runs');

    writeFileSync(sb.settings, JSON.stringify({ statusLine: { type: 'command', command: sb.shim } }));
    r = run(sb, ['today']);
    assert.match(r.stdout, /set up and capturing/);

    // A bare name only runs if a stable wtclaude-collector is on PATH (reviewer, QA-0928-44).
    writeFileSync(sb.settings, JSON.stringify({ statusLine: { type: 'command', command: 'wtclaude-collector' } }));
    r = run(sb, ['today'], { path: '/usr/bin:/bin' });
    assert.doesNotMatch(r.stdout, /set up and capturing/);
    assert.match(r.stdout, /not wired/);
    assert.match(r.stdout, /not on your PATH/);
    r = run(sb, ['today']);
    assert.match(r.stdout, /set up and capturing/, 'on PATH, it runs');

    // A path that no longer exists never runs either.
    writeFileSync(sb.settings, JSON.stringify({ statusLine: { type: 'command', command: '/gone/bin/wtclaude-collector' } }));
    r = run(sb, ['today']);
    assert.match(r.stdout, /not wired/);
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

// QA-0928-44 (README half): under npx, setup won't point Claude Code at npm's
// temporary cache and says to install globally. The README's install steps say
// the same, so a reader following them ends up capturing.
test('QA-0928-44: the README installs globally, as setup under npx says to', () => {
  const readme = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'README.md'), 'utf8');
  const blocks = [...readme.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]);
  const installs = blocks.filter((b) => /wtclaude setup/.test(b));
  assert.ok(installs.length >= 2, 'the quick start and the Install section');
  for (const b of installs) {
    assert.match(b, /^npm i -g wtclaude\nwtclaude setup$/m, b);
    assert.doesNotMatch(b, /npx wtclaude setup/, b);
  }
});

// ── RC 2026-09-28: setup must recognise the entry it wrote itself ────────────
// A prefix with ( ) & $ ; or an apostrophe is written quoted (QA-0928-44) and
// runs, but the ownership check ran its metacharacter test on the contents of
// the quoted word, where those characters are literal, and couldn't parse the
// '\'' escape: a re-run said "Capture not verified" and uninstall refused to
// remove the entry. It now parses the command as one shell word.
test('setup recognises its own quoted entry when the install path has shell metacharacters, and uninstall removes it', () => {
  for (const binDirName of ['p (x86) & co/bin', "p sp'ace/bin", 'a$b;c/bin']) {
    const sb = sandbox({ binDirName });
    try {
      let r = setup(sb);
      assert.equal(r.status, 0, r.stderr);
      const { command } = readJSON(sb.settings).statusLine;
      assert.equal(command, shellQuote(sb.shim), binDirName);
      const payload = JSON.stringify({ session_id: 'meta1', model: { id: 'claude-opus-5-5' }, cost: { total_cost_usd: 0.05 },
        context_window: { total_input_tokens: 1000, total_output_tokens: 100 }, fast_mode: false });
      const out = spawnSync('/bin/sh', ['-c', command], { input: payload, encoding: 'utf8',
        env: { HOME: sb.home, PATH: '/usr/bin:/bin', WTCLAUDE_DIR: sb.dataDir, TZ: 'America/New_York' } });
      assert.equal(out.status, 0, `${binDirName}: ${out.stderr}`);
      // A re-run: ours, already wired, capturing.
      r = setup(sb);
      assert.match(r.stdout, /already runs the wtclaude collector/, binDirName);
      assert.doesNotMatch(r.stdout, /Capture not verified|may wrap the collector/, binDirName);
      assert.match(r.stdout, CAPTURING, binDirName);
      // The cold-start hint agrees.
      assert.doesNotMatch(run(sb, ['today']).stdout, /your own command/, binDirName);
      // And uninstall removes it.
      r = run(sb, ['uninstall', '--keep-data']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readJSON(sb.settings).statusLine, undefined, `${binDirName}: uninstall removed our entry`);
    } finally { rmSync(sb.root, { recursive: true, force: true }); }
  }
});

test('a quoted metacharacter that is really a compound command is still not ours', () => {
  const sb = sandbox();
  try {
    mkdirSync(dirname(sb.settings), { recursive: true });
    for (const cmd of [`'${sb.shim}'; echo hi`, `'${sb.shim}' | tee /tmp/x`, `"$HOME/bin/wtclaude-collector"`]) {
      writeFileSync(sb.settings, JSON.stringify({ statusLine: { type: 'command', command: cmd } }));
      const r = setup(sb);
      assert.doesNotMatch(r.stdout, /already runs the wtclaude collector|Repaired/, cmd);
      assert.equal(readJSON(sb.settings).statusLine.command, cmd, `${cmd}: left alone`);
    }
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

// ── RC 2026-09-28: a collector on PATH older than this package ───────────────
// `npx wtclaude@0.3.2 setup` with an older global install wired the old
// collector and said "all set". It now names the version and says how to fix.
function oldGlobal(sb, version) {
  const prefix = join(sb.root, `prefix-${version}`);
  const pkg = join(prefix, 'lib', 'node_modules', 'wtclaude');
  mkdirSync(join(pkg, 'src', 'collector'), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'wtclaude', version }));
  writeFileSync(join(pkg, 'src', 'collector', 'index.js'), `#!/bin/sh\necho "wtclaude ${version}"\n`, { mode: 0o755 });
  mkdirSync(join(prefix, 'bin'), { recursive: true });
  symlinkSync(join('..', 'lib', 'node_modules', 'wtclaude', 'src', 'collector', 'index.js'), join(prefix, 'bin', 'wtclaude-collector'));
  return join(prefix, 'bin');
}

test('an older wtclaude-collector on PATH is named, with how to update, and no "all set"', () => {
  const sb = sandbox();
  try {
    const own = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version;
    const oldBin = oldGlobal(sb, '0.3.1');
    const { bin, npxBin } = npxCopy(sb);
    const r = setup(sb, [], { bin, path: `${npxBin}:${oldBin}:/usr/bin:/bin` });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(readJSON(sb.settings).statusLine.command, join(oldBin, 'wtclaude-collector'));
    const flat = r.stdout.replace(/\s+/g, ' ');
    assert.match(flat, new RegExp(`wtclaude-collector on your PATH is version 0\\.3\\.1, older than this wtclaude \\(${own.replace(/\./g, '\\.')}\\)`));
    assert.match(flat, new RegExp(`npm i -g wtclaude@${own.replace(/\./g, '\\.')}`));
    assert.doesNotMatch(r.stdout, /You're all set/);
    // A re-run with the old entry in place says the same.
    const again = setup(sb, [], { bin, path: `${npxBin}:${oldBin}:/usr/bin:/bin` });
    assert.match(again.stdout.replace(/\s+/g, ' '), /is version 0\.3\.1, older than this wtclaude/);
    // The same version (or a newer one) is not called older.
    const sb2 = sandbox();
    try {
      const sameBin = oldGlobal(sb2, own);
      const r2 = setup(sb2, [], { path: `${sameBin}:/usr/bin:/bin` });
      assert.doesNotMatch(r2.stdout, /older than this wtclaude/);
      assert.match(r2.stdout, CAPTURING);
    } finally { rmSync(sb2.root, { recursive: true, force: true }); }
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

// ── RC 2026-09-28: an existing entry pinned into the npx cache ───────────────
test('an entry that points into the npx cache says it works for now and to install globally — not "nothing is captured"', () => {
  const sb = sandbox();
  try {
    const { bin, npxBin } = npxCopy(sb);
    const pinned = join(npxBin, 'wtclaude-collector');
    mkdirSync(dirname(sb.settings), { recursive: true });
    const bytes = JSON.stringify({ statusLine: { type: 'command', command: pinned } });
    writeFileSync(sb.settings, bytes);
    const r = setup(sb, [], { bin, path: `${npxBin}:/usr/bin:/bin` });
    assert.equal(r.status, 0, r.stderr);
    const flat = r.stdout.replace(/\s+/g, ' ');
    assert.doesNotMatch(flat, /nothing is being captured|Not capturing yet/);
    assert.match(flat, /points into the npx cache/);
    assert.match(flat, /npm can prune it at any time/);
    assert.match(flat, /npm i -g wtclaude/);
    assert.equal(readFileSync(sb.settings, 'utf8'), bytes, 'left as is');
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

// ── RC 2026-09-28: an empty, null or [] settings.json has no top-level { } ───
test('an empty or non-object settings.json gets a whole document to use, not "add inside its top-level { … }"', () => {
  for (const bytes of ['', 'null', '[]', '42']) {
    const sb = sandbox();
    try {
      mkdirSync(dirname(sb.settings), { recursive: true });
      writeFileSync(sb.settings, bytes);
      const r = setup(sb);
      assert.doesNotMatch(r.stdout, /inside its top-level/, JSON.stringify(bytes));
      assert.match(r.stdout, /Replace its contents with:/);
      assert.ok(r.stdout.includes(`{ "statusLine": { "type": "command", "command": ${JSON.stringify(sb.shim)} } }`), JSON.stringify(bytes));
      assert.equal(readFileSync(sb.settings, 'utf8'), bytes, 'untouched');
    } finally { rmSync(sb.root, { recursive: true, force: true }); }
  }
  const sb = sandbox();
  try {
    mkdirSync(dirname(sb.settings), { recursive: true });
    writeFileSync(sb.settings, '{ // mine\n "model": "opus", }\n');
    assert.match(setup(sb).stdout, /Add this inside its top-level \{ … \}/, 'JSONC keeps the add-inside instruction');
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});
