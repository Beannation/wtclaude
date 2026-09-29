// Fixed zone first: fixtures are anchored to today's LOCAL midnight.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ───────────────────────────────────────────────────────────────────────────
// `wtclaude compare-models`, end to end (BUILD-018). Spawned with a fixed TZ and
// a scratch WTCLAUDE_DIR / HOME, so neither the real data nor the real Cowork
// logs are touched.
//  • QA-0928-21 (decision 4): the Code surface prints % differences against
//    "your mix, re-priced" and the billing-grade total for the window — never a
//    re-priced $/mo, "[billing-grade tokens]" or "what you actually run".
//  • QA-0928-22: the same one day of data projects the same /mo whatever
//    --days is, and says which basis it used.
//  • QA-0928-84: logs found but idle in the window is "No Cowork activity in
//    the last N days", not "No data captured on this machine" + an env hint.
// ───────────────────────────────────────────────────────────────────────────

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');
const TZ = 'America/New_York';

// Hermetic: HOME (and so ~/.claude, the Cowork tree) defaults to the fixture's
// data dir, never the developer's real one.
function run(args, env) {
  const home = env.HOME || env.WTCLAUDE_DIR;
  const r = spawnSync(process.execPath, [BIN, ...args], {
    env: { ...process.env, WTCLAUDE_NO_AUTOSYNC: '1', TZ, HOME: home, CLAUDE_CONFIG_DIR: join(home, '.claude'), ...env }, encoding: 'utf8',
  });
  return { out: r.stdout + r.stderr, status: r.status };
}

// Today's LOCAL midnight: never in the future, always today, whatever minute
// the suite runs in (a turn "a minute ago" is yesterday just after midnight).
const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

function dataDir(turns) {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-cm-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  writeFileSync(join(dir, 'sessions', 's1.ndjson'), turns.map(t => JSON.stringify({
    ts: todayStart(), speed_tier: 'standard', session_id: 's1',
    input_tokens: 200000, output_tokens: 60000, cache_read_tokens: 3000000, cache_write_tokens: 100000, ...t,
  })).join('\n') + '\n');
  return dir;
}

function coworkLog(dir, ts, name = 'audit.jsonl') {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify({
    type: 'assistant', _audit_timestamp: ts,
    message: { id: 'm1', model: 'claude-sonnet-5', role: 'assistant', stop_reason: 'end_turn', usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 } },
  }) + '\n');
  return path;
}

test('decision 4: the Code surface shows % only beside the billing-grade total', () => {
  const dir = dataDir([{ model: 'claude-opus-5-5', cost_usd: 12.5 }, { model: 'claude-sonnet-5', cost_usd: 2.25 }]);
  try {
    const { out } = run(['compare-models', '--days', '7'], { WTCLAUDE_DIR: dir, WTCLAUDE_COWORK_AUDIT: join(dir, 'none.jsonl') });
    const code = out.slice(out.indexOf('Code (terminal)'), out.indexOf('Cowork  ['));
    assert.doesNotMatch(out, /\[billing-grade tokens\]|what you actually run|baseline —/);
    assert.match(code, /Billed in this window:\s+\$14\.75 \(billing-grade\)/);
    assert.doesNotMatch(code, /\/mo/, `no re-priced $/mo on the Code surface:\n${code}`);
    assert.match(code, /Sonnet 5\s+-\d+%\s+vs your mix, re-priced/);
    assert.match(code, /Dollar figures withheld: re-pricing uses your recorded tokens/);
    // "billing-grade" appears once on the Code surface: on the billed total.
    assert.equal(code.split('billing-grade').length - 1, 1, code);

    const json = JSON.parse(run(['compare-models', '--days', '7', '--json'], { WTCLAUDE_DIR: dir, WTCLAUDE_COWORK_AUDIT: join(dir, 'none.jsonl') }).out);
    assert.equal(json.surfaces.code.grade, 'estimate');
    assert.equal(json.surfaces.code.usd_withheld, true);
    assert.equal(json.surfaces.code.baseline_monthly_usd, null);
    assert.equal(json.surfaces.code.billed.usd, 14.75);
    assert.equal(json.surfaces.code.billed.label, 'billing-grade');
    assert.deepEqual(json.window, { start: json.window.start, end: json.window.end, days: 7 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-22: one day of data projects the same Cowork /mo at --days 1, 7 and 30, and says so', () => {
  const dir = dataDir([{ model: 'claude-opus-5-5', cost_usd: 1 }]);
  const audit = coworkLog(dir, todayStart());
  try {
    const env = { WTCLAUDE_DIR: dir, WTCLAUDE_COWORK_AUDIT: audit };
    const monthly = [1, 7, 30].map(days => JSON.parse(run(['compare-models', '--days', String(days), '--json'], env).out).surfaces.cowork);
    for (const s of monthly) {
      assert.equal(s.covered_days, 1);
      assert.equal(s.baseline_monthly_usd, 360, 'Sonnet 5 1M in + 1M out = $12 in one day -> $360/mo');
    }
    const text = run(['compare-models', '--days', '30'], env).out;
    assert.match(text, /projected from 1 day of data — tracking began inside the 30-day window/);
    assert.match(text, /Your mix, re-priced\s+\$360\.00\/mo/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-84: Cowork logs that are idle in the window say so — no env-var hint', () => {
  const dir = dataDir([{ model: 'claude-opus-5-5', cost_usd: 1 }]);
  const home = mkdtempSync(join(tmpdir(), 'wtc-cm-home-'));
  const run1 = join(home, 'Library', 'Application Support', 'Claude', 'local-agent-mode-sessions', 'a', 'o', 'local_x');
  mkdirSync(run1, { recursive: true });
  const old = coworkLog(run1, '2026-01-10T12:00:00.000Z');
  utimesSync(old, new Date('2026-01-10T12:00:00Z'), new Date('2026-01-10T12:00:00Z'));
  try {
    const { out } = run(['compare-models', '--days', '3'], { WTCLAUDE_DIR: dir, HOME: home, WTCLAUDE_COWORK_AUDIT: '' });
    const cowork = out.slice(out.indexOf('Cowork  ['), out.indexOf('Chat  ['));
    assert.match(cowork, /No Cowork activity in the last 3 days\./);
    assert.doesNotMatch(cowork, /No data captured|WTCLAUDE_COWORK_AUDIT/);
    // With no logs at all, the not-captured message and the hint remain.
    const none = run(['compare-models', '--days', '3'], { WTCLAUDE_DIR: dir, HOME: mkdtempSync(join(tmpdir(), 'wtc-cm-empty-')), WTCLAUDE_COWORK_AUDIT: '' }).out;
    assert.match(none.slice(none.indexOf('Cowork  [')), /No data captured on this machine\.[\s\S]*WTCLAUDE_COWORK_AUDIT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  }
});

test('QA-0928-84: a Code surface with history but nothing in the window is not "not captured"', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-cm-old-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  writeFileSync(join(dir, 'sessions', 'old.ndjson'), JSON.stringify({
    ts: '2026-01-10T12:00:00.000Z', model: 'claude-opus-5', session_id: 'old', cost_usd: 1,
    input_tokens: 1, output_tokens: 1, cache_read_tokens: 0, cache_write_tokens: 0,
  }) + '\n');
  const audit = coworkLog(dir, todayStart());
  try {
    const { out } = run(['compare-models', '--days', '3'], { WTCLAUDE_DIR: dir, WTCLAUDE_COWORK_AUDIT: audit });
    const code = out.slice(out.indexOf('Code (terminal)'), out.indexOf('Cowork  ['));
    assert.match(code, /No Code activity in the last 3 days\./);
    assert.doesNotMatch(code, /No data captured/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Ledger reviewer (must ship with QA-0928-54): the exclusion notice said "your
// headline totals still count it" for every excluded turn. That holds only for
// a turn Claude Code reported a cost for; an unanchored turn on a model we
// can't price is left out of the headline too, and the notice says so.
test('the Code exclusion notice claims the headline counts a turn only when Claude Code reported its cost', () => {
  const env = (dir) => ({ WTCLAUDE_DIR: dir, HOME: dir, WTCLAUDE_COWORK_AUDIT: join(dir, 'none.jsonl') });
  // One line per surface: the notice wraps at its own width.
  const surface = (out) => out.slice(out.indexOf('Code (terminal)'), out.indexOf('Cowork')).replace(/\s+/g, ' ');
  const anchored = dataDir([{ model: 'claude-opus-5-5', cost_usd: 5 }, { model: 'claude-opus-6', cost_usd: 3 }]);
  const unanchored = dataDir([{ model: 'claude-opus-5-5', cost_usd: 5 }, { model: 'claude-opus-6' }, { model: 'claude-zeta-9' }]);
  const mixed = dataDir([{ model: 'claude-opus-5-5', cost_usd: 5 }, { model: 'claude-opus-6', cost_usd: 3 }, { model: 'claude-zeta-9' }]);
  try {
    const a = surface(run(['compare-models', '--days', '7'], env(anchored)).out);
    assert.match(a, /headline cost is unaffected/);
    assert.match(a, /still count it/);

    const u = surface(run(['compare-models', '--days', '7'], env(unanchored)).out);
    assert.doesNotMatch(u, /headline cost is unaffected|still count/, `claimed the headline counts unanchored turns:\n${u}`);
    assert.match(u, /Claude Code sent no cost for these turns, so your headline totals leave them out too/);
    assert.match(u, /Not priced/);

    const m = surface(run(['compare-models', '--days', '7'], env(mixed)).out);
    assert.match(m, /headline totals still count 1 of them/);
    assert.match(m, /the other 1 carries no cost from Claude Code/);
  } finally {
    for (const d of [anchored, unanchored, mixed]) rmSync(d, { recursive: true, force: true });
  }
});
