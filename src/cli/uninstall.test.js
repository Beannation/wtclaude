import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// `wtclaude uninstall` end to end in a throwaway HOME, with an environment built
// from scratch so the real ~/.claude and ~/.wtclaude can never be touched.

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BIN = join(REPO, 'bin', 'wtclaude.js');
const PKG = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8'));

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'wtc-uninstall-'));
  const home = join(root, 'home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  const dataDir = join(home, '.wtclaude');
  mkdirSync(join(dataDir, 'sessions'), { recursive: true });
  writeFileSync(join(dataDir, 'config.json'), JSON.stringify({ edit_hash_salt: 'abc', anonymous_id: '00000000-0000-4000-8000-000000000000' }));
  return { root, home, dataDir, settings: join(home, '.claude', 'settings.json') };
}
function uninstall(sb, args, env = {}) {
  return spawnSync(process.execPath, [BIN, 'uninstall', ...args], {
    env: { HOME: sb.home, PATH: '/usr/bin:/bin', WTCLAUDE_DIR: sb.dataDir, WTCLAUDE_NO_AUTOSYNC: '1', TZ: 'America/New_York', ...env },
    input: '', encoding: 'utf8',
  });
}
const readJSON = p => JSON.parse(readFileSync(p, 'utf8'));

// QA-0928-47: a substring match on 'wtclaude' deleted a user's combined statusLine.
// Reviewer: wrappers that take the collector PATH as an argument were still deleted.
test('QA-0928-47: uninstall leaves a wrapper that merely mentions wtclaude untouched, with guidance', () => {
  for (const cmd of [
    '~/bin/combo.sh ccusage+wtclaude-collector',
    '/Users/x/bin/multi-status /opt/homebrew/bin/wtclaude-collector',
    'bash /x/bin/wtclaude-collector',
  ]) {
    const sb = sandbox();
    try {
      const combo = JSON.stringify({ model: 'opus', statusLine: { type: 'command', command: cmd } });
      writeFileSync(sb.settings, combo);
      const r = uninstall(sb, ['--keep-data']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(readFileSync(sb.settings, 'utf8'), combo, `${cmd}: byte-identical`);
      assert.match(r.stdout, /wraps wtclaude/, cmd);
      assert.match(r.stdout, /by hand/);
    } finally { rmSync(sb.root, { recursive: true, force: true }); }
  }
});

test('QA-0928-47: uninstall removes an entry that IS the collector (typed, typeless, or a quoted path with spaces), keeping other keys', () => {
  for (const sl of [
    { type: 'command', command: '/opt/homebrew/bin/wtclaude-collector' },
    { command: 'wtclaude-collector' },
    { type: 'command', command: "'/Users/Jane Doe/.npm-global/bin/wtclaude-collector'", padding: 1 },
  ]) {
    const sb = sandbox();
    try {
      writeFileSync(sb.settings, JSON.stringify({ model: 'opus', statusLine: sl }));
      const r = uninstall(sb, ['--keep-data']);
      assert.match(r.stdout, /Removed the wtclaude collector/, JSON.stringify(sl));
      assert.deepEqual(readJSON(sb.settings), { model: 'opus' });
      assert.equal(readdirSync(dirname(sb.settings)).filter(n => n.includes('wtclaude-backup')).length, 1, 'backup first');
    } finally { rmSync(sb.root, { recursive: true, force: true }); }
  }
});

// QA-0928-46: uninstall must edit the settings file Claude Code reads.
test('QA-0928-46: with CLAUDE_CONFIG_DIR set, uninstall edits only $CLAUDE_CONFIG_DIR/settings.json', () => {
  const sb = sandbox();
  try {
    const alt = join(sb.home, 'alt');
    mkdirSync(alt);
    writeFileSync(join(alt, 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: '/x/bin/wtclaude-collector' } }));
    const home = JSON.stringify({ statusLine: { type: 'command', command: '/y/bin/wtclaude-collector' } });
    writeFileSync(sb.settings, home);
    const r = uninstall(sb, ['--keep-data'], { CLAUDE_CONFIG_DIR: alt });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readJSON(join(alt, 'settings.json')), {});
    assert.equal(readFileSync(sb.settings, 'utf8'), home, '~/.claude is not the active config dir — untouched');
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

// A settings file we can't parse (or a null top level, which used to throw a
// TypeError) is left byte-identical with a manual instruction.
test('uninstall leaves an unparsable or non-object settings.json untouched and does not crash', () => {
  for (const bytes of ['null', '[]', '{ // c\n "statusLine": { "command": "wtclaude-collector" }, }', '﻿{"statusLine":{"command":"wtclaude-collector"}}']) {
    const sb = sandbox();
    try {
      writeFileSync(sb.settings, bytes);
      const r = uninstall(sb, ['--keep-data']);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stderr, '');
      assert.equal(readFileSync(sb.settings, 'utf8'), bytes);
      assert.match(r.stdout, /remove the statusLine entry manually/);
    } finally { rmSync(sb.root, { recursive: true, force: true }); }
  }
});

// QA-0928-42: purge deletes the only copy of the anonymous id, and the synced
// cloud copy stays behind. So on an install that has synced: say so, show the
// id itself in the confirmation (it's the user's own terminal) so they can keep
// it, and require an explicit confirmation even with --purge — a prompt in a
// terminal, or --yes when there is none. Sync is turned off first, and the id
// is also saved OUTSIDE ~/.wtclaude before anything is deleted. Deletion of the
// cloud copy isn't self-serve yet, and (Peter's decision) nothing points at the
// public issue tracker for it.
const ID = '00000000-0000-4000-8000-000000000000';
const syncedConfig = () => JSON.stringify({ edit_hash_salt: 'abc', anonymous_id: ID, device_id: '11111111-1111-4111-8111-111111111111', sync_enabled: true, last_sync_at: '2026-09-27T10:00:00Z' });
const identityFiles = sb => readdirSync(sb.home).filter(n => /^\.wtclaude-identity-.+\.json$/.test(n));

test('QA-0928-42: a synced install is not purged without confirmation — no prompt possible and no --yes keeps everything', () => {
  const sb = sandbox();
  try {
    writeFileSync(join(sb.dataDir, 'config.json'), syncedConfig());
    const r = uninstall(sb, ['--purge']);
    assert.equal(r.status, 1, 'the purge asked for did not happen');
    assert.match(r.stdout, /synced data stays in the WTClaude cloud/);
    assert.match(r.stdout, /isn't self-serve yet/);
    assert.match(r.stdout, /Kept your local data/);
    assert.match(r.stdout, /--purge --yes/);
    assert.ok(!r.stdout.includes(ID), 'no confirmation was shown, so the id is not printed');
    assert.ok(existsSync(join(sb.dataDir, 'config.json')), 'the only copy of the id is kept');
    assert.equal(identityFiles(sb).length, 0);
    assert.equal(readJSON(join(sb.dataDir, 'config.json')).sync_enabled, true, 'nothing changed');
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

test('QA-0928-42: a last_sync_attempt_at alone counts as synced', () => {
  const sb = sandbox();
  try {
    writeFileSync(join(sb.dataDir, 'config.json'), JSON.stringify({ edit_hash_salt: 'abc', anonymous_id: ID, last_sync_attempt_at: '2026-09-27T10:00:00Z' }));
    const r = uninstall(sb, ['--purge']);
    assert.equal(r.status, 1);
    assert.ok(existsSync(sb.dataDir));
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

test('QA-0928-42: --purge --yes on a synced install shows the id, turns sync off, saves the id outside the purged dir, then deletes', () => {
  const sb = sandbox();
  try {
    writeFileSync(join(sb.dataDir, 'config.json'), syncedConfig());
    const r = uninstall(sb, ['--purge', '--yes']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /synced data stays in the WTClaude cloud/);
    assert.match(r.stdout, /isn't self-serve yet/);
    assert.doesNotMatch(r.stdout, /coming/i, 'no promise of a route that does not exist');
    assert.doesNotMatch(r.stdout, /github|issues/i, 'never points at a public issue tracker');
    assert.ok(!r.stdout.includes(PKG.bugs.url));
    assert.ok(r.stdout.includes(ID), 'the id itself is shown in the confirmation, so the user can keep it');
    assert.match(r.stdout, /don't post it anywhere public/i);
    assert.match(r.stdout, /Confirmed with --yes/);
    assert.match(r.stdout, /Turned cloud sync off/);
    assert.ok(r.stdout.indexOf(ID) < r.stdout.indexOf('Deleted '), 'shown before the delete');

    const files = identityFiles(sb);
    assert.equal(files.length, 1, 'the id is saved outside ~/.wtclaude before the purge');
    const saved = join(sb.home, files[0]);
    assert.equal(statSync(saved).mode & 0o777, 0o600, 'readable only by you');
    const body = JSON.parse(readFileSync(saved, 'utf8'));
    assert.equal(body.anonymous_id, ID);
    assert.equal(body.edit_hash_salt, undefined, 'the id only — not the salt or the rest of the config');
    assert.ok(r.stdout.includes(saved), 'prints where it saved it');
    assert.match(r.stdout, /Saved this install's anonymous id \(only\) to/);
    assert.ok(r.stdout.indexOf(saved) < r.stdout.indexOf('Deleted '), 'saved before the delete');
    assert.equal(existsSync(sb.dataDir), false, 'confirmed, so it purges');
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

test('QA-0928-42: if the id cannot be saved, --purge --yes keeps the local data (sync off) and exits 1', () => {
  const sb = sandbox();
  try {
    writeFileSync(join(sb.dataDir, 'config.json'), syncedConfig());
    chmodSync(sb.home, 0o555);                      // nowhere to save the id
    const r = uninstall(sb, ['--purge', '--yes']);
    chmodSync(sb.home, 0o755);
    assert.equal(r.status, 1);
    assert.ok(existsSync(join(sb.dataDir, 'config.json')), 'the only copy of the id is kept');
    assert.match(r.stdout, /Kept your local data/);
    assert.ok(r.stdout.includes(ID), 'the id was shown in the confirmation');
    assert.equal(readJSON(join(sb.dataDir, 'config.json')).sync_enabled, false, 'sync was turned off first');
    assert.equal(readJSON(join(sb.dataDir, 'config.json')).anonymous_id, ID);
  } finally { chmodSync(sb.home, 0o755); rmSync(sb.root, { recursive: true, force: true }); }
});

test('QA-0928-42: a config.json that can\'t be parsed is saved whole (the id can\'t be picked out) before a confirmed purge', () => {
  const sb = sandbox();
  try {
    const corrupt = `{ "anonymous_id": "${ID}", "sync_enabled": true, }`;
    writeFileSync(join(sb.dataDir, 'config.json'), corrupt);
    const r = uninstall(sb, ['--purge', '--yes']);
    assert.equal(r.status, 0, r.stderr);
    const files = identityFiles(sb);
    assert.equal(files.length, 1);
    assert.equal(readFileSync(join(sb.home, files[0]), 'utf8'), corrupt);
    assert.equal(statSync(join(sb.home, files[0])).mode & 0o777, 0o600);
    assert.match(r.stdout, /can't be read as JSON/);
    assert.match(r.stdout, /Saved a copy of .*config\.json \(the id couldn't be picked out of it\)/);
    assert.ok(!r.stdout.includes(ID));
    assert.equal(existsSync(sb.dataDir), false);
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});

// Reviewer: a config that parses but holds no valid id was told it "can't be
// read as JSON", and a non-UUID id string was then saved on its own. Only a
// valid id is picked out; anything else keeps the whole file, and the message
// says why.
test('QA-0928-42: a config.json that parses but holds no valid anonymous id is described as such and saved whole', () => {
  for (const [label, config] of [
    ['no id', { edit_hash_salt: 'abc', sync_enabled: true }],
    ['a non-UUID id', { edit_hash_salt: 'abc', sync_enabled: true, anonymous_id: 'not-a-uuid' }],
  ]) {
    const sb = sandbox();
    try {
      const raw = JSON.stringify(config);
      writeFileSync(join(sb.dataDir, 'config.json'), raw);
      const r = uninstall(sb, ['--purge', '--yes']);
      assert.equal(r.status, 0, `${label}: ${r.stderr}`);
      assert.doesNotMatch(r.stdout, /can't be read as JSON/, `${label}: the file parses`);
      assert.match(r.stdout, /holds no valid anonymous id, so the whole file is saved/, label);
      const files = identityFiles(sb);
      assert.equal(files.length, 1, label);
      assert.match(r.stdout, /Turned cloud sync off/, label);
      assert.deepEqual(readJSON(join(sb.home, files[0])), { ...config, sync_enabled: false },
        `${label}: the whole file as it stood at the save (sync already off), any id string kept as is`);
      assert.equal(statSync(join(sb.home, files[0])).mode & 0o777, 0o600, label);
      assert.match(r.stdout, /Saved a copy of .*config\.json \(it holds no valid anonymous id to pick out\)/, label);
      assert.doesNotMatch(r.stdout, /anonymous id \(only\)/, label);
      assert.equal(existsSync(sb.dataDir), false, label);
    } finally { rmSync(sb.root, { recursive: true, force: true }); }
  }
});

test('QA-0928-42: a purge that never synced says nothing about the cloud and saves nothing', () => {
  const sb = sandbox();
  try {
    const r = uninstall(sb, ['--purge']);
    assert.doesNotMatch(r.stdout, /cloud/);
    assert.equal(identityFiles(sb).length, 0);
    assert.equal(existsSync(sb.dataDir), false);
  } finally { rmSync(sb.root, { recursive: true, force: true }); }
});
