// Pinned before any Date use (the streamed path filters by local date).
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gatherEvidence, usedIdsFor } from './evidence.js';

// QA-0928-70 (2026-09-28): every tool name and every Bash command string went
// into one pool of "used names", matched two ways by 4+-character substrings.
// A skill named beta-skill was "used" because the Skill TOOL was called; one
// named canon-writer because Write was. On real data most of the items it
// called "used" matched only by substring. Evidence is now structural and exact.

const skill = (name) => ({ id: `skill:${name}`, type: 'skill', name });
const agent = (name) => ({ id: `agent:${name}`, type: 'agent', name });
const rule = (name) => ({ id: `rule:${name}`, type: 'rule', name });

function turn(id, model, tools = [], extra = {}) {
  return { type: 'assistant', timestamp: '2026-09-27T16:00:00.000Z', requestId: 'r' + id, ...extra,
    message: { id: 'm' + id, role: 'assistant', model,
      content: tools.map(([name, input]) => ({ type: 'tool_use', id: 't' + id + name, name, input })) } };
}

test('QA-0928-70: tool names and Bash command text never mark a skill used', () => {
  // The legacy bare-Set form: these are the names the old collector produced.
  const items = [skill('alpha-skill'), skill('beta-skill'), skill('canon-writer')];
  assert.deepEqual([...usedIdsFor(items, new Set(['skill', 'write', 'git status']))], []);
});

test('QA-0928-70: only a Skill-tool invocation marks a skill used (exact, or a plugin:skill suffix)', () => {
  const ev = gatherEvidence({ sessions: [{ session_id: 's', entries: [
    turn(1, 'claude-opus-5-5', [['Skill', { skill: 'alpha-skill' }]]),
    turn(2, 'claude-opus-5-5', [['Write', { file_path: '/tmp/canon-writer.md', content: 'beta-skill' }]]),
    turn(3, 'claude-opus-5-5', [['Bash', { command: 'git status && echo canon-writer beta-skill' }]]),
    turn(4, 'claude-opus-5-5', [['Skill', { skill: 'anthropic-skills:pdf' }]]),
  ] }] });
  const items = [skill('alpha-skill'), skill('beta-skill'), skill('canon-writer'), skill('pdf'), skill('df')];
  assert.deepEqual([...usedIdsFor(items, ev)].sort(), ['skill:alpha-skill', 'skill:pdf']);
});

test('QA-0928-70: a subagent counts only via subagent_type — and only for agents', () => {
  const ev = gatherEvidence({ sessions: [{ session_id: 's', entries: [
    turn(1, 'claude-opus-5-5', [['Agent', { subagent_type: 'reviewer', description: 'x', prompt: 'deploy' }]]),
  ] }] });
  const items = [agent('reviewer'), skill('reviewer'), agent('deploy'), skill('deploy')];
  assert.deepEqual([...usedIdsFor(items, ev)], ['agent:reviewer']);
});

test('a turn attributed to a skill (attributionSkill) is evidence that skill ran', () => {
  const ev = gatherEvidence({ sessions: [{ session_id: 's', entries: [
    turn(1, 'claude-opus-5-5', [], { attributionSkill: 'plugin-x:gamma' }),
  ] }] });
  assert.deepEqual([...usedIdsFor([skill('gamma'), skill('delta')], ev)], ['skill:gamma']);
});

test('QA-0928-71: CLAUDE.md rule files are never judged by invocation', () => {
  const ev = gatherEvidence({ sessions: [{ session_id: 's', entries: [
    turn(1, 'claude-opus-5-5', [['Skill', { skill: 'CLAUDE.md (user)' }]]),
  ] }] });
  assert.deepEqual([...usedIdsFor([rule('CLAUDE.md (user)')], ev)], []);
});

test('QA-0928-20: evidence counts turns per model, not one dominant model', () => {
  const entries = [];
  for (let i = 0; i < 6; i++) entries.push(turn(`a${i}`, 'claude-opus-5-5'));
  for (let i = 0; i < 4; i++) entries.push(turn(`b${i}`, 'claude-opus-6'));
  entries.push(turn('a0', 'claude-opus-5-5'));                          // a streamed repeat: same response
  entries.push(turn('syn', '<synthetic>'));                             // not a model turn
  entries.push({ ...turn('nomodel', undefined) });
  const ev = gatherEvidence({ sessions: [{ session_id: 's', entries }] });
  assert.equal(ev.turns, 11);
  assert.deepEqual(ev.modelTurns, { 'claude-opus-5-5': 6, 'claude-opus-6': 4 });
  assert.equal(ev.model, 'claude-opus-5-5', 'the dominant model is still reported');
});

test('QA-0928-15: the streamed path reads the same evidence from disk', () => {
  const root = mkdtempSync(join(tmpdir(), 'wtc-ev-'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  try {
    mkdirSync(join(root, 'projects', 'p'), { recursive: true });
    writeFileSync(join(root, 'projects', 'p', 's.jsonl'), [
      JSON.stringify({ type: 'user', timestamp: '2026-09-27T15:59:00.000Z', message: { role: 'user', content: 'use alpha-skill' } }),
      JSON.stringify(turn(1, 'claude-opus-5-5', [['Skill', { skill: 'alpha-skill' }]])),
      JSON.stringify(turn(2, 'claude-sonnet-5')),
      // 22:00 EDT the previous day: outside a 09-27 local window.
      JSON.stringify({ ...turn(3, 'claude-sonnet-5', [['Skill', { skill: 'beta-skill' }]]), timestamp: '2026-09-27T02:00:00.000Z' }),
    ].join('\n') + '\n');
    process.env.CLAUDE_CONFIG_DIR = root;
    const ev = gatherEvidence({ dateFilter: { start: '2026-09-27', end: '2026-09-27' } });
    assert.equal(ev.turns, 2);
    assert.deepEqual(ev.modelTurns, { 'claude-opus-5-5': 1, 'claude-sonnet-5': 1 });
    assert.deepEqual([...usedIdsFor([skill('alpha-skill'), skill('beta-skill')], ev)], ['skill:alpha-skill']);
  } finally {
    if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev;
    rmSync(root, { recursive: true, force: true });
  }
});
