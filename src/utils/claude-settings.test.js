import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isOwnCollectorCommand, statusLineState, shellQuote, unquoteCommand, ownCommandRunnable, OWN_COLLECTOR } from './claude-settings.js';

// QA-0928-47: only a command that runs the collector and nothing else is ours.
test('QA-0928-47: isOwnCollectorCommand accepts only the collector itself', () => {
  const ours = [
    'wtclaude-collector',
    '/opt/homebrew/bin/wtclaude-collector',
    "'/Users/Jane Doe/.npm-global/bin/wtclaude-collector'",
    '"/Users/Jane Doe/.npm-global/bin/wtclaude-collector"',
    '/usr/local/lib/node_modules/wtclaude/src/collector/index.js',
    OWN_COLLECTOR,
  ];
  const notOurs = [
    '~/bin/combo.sh ccusage+wtclaude-collector',
    'ccusage statusline | wtclaude-collector',
    'wtclaude-collector; echo hi',
    'wtclaude-collector --debug',
    'bash -c "wtclaude-collector"',
    '$(which wtclaude-collector)',
    'npx -y ccusage statusline',
    '/bin/wtclaude-collector-old',
    // A wrapper that takes the collector path as an argument (reviewer, QA-0928-47):
    // once unquoted, a command with whitespace is ours only if it is itself an
    // existing file (the legacy unquoted-spaced-path case, tested below).
    '/Users/x/bin/multi-status /opt/homebrew/bin/wtclaude-collector',
    'bash /x/bin/wtclaude-collector',
    '/Users/Jane Doe/bin/wtclaude-collector',              // no such file: sh would run /Users/Jane
    '',
    null,
  ];
  for (const c of ours) assert.equal(isOwnCollectorCommand(c), true, `ours: ${c}`);
  for (const c of notOurs) assert.equal(isOwnCollectorCommand(c), false, `not ours: ${c}`);
});

test('QA-0928-47: an unquoted path with a space is ours only when it is an existing file', () => {
  const root = mkdtempSync(join(tmpdir(), 'wtc-cs-'));
  try {
    const dir = join(root, 'my tools');
    mkdirSync(dir);
    const p = join(dir, 'wtclaude-collector');
    writeFileSync(p, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    assert.equal(isOwnCollectorCommand(p), true, 'legacy unquoted spaced path (setup quotes it)');
    assert.equal(isOwnCollectorCommand(`bash ${p}`), false, 'an interpreter plus the path is a wrapper');
    assert.equal(statusLineState({ statusLine: { type: 'command', command: `${join(root, 'multi')} ${p}` } }), 'wrapped');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// QA-0928-44 (reviewer): an entry of ours is only "wired" if /bin/sh can run it.
test('QA-0928-44: ownCommandRunnable: a bare name needs a stable collector on PATH; a path must be an executable file outside the npx cache', () => {
  const root = mkdtempSync(join(tmpdir(), 'wtc-cs-'));
  const oldHome = process.env.HOME;
  try {
    const exe = join(root, 'bin', 'wtclaude-collector');
    mkdirSync(join(root, 'bin'));
    writeFileSync(exe, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    const plain = join(root, 'bin', 'not-executable');
    writeFileSync(plain, '', { mode: 0o644 });
    const onPath = { path: exe, source: 'path' };
    const pkg = { path: OWN_COLLECTOR, source: 'package' };
    const npx = { path: null, source: 'npx' };

    assert.equal(ownCommandRunnable('wtclaude-collector', onPath), true);
    assert.equal(ownCommandRunnable('wtclaude-collector', pkg), false, 'not on PATH: sh exits 127');
    assert.equal(ownCommandRunnable('wtclaude-collector', npx), false, 'only the npx .bin has it');
    assert.equal(ownCommandRunnable(exe, npx), true);
    assert.equal(ownCommandRunnable(shellQuote(exe), npx), true);
    assert.equal(ownCommandRunnable('/gone/bin/wtclaude-collector', onPath), false);
    assert.equal(ownCommandRunnable(plain, onPath), false, 'sh exits 126');
    assert.equal(ownCommandRunnable('/h/.npm/_npx/ab/node_modules/.bin/wtclaude-collector', onPath), false);
    assert.equal(ownCommandRunnable('bin/wtclaude-collector', onPath), false, 'relative to whatever cwd Claude Code has');

    process.env.HOME = root;
    assert.equal(ownCommandRunnable('~/bin/wtclaude-collector', npx), true, 'the shell expands an unquoted ~/');
    assert.equal(ownCommandRunnable("'~/bin/wtclaude-collector'", npx), false, 'but not a quoted one');
  } finally {
    process.env.HOME = oldHome;
    rmSync(root, { recursive: true, force: true });
  }
});

test('statusLineState distinguishes typed, typeless, wrapped and foreign entries', () => {
  assert.equal(statusLineState({}), 'none');
  assert.equal(statusLineState({ statusLine: { type: 'command', command: 'wtclaude-collector' } }), 'ours');
  assert.equal(statusLineState({ statusLine: { command: 'wtclaude-collector' } }), 'ours-untyped');
  assert.equal(statusLineState({ statusLine: { type: 'command', command: 'x.sh | wtclaude-collector' } }), 'wrapped');
  assert.equal(statusLineState({ statusLine: { type: 'command', command: 'ccusage' } }), 'foreign');
  assert.equal(statusLineState({ statusLine: 'wtclaude-collector' }), 'foreign');
});

// QA-0928-44: Claude Code runs the command through a shell.
test('QA-0928-44: shellQuote survives /bin/sh for spaces and quotes; plain paths stay bare', () => {
  assert.equal(shellQuote('/usr/local/bin/wtclaude-collector'), '/usr/local/bin/wtclaude-collector');
  for (const p of ['/Users/Jane Doe/bin/x', "/tmp/it's here/x", '/tmp/a$b/x']) {
    const out = spawnSync('/bin/sh', ['-c', `printf %s ${shellQuote(p)}`], { encoding: 'utf8' });
    assert.equal(out.stdout, p, p);
  }
  assert.equal(unquoteCommand("'/Users/Jane Doe/x'"), '/Users/Jane Doe/x');
});
