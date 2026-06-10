import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, 'wtclaude.js');
const PKG = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));

// REGRESSION: `--version` was hardcoded to '0.1.2' in bin/wtclaude.js and silently
// left behind when package.json bumped to 0.1.3 — so a user verifying a fix via
// `wtclaude --version` saw the wrong number. The bin now reads package.json; this
// test fails the moment the two ever drift apart again.
test('wtclaude --version matches package.json version', () => {
  const res = spawnSync(process.execPath, [BIN, '--version'], { encoding: 'utf8' });
  assert.equal(res.status, 0);
  assert.equal(res.stdout.trim(), PKG.version,
    `--version (${res.stdout.trim()}) must equal package.json version (${PKG.version})`);
});
