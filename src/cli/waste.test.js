// Pinned before any Date use, and passed to every spawned CLI.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');

// `wtclaude waste` against a throwaway HOME (inventory + transcripts under
// ~/.claude) and an empty project dir as cwd; never the real ~/.claude.
function fixture({ skills = [], claudeMd = null, turns = [] } = {}, root = null) {
  const home = mkdtempSync(join(tmpdir(), 'wtc-waste-home-'));
  const proj = mkdtempSync(join(tmpdir(), 'wtc-waste-proj-'));
  const base = root || join(home, '.claude');
  for (const name of skills) {
    mkdirSync(join(base, 'skills', name), { recursive: true });
    writeFileSync(join(base, 'skills', name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${'Does a specific thing when asked to. '.repeat(20)}\n---\nbody`);
  }
  if (claudeMd) { mkdirSync(base, { recursive: true }); writeFileSync(join(base, 'CLAUDE.md'), claudeMd); }
  const at = (daysAgo = 0) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(12, 0, 0, 0); return d.toISOString(); };
  const lines = turns.map((t, i) => JSON.stringify({
    type: 'assistant', timestamp: at(t.daysAgo), requestId: 'r' + i, sessionId: 's',
    message: { id: 'm' + i, role: 'assistant', model: t.model,
      content: (t.tools || []).map(([name, input], j) => ({ type: 'tool_use', id: `t${i}-${j}`, name, input })) },
  }));
  mkdirSync(join(base, 'projects', 'p'), { recursive: true });
  writeFileSync(join(base, 'projects', 'p', 's.jsonl'), lines.join('\n') + '\n');
  return { home, proj, cleanup: () => { rmSync(home, { recursive: true, force: true }); rmSync(proj, { recursive: true, force: true }); } };
}

function waste({ home, proj }, args = [], extraEnv = {}) {
  const env = { ...process.env, HOME: home, WTCLAUDE_DIR: join(home, '.wtclaude'), WTCLAUDE_NO_AUTOSYNC: '1', TZ: 'America/New_York', ...extraEnv };
  if (!('CLAUDE_CONFIG_DIR' in extraEnv)) delete env.CLAUDE_CONFIG_DIR;
  const res = spawnSync(process.execPath, [BIN, 'waste', ...args], { env, cwd: proj, encoding: 'utf8' });
  return { out: res.stdout + res.stderr, status: res.status };
}

const turnsOn = (model, n, tools) => Array.from({ length: n }, () => ({ model, tools }));

test('QA-0928-20: each model priced at its own rate; unknown-model turns are named, not priced at another model\'s rate', () => {
  const fx = fixture({ skills: ['dead-skill'], turns: [...turnsOn('claude-opus-5-5', 60), ...turnsOn('claude-opus-6', 40)] });
  try {
    const { out } = waste(fx);
    assert.match(out, /Left out of the figure — 40 turns on claude-opus-6: not in this rate sheet/);
    const j = JSON.parse(waste(fx, ['--json']).out);
    assert.equal(j.priced_turns, 60);
    assert.deepEqual(j.excluded_models, [{ model: 'claude-opus-6', turns: 40, reason: 'family-fallback:opus-5-5' }]);
    // 60 turns at Opus 5.5's own $4 x 0.05, not 100.
    const dead = j.items.find(i => i.id === 'skill:dead-skill');
    assert.ok(Math.abs(j.window_usd - dead.tokens / 1e6 * 4 * 0.05 * 60) < 1e-6);
  } finally { fx.cleanup(); }
});

test('QA-0928-70: only the invoked skill is KEEP — not the ones matching a tool name or a Bash command', () => {
  const fx = fixture({ skills: ['alpha-skill', 'beta-skill', 'canon-writer'], turns: [
    { model: 'claude-opus-5-5', tools: [['Skill', { skill: 'alpha-skill' }]] },
    { model: 'claude-opus-5-5', tools: [['Write', { file_path: '/tmp/x', content: 'y' }]] },
    { model: 'claude-opus-5-5', tools: [['Bash', { command: 'echo beta-skill canon-writer' }]] },
  ] });
  try {
    const j = JSON.parse(waste(fx, ['--json']).out);
    const keep = j.items.filter(i => i.verdict === 'KEEP').map(i => i.id);
    assert.deepEqual(keep, ['skill:alpha-skill']);
  } finally { fx.cleanup(); }
});

test('QA-0928-71: CLAUDE.md is listed as always loaded, not judged, and kept out of the dead-weight figure', () => {
  const fx = fixture({ skills: ['dead-skill'], claudeMd: 'Always write tests. '.repeat(40), turns: turnsOn('claude-opus-5-5', 10) });
  try {
    const { out } = waste(fx);
    assert.match(out, /1 always-loaded skill or subagent, 0 used/);
    assert.match(out, /always loaded — not invocable, so no invocation evidence/);
    assert.match(out, /not counted in the figure above/);
    assert.doesNotMatch(out, /REVIEW\s+rule:/, 'CLAUDE.md is never a REVIEW item');
    const j = JSON.parse(waste(fx, ['--json']).out);
    const rule = j.items.find(i => i.type === 'rule');
    assert.equal(rule.used, null);
    assert.equal(j.dead_tokens, j.items.find(i => i.id === 'skill:dead-skill').tokens);
  } finally { fx.cleanup(); }
});

test('QA-0928-72: skills under CLAUDE_CONFIG_DIR are inventoried when ~/.claude is empty', () => {
  const alt = mkdtempSync(join(tmpdir(), 'wtc-waste-ccd-'));
  const fx = fixture({ skills: ['deploy'], claudeMd: 'Rules.', turns: turnsOn('claude-opus-5-5', 3) }, alt);
  try {
    const { out } = waste(fx, [], { CLAUDE_CONFIG_DIR: alt });
    assert.doesNotMatch(out, /nothing to review/);
    assert.match(out, /skill:deploy/);
    assert.match(out, new RegExp(`${alt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/skills`));
  } finally { fx.cleanup(); rmSync(alt, { recursive: true, force: true }); }
});

test('QA-0928-74: waste --days rejects non-numbers and out-of-range values with a usage error', () => {
  const fx = fixture({ skills: ['s'], turns: turnsOn('claude-opus-5-5', 1) });
  try {
    for (const bad of ['abc', '0', '-3', '400']) {
      const { out, status } = waste(fx, ['--days', bad]);
      assert.equal(status, 1, `--days ${bad}`);
      assert.match(out, /--days must be a whole number of days, 1 or more, up to 365 \(got "/);
    }
    assert.equal(waste(fx, ['--days', '7']).status, 0);
  } finally { fx.cleanup(); }
});

// Canon: "billing-grade" is the statusline cost anchor. The multi-model fine
// print (new in QA-0928-20) extended the single-model line's claim to each
// model's list rate; it now claims billing-grade only for what the withheld
// branches already did (turns re-read, from your transcript) and names the
// rates as this rate sheet's list rates.
test('QA-0928-20: a mixed window names each model\'s rate as a list rate, not billing-grade', () => {
  const fx = fixture({ skills: ['dead-skill'], turns: [...turnsOn('claude-opus-5-5', 6), ...turnsOn('claude-sonnet-5', 4)] });
  try {
    const { out } = waste(fx);
    const fine = out.slice(out.indexOf('Billing-grade vs estimate:'));
    const billingBullet = fine.slice(fine.indexOf('• billing-grade:'), fine.indexOf('•', fine.indexOf('• billing-grade:') + 1));
    assert.doesNotMatch(billingBullet, /multiplier|\/MTok|input rate/, billingBullet);
    assert.match(fine, /list rates/);
    assert.match(fine, /opus-5-5: 5% of \$4\/MTok \(6 turns\)/);
    assert.match(fine, /sonnet-5: 10% of \$2\/MTok \(4 turns\)/);
    const j = JSON.parse(waste(fx, ['--json']).out);
    assert.equal(j.labels.input_rate, 'per-model');
  } finally { fx.cleanup(); }
});

// ── RC 2026-09-28: waste's /mo uses the days the transcripts cover (QA-0928-22) ─
// One day of data projected to a month is the same figure whichever --days is
// asked for; it used to divide by the requested window (a first-day user's
// default reading was 30x too low).
test('waste /mo is projected from the days of transcript data, the same at --days 1, 7, 30 and 90', () => {
  const fx = fixture({ skills: ['dead-skill'], turns: turnsOn('claude-opus-5-5', 200) });
  try {
    const runs = [1, 7, 30, 90].map(d => JSON.parse(waste(fx, ['--days', String(d), '--json']).out));
    for (const j of runs) assert.equal(j.covered_days, 1, `--days ${j.days}`);
    const first = runs[0].monthly_usd;
    assert.ok(first > 0);
    for (const j of runs) assert.ok(Math.abs(j.monthly_usd - first) < 1e-9, `--days ${j.days}: ${j.monthly_usd} vs ${first}`);
    assert.ok(Math.abs(runs[2].monthly_usd - runs[2].window_usd * 30) < 1e-6, '1 day of data x 30');
    const text = waste(fx).out.replace(/\s+/g, ' ');
    assert.match(text, /\/mo re-reading the other 1 at cache-read rates\. \[estimate\] \(projected from 1 day of data — tracking began inside the 30-day window\)/);
    assert.match(waste(fx, ['--days', '1']).out.replace(/\s+/g, ' '), /\(projected from the full 1-day window\)/);
  } finally { fx.cleanup(); }
});

test('waste: data before the window means the whole window is covered', () => {
  // One file with a turn 10 days ago and 20 today: a 5-day window is fully
  // covered; a 30-day window is covered from 10 days ago (11 days).
  const fx = fixture({ skills: ['dead-skill'], turns: [{ model: 'claude-opus-5-5', daysAgo: 10 }, ...turnsOn('claude-opus-5-5', 20)] });
  try {
    const five = JSON.parse(waste(fx, ['--days', '5', '--json']).out);
    assert.equal(five.covered_days, 5);
    assert.ok(Math.abs(five.monthly_usd - five.window_usd * 30 / 5) < 1e-4);
    const thirty = JSON.parse(waste(fx, ['--days', '30', '--json']).out);
    assert.equal(thirty.covered_days, 11);
    assert.ok(Math.abs(thirty.monthly_usd - thirty.window_usd * 30 / 11) < 1e-4);
  } finally { fx.cleanup(); }
});

test('waste: a transcript last written before the window counts the whole window as covered', () => {
  const fx = fixture({ skills: ['dead-skill'], turns: turnsOn('claude-opus-5-5', 20) });
  try {
    // An older file (mtime and entries 60 days back) that the scan skips unread.
    const old = new Date(); old.setDate(old.getDate() - 60); old.setHours(12, 0, 0, 0);
    const p = join(fx.home, '.claude', 'projects', 'p', 'old.jsonl');
    writeFileSync(p, JSON.stringify({ type: 'assistant', timestamp: old.toISOString(), requestId: 'ro', sessionId: 'old',
      message: { id: 'mo', role: 'assistant', model: 'claude-opus-5-5', content: [] } }) + '\n');
    utimesSync(p, old, old);
    const j = JSON.parse(waste(fx, ['--days', '30', '--json']).out);
    assert.equal(j.covered_days, 30);
    assert.ok(Math.abs(j.monthly_usd - j.window_usd) < 1e-4);
  } finally { fx.cleanup(); }
});

test('waste --days 1 reads "in the last 1 day"', () => {
  const fx = fixture({ skills: ['dead-skill'], turns: turnsOn('claude-opus-5-5', 3) });
  try {
    const { out } = waste(fx, ['--days', '1']);
    assert.match(out, /used in the last 1 day\./);
    assert.doesNotMatch(out, /last 1 days/);
  } finally { fx.cleanup(); }
});
