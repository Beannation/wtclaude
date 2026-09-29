import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ───────────────────────────────────────────────────────────────────────────
// `forecast`, `credits` and `readiness`, end to end (BUILD-018), fixed TZ and
// scratch data.
//  • QA-0928-73: run-rates divide by the days the look-back covers.
//  • QA-0928-75: no June-15 / June-14 countdown framing for a paused split —
//    not in help, not as a negative days_until_* in JSON.
//  • QA-0928-76: no "enable sync to populate" for a balance nothing fetches.
//  • QA-0928-77: inferred fast-mode spend is labelled inferred, never billing-grade.
//  • QA-0928-171: forecast's billing-grade sentence only when there is spend.
// ───────────────────────────────────────────────────────────────────────────

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');
process.env.TZ = 'America/New_York';

function daysAgoNoon(k) {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate() - k, 12).toISOString();
}
// Today's LOCAL midnight: never in the future, always today and this month,
// whatever minute the suite runs in ("a minute ago" is yesterday — or last
// month — just after midnight).
const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

function dataDir(turns) {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-pools-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1', plan: 'pro', sync_enabled: true }));
  writeFileSync(join(dir, 'sessions', 's.ndjson'), turns.map(t => JSON.stringify({
    session_id: 's', model: 'claude-opus-5-5', input_tokens: 1000, output_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0, ...t,
  })).join('\n') + '\n');
  return dir;
}

function run(args, dir) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    env: { ...process.env, WTCLAUDE_NO_AUTOSYNC: '1', WTCLAUDE_DIR: dir, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude') }, encoding: 'utf8',
  });
  return { out: r.stdout + r.stderr, status: r.status };
}

const agentTurn = (ts, cost_usd) => ({ ts, cost_usd, usage_pool: 'agent_sdk', billing_basis: 'agent_sdk_credits' });

test('QA-0928-73 / 171: forecast averages over the look-back and labels spend vs projection once', () => {
  // Tracking began 20 days ago; agent spend on 2 days of the 7-day look-back.
  const dir = dataDir([
    { ts: daysAgoNoon(20), cost_usd: 1, speed_tier: 'standard' },
    agentTurn(daysAgoNoon(1), 2.1), agentTurn(daysAgoNoon(4), 2.1),
  ]);
  try {
    const json = JSON.parse(run(['forecast', '--json'], dir).out);
    assert.equal(json.covered_days, 7);
    assert.ok(Math.abs(json.avg_agent_usd_per_day - 4.2 / 7) < 1e-6, `avg ${json.avg_agent_usd_per_day}`);
    assert.ok(Math.abs(json.projected_monthly_agent_usd - 4.2 / 7 * 30) < 1e-6);
    const { out } = run(['forecast'], dir);
    assert.match(out, /Avg agent\/day:\s+\$0\.600/);
    assert.match(out, /Recorded agent-pool spend is billing-grade; the per-day average and\s+monthly projection are estimates\./);
    assert.doesNotMatch(out, /The spend below is real and billing-grade/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const idle = dataDir([{ ts: todayStart(), cost_usd: 1, speed_tier: 'standard' }]);
  try {
    const { out } = run(['forecast'], idle);
    assert.match(out, /No turns in the look-back window were recorded against the Agent-SDK/);
    assert.doesNotMatch(out, /billing-grade/, 'nothing follows, so nothing is labelled');
  } finally {
    rmSync(idle, { recursive: true, force: true });
  }
});

test('QA-0928-76 / 77: credits labels inferred fast mode and never says "enable sync"', () => {
  const dir = dataDir(Array.from({ length: 3 }, () => ({
    ts: todayStart(), cost_usd: 1.5, speed_tier: 'fast', speed_tier_source: 'inferred', billing_basis: 'fast_mode_usage_credits',
  })));
  try {
    const { out } = run(['credits'], dir);
    assert.match(out, /Spent this month: ~\$4\.50 · inferred \(3 fast turns\)/);
    assert.doesNotMatch(out, /\$4\.50 \(billing-grade/);
    assert.doesNotMatch(out, /enable sync/i);
    assert.match(out.replace(/\s+/g, ' '), /can't read your usage-credit balance yet — check it in Claude's usage settings/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-75: no countdown to the paused split — help text and JSON', () => {
  const dir = dataDir([{ ts: todayStart(), cost_usd: 1, speed_tier: 'standard' }]);
  try {
    const root = run(['--help'], dir).out;
    for (const cmd of ['forecast', 'credits', 'readiness']) {
      const line = root.split('\n').find(l => l.trim().startsWith(cmd)) || '';
      assert.doesNotMatch(line, /countdown|june-?1[45]|progressive disclosure/i, `root help: ${line}`);
      assert.match(line, /paused/i, `${cmd} help says the split is paused`);
      assert.doesNotMatch(run([cmd, '--help'], dir).out, /countdown|june-?1[45]/i, `${cmd} --help`);
      // QA-0928-118 (CLI half): no help text presents the paused split's
      // allowance as live.
      assert.doesNotMatch(run([cmd, '--help'], dir).out, /included credits|progressive disclosure|one-time/i, `${cmd} --help`);
    }
    assert.doesNotMatch(run(['readiness'], dir).out, /June-14|countdown/i);
    for (const cmd of ['credits', 'readiness']) {
      const json = JSON.parse(run([cmd, '--json'], dir).out);
      assert.equal(json.days_until_activation, null, `${cmd}: no countdown to a paused event`);
      assert.equal(json.split_status, 'paused');
      assert.equal(json.announced_activation_date, '2026-06-15');
      assert.equal(json.activation_date, undefined);
      for (const [k, v] of Object.entries(json)) {
        if (k.startsWith('days_until')) assert.ok(!(v < 0), `${cmd}: ${k} is negative`);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-73: readiness projects from a bounded look-back, not all history since 1970', () => {
  // Agent spend only 60+ days ago: recorded, but no monthly projection from it.
  const dir = dataDir([agentTurn(daysAgoNoon(70), 50), { ts: todayStart(), cost_usd: 1, speed_tier: 'standard' }]);
  try {
    const json = JSON.parse(run(['readiness', '--json'], dir).out);
    assert.equal(json.agent_pool.spent_total_usd, 50);
    assert.equal(json.agent_pool.projected_monthly_usd, null);
    assert.equal(json.agent_pool.lookback_days, 30);
    assert.match(run(['readiness'], dir).out, /No agent-pool spend in the last 30 days — no projection\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── RC 2026-09-28: QA-0928-54 reaches credits / forecast / readiness ─────────
// An unanchored turn on a family-fallback or partner-platform model is left
// out of every pool's dollars and named under "Not priced" — the rule `today`
// follows — and only anchored spend is called billing-grade. The pools can
// never report more billing-grade spend than `today` shows for the same turns.
const TOK = { input_tokens: 200_000, output_tokens: 50_000, cache_read_tokens: 100_000, cache_write_tokens: 100_000 };
function fiveTurnDir() {
  const ts = todayStart();
  return dataDir([
    { ts, model: 'claude-sonnet-5', usage_pool: 'agent_sdk', billing_basis: 'agent_sdk_credits', cost_usd: 1, ...TOK },
    { ts, model: 'claude-opus-6', usage_pool: 'agent_sdk', billing_basis: 'agent_sdk_credits', cost_usd: null, ...TOK },
    { ts, model: 'us.anthropic.claude-opus-5-5-v1:0', usage_pool: 'agent_sdk', billing_basis: 'agent_sdk_credits', cost_usd: null, ...TOK },
    { ts, model: 'claude-opus-6', speed_tier: 'fast', speed_tier_source: 'payload', billing_basis: 'fast_mode_usage_credits', cost_usd: null, ...TOK },
    { ts, model: 'claude-opus-5-5', speed_tier: 'fast', speed_tier_source: 'payload', billing_basis: 'fast_mode_usage_credits', cost_usd: 2, ...TOK },
  ]);
}
const flat = (s) => s.replace(/\s+/g, ' ');

test('credits: unpriceable unanchored agent and fast turns are named, not priced as billing-grade', () => {
  const dir = fiveTurnDir();
  try {
    const out = flat(run(['credits'], dir).out);
    assert.match(out, /Recorded so far this month: \$1\.00 \(billing-grade\)\./);
    assert.match(out, /Spent this month: \$2\.00 \(billing-grade, 1 fast turn\)\./);
    assert.match(out, /Not priced: 2 turns not priced, so left out of the cost: .* claude-opus-6 \(1\), us\.anthropic\.claude-opus-5-5-v1:0 \(1\)\./);
    assert.match(out, /Not priced: 1 turn not priced, so left out of the cost: .* claude-opus-6 \(1\)\./);
    const json = JSON.parse(run(['credits', '--json'], dir).out);
    assert.equal(json.month_to_date.agent_sdk_usd, 1);
    assert.equal(json.month_to_date.fast_mode_usd, 2);
    assert.equal(json.month_to_date.agent_sdk_cost_basis.excluded_turns, 2);
    assert.equal(json.month_to_date.fast_mode_cost_basis.excluded_turns, 1);
    // Never more than `today` for the same window.
    const today = JSON.parse(run(['today', '--json'], dir).out);
    assert.ok(json.month_to_date.agent_sdk_usd + json.month_to_date.fast_mode_usd <= today.cost_usd + 1e-9,
      `credits ${json.month_to_date.agent_sdk_usd + json.month_to_date.fast_mode_usd} > today ${today.cost_usd}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('forecast and readiness project anchored agent spend only and name the rest', () => {
  const dir = fiveTurnDir();
  try {
    const f = flat(run(['forecast'], dir).out);
    assert.match(f, /Recorded spend: \$1\.00/);
    assert.match(f, /Projected\/month: \$30\.00/);
    assert.match(f, /Recorded agent-pool spend is billing-grade/);
    assert.match(f, /Not priced: 2 turns not priced/);
    const fj = JSON.parse(run(['forecast', '--json'], dir).out);
    assert.equal(fj.projected_monthly_agent_usd, 30);
    assert.equal(fj.agent_cost_basis.excluded_turns, 2);
    const r = flat(run(['readiness'], dir).out);
    assert.match(r, /Recorded agent spend: \$1\.00 \(billing-grade\)/);
    assert.match(r, /Projected\/month: \$30\.00/);
    assert.match(r, /Fast-mode spend: \$2\.00 \(billing-grade\)/);
    assert.match(r, /Not priced: 2 turns not priced/);
    const rj = JSON.parse(run(['readiness', '--json'], dir).out);
    assert.equal(rj.agent_pool.spent_total_usd, 1);
    assert.equal(rj.agent_pool.cost_basis.excluded_turns, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unanchored agent turn on a fallback model: $0 recorded, named, nothing projected from it', () => {
  // The diff-audit fixture: one agent turn on an unknown Opus id with no cost,
  // and one anchored first-party turn outside the agent pool.
  const ts = todayStart();
  const dir = dataDir([
    { ts, model: 'claude-opus-9-0', usage_pool: 'agent_sdk', billing_basis: 'agent_sdk_credits', cost_usd: null, input_tokens: 1_000_000, output_tokens: 100_000 },
    { ts, model: 'claude-opus-5-5', cost_usd: 1, speed_tier: 'standard' },
  ]);
  try {
    const c = flat(run(['credits'], dir).out);
    assert.doesNotMatch(c, /\$6\.00/);
    assert.match(c, /Recorded so far this month: — \(not priced\)\./);
    assert.match(c, /Not priced: 1 turn not priced, so left out of the cost: .* claude-opus-9-0 \(1\)\./);
    const f = flat(run(['forecast'], dir).out);
    assert.doesNotMatch(f, /\$6\.00|\$180\.00|billing-grade/);
    assert.match(f, /1 agent-pool turn in the look-back could not be priced, so there is nothing to forecast/);
    assert.match(f, /Not priced: 1 turn not priced/);
    const r = flat(run(['readiness'], dir).out);
    assert.doesNotMatch(r, /\$6\.00|\$180\.00/);
    assert.match(r, /Recorded agent spend: — \(not priced\)/);
    assert.equal(JSON.parse(run(['forecast', '--json'], dir).out).projected_monthly_agent_usd, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an unanchored agent turn on a priceable model is labelled an estimate everywhere', () => {
  const ts = todayStart();
  const dir = dataDir([
    { ts, model: 'claude-sonnet-5', usage_pool: 'agent_sdk', billing_basis: 'agent_sdk_credits', cost_usd: 1, ...TOK },
    { ts, model: 'claude-opus-5-5', usage_pool: 'agent_sdk', billing_basis: 'agent_sdk_credits', cost_usd: null, ...TOK },
  ]);
  try {
    const c = flat(run(['credits'], dir).out);
    assert.match(c, /Recorded so far this month: ~\$3\.62 \(28% billing-grade, rest estimated\)\./);
    const f = flat(run(['forecast'], dir).out);
    assert.match(f, /Recorded agent-pool spend is 28% billing-grade, rest estimated at list rates/);
    assert.match(f, /Recorded spend: ~\$3\.62/);
    assert.match(flat(run(['readiness'], dir).out), /Recorded agent spend: ~\$3\.62 \(28% billing-grade, rest estimated\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('forecast --days 1 reads "last 1 day"', () => {
  const dir = dataDir([agentTurn(todayStart(), 1)]);
  try {
    const out = run(['forecast', '--days', '1'], dir).out;
    assert.match(out, /Look-back:\s+last 1 day \(/);
    assert.doesNotMatch(out, /last 1 days/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
