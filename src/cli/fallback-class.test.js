import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ───────────────────────────────────────────────────────────────────────────
// THE FAMILY-FALLBACK CLASS, end to end through the real CLI (BUILD-017,
// 2026-09-27). Opus 5.5 became Claude Code's default model on 2026-09-22 and
// shipped 0.3.0 did not know it. Two user-visible failures, both reproduced
// against the published 0.3.0 artifact:
//   • `compare-models` on an all-Opus-5.5 window printed "No data captured on
//     this machine." — every turn had been captured, then excluded.
//   • `waste` priced dead weight at Opus 5's cache read and called it
//     billing-grade.
// 0.3.1 knows Opus 5.5, so these use an Opus id NO sheet knows yet — the next
// one — because the guard is on the class, not the row.
// ───────────────────────────────────────────────────────────────────────────

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');

// Hermetic: HOME defaults to the fixture's data dir (never the developer's
// real ~/.claude or ~/.wtclaude); a test that needs its own HOME passes it.
function run(args, env, cwd) {
  const home = env.HOME || env.WTCLAUDE_DIR;
  const res = spawnSync(process.execPath, [BIN, ...args], {
    env: { ...process.env, WTCLAUDE_NO_AUTOSYNC: '1', HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), ...env }, cwd, encoding: 'utf8',
  });
  return res.stdout + res.stderr;
}

function recentTs(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
}

function wtclaudeDirWith(models) {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-fallback-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'),
    JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  const lines = models.map((model, i) => JSON.stringify({
    ts: recentTs(2 + i), model, speed_tier: 'standard', session_id: 'sess-fb',
    input_tokens: 200000, output_tokens: 60000, cache_read_tokens: 3000000, cache_write_tokens: 100000,
    cost_usd: 3.21,
  }));
  writeFileSync(join(dir, 'sessions', 'sess-fb.ndjson'), lines.join('\n') + '\n');
  return dir;
}

test('compare-models: an all-excluded surface says so — never "No data captured"', () => {
  const dir = wtclaudeDirWith(['claude-opus-9-20270101', 'claude-opus-9-20270101[1m]']);
  try {
    const out = run(['compare-models', '--days', '7'], { WTCLAUDE_DIR: dir, WTCLAUDE_COWORK_AUDIT: join(dir, 'none.jsonl') });
    const code = out.slice(out.indexOf('Code (terminal)'), out.indexOf('Cowork'));
    assert.doesNotMatch(code, /No data captured/, `the Code surface lied about having no data:\n${code}`);
    assert.match(code, /All 2 turns on this surface were excluded/);
    assert.match(code, /claude-opus-9-20270101/);
    assert.match(code, /npm i -g wtclaude@latest/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compare-models: Opus 5.5 turns are priced, compared, and not excluded', () => {
  const dir = wtclaudeDirWith(['claude-opus-5-5[1m]', 'claude-opus-5-5']);
  try {
    const json = JSON.parse(run(['compare-models', '--days', '7', '--json'], { WTCLAUDE_DIR: dir, WTCLAUDE_COWORK_AUDIT: join(dir, 'none.jsonl') }));
    const code = json.surfaces.code;
    assert.equal(code.unpriced_turn_count, 0);
    assert.equal(code.turn_count, 2);
    assert.deepEqual(json.models.map(m => m.label), ['Opus 5.5', 'Sonnet 5', 'Fable 5.1']);
    const opus = code.models.find(m => m.key === 'opus-5-5');
    assert.ok(Math.abs(opus.delta_vs_baseline_usd) < 1e-6, 're-pricing Opus 5.5 usage to Opus 5.5 nets $0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function claudeHomeWith(model) {
  const home = mkdtempSync(join(tmpdir(), 'wtc-waste-'));
  const claude = join(home, '.claude');
  mkdirSync(join(claude, 'projects', 'p'), { recursive: true });
  writeFileSync(join(claude, 'CLAUDE.md'), 'Always-loaded house rules. '.repeat(400));
  // The dead weight priced below is a never-invoked skill: CLAUDE.md is always
  // loaded but not invocable, so `waste` no longer judges it (QA-0928-71).
  mkdirSync(join(claude, 'skills', 'house-style'), { recursive: true });
  writeFileSync(join(claude, 'skills', 'house-style', 'SKILL.md'),
    `---\nname: house-style\ndescription: ${'Applies the house style to every document. '.repeat(60)}\n---\n`);
  const entries = [0, 1, 2].map(i => JSON.stringify({
    type: 'assistant', timestamp: recentTs(1 + i), sessionId: 's1',
    message: { id: `m${i}`, role: 'assistant', model, content: [{ type: 'text', text: 'ok' }],
      usage: { input_tokens: 10, output_tokens: 10 } },
  }));
  writeFileSync(join(claude, 'projects', 'p', 's1.jsonl'), entries.join('\n') + '\n');
  return { home, claude };
}

test('waste: a family-fallback model withholds the dollar figure, in text and in --json', () => {
  const { home, claude } = claudeHomeWith('claude-opus-9-20270101');
  try {
    const env = { HOME: home, CLAUDE_CONFIG_DIR: claude, WTCLAUDE_DIR: join(home, '.wtclaude') };
    const out = run(['waste', '--days', '7'], env, home);
    assert.match(out, /No dollar figure is shown/);
    assert.match(out, /claude-opus-9-20270101 is not in this version's rate sheet/);
    assert.doesNotMatch(out, /~\$[\d.]+\/mo/, 'no monthly dollar figure may print');
    assert.doesNotMatch(out, /10% cache-read/, 'the old hard-coded 10% is gone');
    const json = JSON.parse(run(['waste', '--days', '7', '--json'], env, home));
    assert.equal(json.priced, false);
    assert.equal(json.unpriced_reason, 'family-fallback:opus-5-5');
    assert.equal(json.model, null, 'the guess is never named as the model');
    assert.equal(json.monthly_usd, null);
    assert.equal(json.labels.input_rate, 'unavailable');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('waste: an Opus 5.5 session renders its own 5% multiplier and $4/MTok rate', () => {
  const { home, claude } = claudeHomeWith('claude-opus-5-5');
  try {
    const env = { HOME: home, CLAUDE_CONFIG_DIR: claude, WTCLAUDE_DIR: join(home, '.wtclaude') };
    const out = run(['waste', '--days', '7'], env, home);
    assert.match(out, /~\$[\d.]+\/mo re-reading/);
    assert.match(out, /at 5% of/);
    assert.match(out, /the 5% cache-read\s+multiplier and the \$4\/MTok input rate for opus-5-5/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('whatif --model refuses a family-fallback or partner TARGET instead of printing a guessed figure', () => {
  const dir = wtclaudeDirWith(['claude-opus-5-5', 'claude-sonnet-5']);
  try {
    const env = { WTCLAUDE_DIR: dir };
    for (const target of ['claude-opus-9-20270101', 'opus-6', 'vertex_ai/claude-sonnet-5', 'bedrock/anthropic.claude-opus-5-5']) {
      const out = run(['whatif', '--model', target, '--days', '2'], env);
      assert.doesNotMatch(out, /If all/, `${target}: no hypothetical may print`);
      assert.doesNotMatch(out, /\$\d/, `${target}: no dollar figure may print`);
      assert.match(out, /no figure shown/, `${target}: says why`);
    }
    // The family aliases still resolve to exact, priceable keys.
    assert.match(run(['whatif', '--model', 'opus', '--days', '2'], env), /If all opus-5-5/);
    assert.match(run(['whatif', '--model', 'fable', '--days', '2'], env), /If all fable-5-1/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('compare-models: the Cowork exclusion notice never claims a billing-grade anchor or `wtclaude today`', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-cowork-excl-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  const line = (id, model, usage) => JSON.stringify({ type: 'assistant', _audit_timestamp: recentTs(3), message: { id, model, role: 'assistant', usage } });
  writeFileSync(join(dir, 'audit.jsonl'), [
    line('m1', 'claude-opus-9-20270101', { input_tokens: 100, output_tokens: 50 }),
    line('m2', '<synthetic>', { input_tokens: 0, output_tokens: 0 }),
  ].join('\n') + '\n');
  try {
    const out = run(['compare-models', '--days', '7'], { WTCLAUDE_DIR: dir, WTCLAUDE_COWORK_AUDIT: join(dir, 'audit.jsonl') });
    const cowork = out.slice(out.indexOf('Cowork  ['), out.indexOf('Chat  ['));
    assert.match(cowork, /The one turn on this surface was excluded/, 'the <synthetic> line is not counted');
    assert.doesNotMatch(cowork, /<synthetic>/);
    assert.doesNotMatch(cowork, /billing-grade anchor|wtclaude today|headline cost/, `Cowork is an estimate:\n${cowork}`);
    assert.match(cowork, /Cowork figures are an estimate from Cowork’s local logs/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('fable --json: the promo note is user-facing text, not internal provenance', () => {
  const dir = wtclaudeDirWith(['claude-fable-5']);
  try {
    const json = JSON.parse(run(['fable', '--json'], { WTCLAUDE_DIR: dir }));
    assert.equal(json.promo_credits.status, 'expired');
    assert.equal(json.promo_credits.days_until_expiry, null);
    assert.doesNotMatch(json.promo_credits.expiry_note, /PMO|Surfaces must|VERIFIED|Help Center \d/);
    assert.match(json.promo_credits.expiry_note, /^Expired September 17, 2026 at 11:59 PM PT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('whatif: zero-token turns are not exclusions, an all-excluded window says so, and no anchor jargon', () => {
  // All-excluded: two real (tokened) turns on ids we cannot price.
  const all = wtclaudeDirWith(['claude-opus-9-20270101', 'vertex_ai/claude-sonnet-5']);
  try {
    const out = run(['whatif', '--model', 'opus', '--days', '2'], { WTCLAUDE_DIR: all });
    assert.match(out, /All 2 turns in this window were excluded/);
    assert.doesNotMatch(out, /Current models:|If all/, 'no $0-vs-$0 comparison');
    assert.doesNotMatch(out, /billing-grade anchor|real cost/);
    assert.match(out, /headline cost is unaffected/);
  } finally {
    rmSync(all, { recursive: true, force: true });
  }
  // Zero-token unknown turn next to a priced one: nothing excluded.
  const dir = wtclaudeDirWith(['claude-sonnet-5']);
  try {
    writeFileSync(join(dir, 'sessions', 'zero.ndjson'), JSON.stringify({
      ts: recentTs(1), model: 'claude-opus-9-20270101', speed_tier: 'standard', session_id: 'zero',
      input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0,
    }) + '\n');
    const out = run(['whatif', '--model', 'opus', '--days', '2'], { WTCLAUDE_DIR: dir });
    assert.match(out, /If all opus-5-5/);
    assert.doesNotMatch(out, /unpriced and excluded/, 'a zero-token turn is not an exclusion');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('waste: the withheld reason prints once, not twice', () => {
  const { home, claude } = claudeHomeWith('claude-opus-9-20270101');
  try {
    const out = run(['waste', '--days', '7'], { HOME: home, CLAUDE_CONFIG_DIR: claude, WTCLAUDE_DIR: join(home, '.wtclaude') }, home);
    assert.equal(out.split("is not in this version's rate sheet").length - 1, 1, out);
    assert.match(out, /for the reason above/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('whatif: plain-language reasons, and a zero-token-only window is not a $0 comparison', () => {
  const all = wtclaudeDirWith(['claude-opus-9-20270101', 'vertex_ai/claude-sonnet-5']);
  try {
    const out = run(['whatif', '--model', 'opus', '--days', '2'], { WTCLAUDE_DIR: all });
    assert.doesNotMatch(out, /family-fallback|partner-platform|unresolved-model|opus-5-5\)/, 'no internal reason codes');
    assert.match(out, /not in this version's rate sheet/);
    assert.match(out, /served by vertex_ai/);
    assert.doesNotMatch(out, /wtclaude today/);
  } finally {
    rmSync(all, { recursive: true, force: true });
  }
  const dir = mkdtempSync(join(tmpdir(), 'wtc-zero-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  writeFileSync(join(dir, 'sessions', 'z.ndjson'), JSON.stringify({
    ts: recentTs(1), model: 'claude-opus-9-20270101', speed_tier: 'standard', session_id: 'z',
    input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0,
  }) + '\n');
  try {
    const out = run(['whatif', '--model', 'opus', '--days', '2'], { WTCLAUDE_DIR: dir });
    assert.match(out, /Nothing to compare in this window/);
    assert.doesNotMatch(out, /\$0\.0000/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
