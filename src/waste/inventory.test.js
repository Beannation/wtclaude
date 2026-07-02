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
