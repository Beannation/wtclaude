import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ───────────────────────────────────────────────────────────────────────────
// `wtclaude fable`, end to end (BUILD-018), with a fixed TZ and scratch data.
//  • QA-0928-73: the run-rate divides by the days the look-back covers, not
//    the days with Fable use, and says which.
//  • QA-0928-78: partner-platform Fable turns are billed by the platform and
//    left out of "Billed in window"; an unknown Fable id gets no borrowed rate.
//  • QA-0928-170: an unknown --plan is refused; plan_known means a known plan.
// ───────────────────────────────────────────────────────────────────────────

process.env.TZ = 'America/New_York';
const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');

// Local noon, `k` days before today — clear of any day boundary.
function daysAgoNoon(k) {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() - k, 12).toISOString();
}

function dataDir(turns, config = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-fable-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1', ...config }));
  writeFileSync(join(dir, 'sessions', 's.ndjson'), turns.map(t => JSON.stringify({
    session_id: 's', speed_tier: 'standard', input_tokens: 1000, output_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0, ...t,
  })).join('\n') + '\n');
  return dir;
}

function run(args, dir) {
  const r = spawnSync(process.execPath, [BIN, 'fable', ...args], {
    env: { ...process.env, WTCLAUDE_NO_AUTOSYNC: '1', WTCLAUDE_DIR: dir, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude') }, encoding: 'utf8',
  });
  return { out: r.stdout + r.stderr, status: r.status };
}

test('QA-0928-73: the run-rate is spend over the days covered, not over the days with Fable use', () => {
  // Tracking began 20 days ago (an Opus turn); Fable spend on 2 days of a 7-day look-back.
  const dir = dataDir([
    { ts: daysAgoNoon(20), model: 'claude-opus-5-5', cost_usd: 1 },
    { ts: daysAgoNoon(1), model: 'claude-fable-5-1', cost_usd: 3.5 },
    { ts: daysAgoNoon(3), model: 'claude-fable-5-1', cost_usd: 3.5 },
  ], { plan: 'pro' });
  try {
    const json = JSON.parse(run(['--json'], dir).out);
    assert.equal(json.covered_days, 7);
    assert.equal(json.avg_fable_usd_per_day, 1, '$7 over 7 days, not $7 over 2');
    assert.equal(json.projected_monthly_fable_usd, 30);
    assert.match(run([], dir).out.replace(/\s+/g, ' '), /\$1\.00\/day · \$30\.00\/month[\s\S]*projected from the full 7-day window/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-78: a Vertex Fable turn is billed by Vertex, not the Pro plan', () => {
  const dir = dataDir([{ ts: daysAgoNoon(1), model: 'vertex_ai/claude-fable-5-1', cost_usd: 4.2 }], { plan: 'pro' });
  try {
    const { out } = run([], dir);
    assert.match(out, /\$4\.20\s+1 turn — billed by vertex_ai, not your Claude plan/);
    assert.doesNotMatch(out, /usage credits \(estimate\)|Billed in window/);
    const json = JSON.parse(run(['--json'], dir).out);
    assert.deepEqual(json.attribution_by_billing.partner_platform, { usd: 4.2, turns: 1, anchored_turns: 1, excluded_turns: 0, providers: { vertex_ai: 1 } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-78: an unknown Fable id borrows no Fable 5.1 rate', () => {
  const dir = dataDir([{ ts: daysAgoNoon(1), model: 'claude-fable-6', cost_usd: 2 }], { plan: 'pro' });
  try {
    const { out } = run([], dir);
    assert.doesNotMatch(out, /\$0\.25\/MTok cached/);
    assert.match(out, /fable-6 is not in this version's rate sheet/);
    const json = JSON.parse(run(['--json'], dir).out);
    assert.deepEqual(json.fable_models_in_window, { 'fable-6': 1 });
    assert.deepEqual(json.pricing_assumption_by_model, {});
    assert.doesNotMatch(json.pricing_assumption, /Fable 5\.1/);
    // With no Fable turns at all, the current default's rate is still the honest one to quote.
    const none = dataDir([{ ts: daysAgoNoon(1), model: 'claude-opus-5-5', cost_usd: 1 }], { plan: 'pro' });
    try { assert.match(run([], none).out, /\$0\.25\/MTok cached/); } finally { rmSync(none, { recursive: true, force: true }); }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-170: an unknown --plan is refused with the accepted list; plan_known means known', () => {
  const dir = dataDir([{ ts: daysAgoNoon(1), model: 'claude-fable-5-1', cost_usd: 1 }], { plan: 'max_5x' });
  try {
    const bad = run(['--plan', 'bogus'], dir);
    assert.equal(bad.status, 1);
    assert.match(bad.out, /Unknown plan "bogus"\. Try one of: pro, max_5x, max_20x, team_standard, team_premium, enterprise_standard, enterprise_premium/);
    assert.doesNotMatch(bad.out, /no plan is configured/);
    assert.equal(JSON.parse(run(['--plan', 'max5', '--json'], dir).out).plan_known, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const garbage = dataDir([{ ts: daysAgoNoon(1), model: 'claude-fable-5-1', cost_usd: 1 }], { plan: 'platinum' });
  try {
    assert.equal(JSON.parse(run(['--json'], garbage).out).plan_known, false);
    assert.match(run([], garbage).out.replace(/\s+/g, ' '), /your configured plan "platinum" is not one we recognise/);
  } finally {
    rmSync(garbage, { recursive: true, force: true });
  }
});

// ── RC 2026-09-28: QA-0928-54 in `fable` ─────────────────────────────────────
test('an unanchored partner Fable turn shows no dollar figure on the partner row and is named', () => {
  const tok = { input_tokens: 200_000, output_tokens: 50_000, cache_read_tokens: 100_000, cache_write_tokens: 100_000 };
  const dir = dataDir([{ ts: daysAgoNoon(0), model: 'bedrock/anthropic.claude-fable-5-1-v1:0', cost_usd: null, ...tok }], { plan: 'pro' });
  try {
    const { out } = run([], dir);
    assert.match(out, /—\s+1 turn — billed by bedrock, not your Claude plan/);
    assert.doesNotMatch(out, /\$6\.5\d/, 'no first-party guess for a partner turn');
    assert.match(out.replace(/\s+/g, ' '), /Not priced: 1 turn not priced, so left out of the cost: .* bedrock\/anthropic\.claude-fable-5-1-v1:0 \(1\)\./);
    const json = JSON.parse(run(['--json'], dir).out);
    assert.equal(json.attribution_by_billing.partner_platform.usd, 0);
    assert.equal(json.excluded_turns, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unanchored turn on an unknown Fable id is named, not described as token × rate math', () => {
  const dir = dataDir([
    { ts: daysAgoNoon(0), model: 'claude-fable-6', cost_usd: 0.5 },
    { ts: daysAgoNoon(0), model: 'claude-fable-6', cost_usd: 1 },
    { ts: daysAgoNoon(0), model: 'claude-fable-6', cost_usd: null },
  ], { plan: 'pro' });
  try {
    const { out } = run([], dir);
    const flat = out.replace(/\s+/g, ' ');
    assert.match(flat, /\$1\.50 3 turns — usage credits \(estimate\)/);
    assert.doesNotMatch(out, /token × rate math/);
    assert.match(flat, /Not priced: 1 turn not priced, so left out of the cost: .* claude-fable-6 \(1\)\./);
    const json = JSON.parse(run(['--json'], dir).out);
    assert.equal(json.estimated_turns, 0);
    assert.equal(json.excluded_turns, 1);
    assert.deepEqual(json.excluded_models, { 'claude-fable-6': 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a one-day look-back reads "last 1 day", not "last 1 days"', () => {
  const dir = dataDir([{ ts: daysAgoNoon(0), model: 'claude-fable-5-1', cost_usd: 1 }], { plan: 'pro' });
  try {
    const { out } = run(['--days', '1'], dir);
    assert.match(out, /Look-back:\s+last 1 day \(/);
    assert.doesNotMatch(out, /last 1 days/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
