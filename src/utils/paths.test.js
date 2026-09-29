import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

// paths.js resolves WTCLAUDE_DIR at import, so point it at a scratch dir first
// (node --test runs each file in its own process).
const ROOT = mkdtempSync(join(tmpdir(), 'wtc-paths-'));
process.env.WTCLAUDE_DIR = join(ROOT, 'wtclaude-home');
const paths = await import('./paths.js');

test.after(() => rmSync(ROOT, { recursive: true, force: true }));

// QA-0928-150: a crafted session_id ('../../escaped') wrote a file two levels
// above sessions/. Ids are Claude Code UUIDs; anything else is refused.
test('QA-0928-150: session ids are limited to a safe charset and never traverse', () => {
  for (const ok of ['0f8c2d4e-1b2a-4c3d-9e8f-7a6b5c4d3e2f', 'sess1', 'a.b_c-D9']) {
    assert.equal(paths.isValidSessionId(ok), true, ok);
    assert.equal(paths.sessionPath(ok), join(paths.SESSIONS_DIR, `${ok}.ndjson`));
  }
  const bad = ['../../escaped', '..', '.', 'a/b', 'a\\b', 'a..b', '', ' ', 'x'.repeat(129), 'a b', null, undefined, 42];
  for (const id of bad) {
    assert.equal(paths.isValidSessionId(id), false, String(id));
    assert.throws(() => paths.sessionPath(id), /invalid session id/, `sessionPath(${JSON.stringify(id)}) must refuse`);
  }
});

// QA-0928-142: ~/.wtclaude holds the anonymous id and the salt; it was created
// 0755. It must be private to the user.
test('QA-0928-142: ensureDataDirs creates the data dir with mode 0700', () => {
  paths.ensureDataDirs();
  for (const d of [paths.WTCLAUDE_DIR, paths.SESSIONS_DIR]) {
    assert.equal(statSync(d).mode & 0o777, 0o700, `${d} must be 0700`);
  }
});

// QA-0928-46: setup/uninstall must edit the settings file Claude Code reads,
// which CLAUDE_CONFIG_DIR relocates (same resolution as the jsonl reader).
test('QA-0928-46: claudeConfigDir/claudeSettingsPath honour CLAUDE_CONFIG_DIR', () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  try {
    delete process.env.CLAUDE_CONFIG_DIR;
    assert.equal(paths.claudeConfigDir(), join(homedir(), '.claude'));
    assert.equal(paths.claudeSettingsPath(), join(homedir(), '.claude', 'settings.json'));
    process.env.CLAUDE_CONFIG_DIR = join(ROOT, 'alt');
    assert.equal(paths.claudeConfigDir(), join(ROOT, 'alt'));
    assert.equal(paths.claudeSettingsPath(), join(ROOT, 'alt', 'settings.json'));
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});
