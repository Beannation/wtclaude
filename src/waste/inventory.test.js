import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanInventory } from './inventory.js';

test('inventory targets always-loaded prose, not tool/function declarations', () => {
  const base = mkdtempSync(join(tmpdir(), 'wtc-inv-'));
  const proj = mkdtempSync(join(tmpdir(), 'wtc-prj-'));
  try {
    // a skill (prose) as a folder with SKILL.md
    mkdirSync(join(base, 'skills', 'deploy'), { recursive: true });
    writeFileSync(join(base, 'skills', 'deploy', 'SKILL.md'),
      '---\nname: deploy\ndescription: Ship the app to production safely.\n---\n# Deploy\nbody...');
    // a NON-prose tool declaration that must be ignored (Anthropic defers these)
    writeFileSync(join(base, 'skills', 'mcp-tools.json'), JSON.stringify({ tools: [{ name: 'x', input_schema: {} }] }));
    // a user rule file (prose)
    writeFileSync(join(base, 'CLAUDE.md'), 'Always write tests.');
    // an agent (prose)
    mkdirSync(join(base, 'agents'), { recursive: true });
    writeFileSync(join(base, 'agents', 'reviewer.md'), '---\nname: reviewer\ndescription: Reviews diffs.\n---\nsystem prompt');

    const items = scanInventory({ baseDir: base, projectDir: proj });
    const ids = items.map(i => i.id);
    assert.ok(ids.includes('skill:deploy'), 'skill prose inventoried');
    assert.ok(ids.includes('agent:reviewer'), 'agent prose inventoried');
    assert.ok(ids.includes('rule:CLAUDE.md (user)'), 'CLAUDE.md prose inventoried');
    // the .json tool declaration is NOT inventoried
    assert.ok(!items.some(i => /mcp-tools|input_schema|tools\.json/i.test(i.id + i.name)), 'tool declarations excluded');
    // the skill item counts the DESCRIPTION prose, not the body or a tool schema
    const deploy = items.find(i => i.id === 'skill:deploy');
    assert.ok(deploy.tokens > 0 && deploy.text.includes('Ship the app'));
    assert.ok(!deploy.text.includes('input_schema'));
  } finally {
    rmSync(base, { recursive: true, force: true });
    rmSync(proj, { recursive: true, force: true });
  }
});

test('inventory degrades gracefully on a missing base dir', () => {
  const items = scanInventory({ baseDir: '/nonexistent-wtc-xyz', projectDir: '/nonexistent-wtc-prj' });
  assert.ok(Array.isArray(items));
});

// QA-0928-72 (2026-09-28): the transcripts honour CLAUDE_CONFIG_DIR but the
// inventory hard-coded ~/.claude, so a relocated config reported nothing loaded.
test('QA-0928-72: the inventory honours CLAUDE_CONFIG_DIR and labels its real location', () => {
  const root = mkdtempSync(join(tmpdir(), 'wtc-ccd-'));
  const proj = mkdtempSync(join(tmpdir(), 'wtc-prj-'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  try {
    mkdirSync(join(root, 'skills', 'deploy'), { recursive: true });
    writeFileSync(join(root, 'skills', 'deploy', 'SKILL.md'), '---\nname: deploy\ndescription: Ship it.\n---\n');
    writeFileSync(join(root, 'CLAUDE.md'), 'Always write tests.');
    process.env.CLAUDE_CONFIG_DIR = root;
    const items = scanInventory({ projectDir: proj });
    const deploy = items.find(i => i.id === 'skill:deploy');
    assert.ok(deploy, 'a skill under CLAUDE_CONFIG_DIR is inventoried');
    assert.equal(deploy.source, join(root, 'skills'), 'the label names the real root, not ~/.claude');
    assert.ok(items.some(i => i.id === 'rule:CLAUDE.md (user)'));
    assert.ok(!items.some(i => i.source.startsWith('~/.claude')));
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
    rmSync(root, { recursive: true, force: true });
    rmSync(proj, { recursive: true, force: true });
  }
});
