// Fixed zone first: the fixture is anchored to today's LOCAL midnight.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ───────────────────────────────────────────────────────────────────────────
// `wtclaude whatif`, end to end (BUILD-018). Spawned with a fixed TZ and a
// scratch WTCLAUDE_DIR.
//  • QA-0928-21 (decision 4): the model view shows the % difference and the
//    billing-grade total for the window — never "Current models: $X".
//  • QA-0928-22: the plan view projects from the days the data covers.
//  • QA-0928-80: "$X less/more than API list rates", plan limits not modelled,
//    Team plans per seat, a single partial day warned about.
//  • QA-0928-172: --plan <value> honoured, bare --model a usage error, help
//    lists fable and the rate sheet's plans.
// ───────────────────────────────────────────────────────────────────────────

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');

function run(args, dir) {
  const r = spawnSync(process.execPath, [BIN, 'whatif', ...args], {
    env: { ...process.env, WTCLAUDE_NO_AUTOSYNC: '1', TZ: 'America/New_York', WTCLAUDE_DIR: dir, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude') }, encoding: 'utf8',
  });
  return { out: r.stdout + r.stderr, status: r.status };
}

// Today's LOCAL midnight: never in the future, always today, whatever minute
// the suite runs in (a turn "a minute ago" is yesterday just after midnight).
const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

// One day of data: two anchored turns today ($30 billed in total).
function oneDay() {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-whatif-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  const ts = todayStart();
  writeFileSync(join(dir, 'sessions', 's.ndjson'), [
    { model: 'claude-opus-5-5', cost_usd: 20 }, { model: 'claude-sonnet-5', cost_usd: 10 },
  ].map(t => JSON.stringify({ ts, session_id: 's', speed_tier: 'standard', input_tokens: 1e6, output_tokens: 1e6, cache_read_tokens: 0, cache_write_tokens: 0, ...t })).join('\n') + '\n');
  return dir;
}

test('decision 4: the model view is a % difference beside the billed total, no re-priced dollars', () => {
  const dir = oneDay();
  try {
    const { out } = run(['--model', 'sonnet', '--days', '7'], dir);
    assert.match(out, /Billed in this window:\s+\$30\.00 \(billing-grade\)/);
    // Mix = Opus 5.5 $24 + Sonnet 5 $12 = $36; all-Sonnet $24 -> -33%.
    assert.match(out, /If all sonnet-5:\s+-33% vs your mix, re-priced/);
    assert.match(out, /Dollar figures withheld: re-pricing uses your recorded tokens/);
    assert.doesNotMatch(out, /Current models:|Difference:|\$36|\$24\.00/);
    assert.equal(out.split('billing-grade').length - 1, 1, 'only the billed total is billing-grade');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-22: one day of data projects the same month at --days 1 and --days 30, and says so', () => {
  const dir = oneDay();
  try {
    for (const days of ['1', '30']) {
      const { out } = run(['--plan', '--days', days], dir);
      assert.match(out, /Projected to a month:\s+\$900\.00\/month/, `--days ${days}:\n${out}`);
    }
    const month = run(['--plan', '--days', '30'], dir).out;
    assert.match(month, /projected from 1 day of data — tracking began inside the 30-day window/);
    // The user already asked for 30 days: no circular "try --days 30".
    assert.doesNotMatch(month, /try --days/);
    assert.match(month, /Tracking began today, so this projects one partial day/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-80: plans are compared with API list rates, limits unmodelled, Team per seat, partial day warned', () => {
  const dir = oneDay();
  try {
    const { out } = run([], dir); // the default: today only
    assert.match(out, /Pro\s+\$20\/mo\s+\$880\.00 less than API list rates/);
    assert.match(out, /Team Standard\s+\$25\/mo\/seat/);
    assert.match(out, /Team Premium\s+\$125\/mo\/seat/);
    assert.match(out.replace(/\s+/g, ' '), /Plan usage limits aren't modelled — a plan may not carry this workload/);
    assert.match(out, /Team prices are per seat/);
    assert.match(out, /Projected from today alone, a partial day/);
    assert.doesNotMatch(out, /saving you|costs .* more than API$/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-172: --plan <value> is honoured and an unknown plan is refused with the list', () => {
  const dir = oneDay();
  try {
    const pro = run(['--plan', 'pro'], dir).out;
    assert.match(pro, /Pro\s+\$20\/mo/);
    assert.doesNotMatch(pro, /Max 5x|Team Standard/);
    assert.match(run(['--plan', 'max5'], dir).out, /Max 5x\s+\$100\/mo/);
    const bad = run(['--plan', 'bogus'], dir);
    assert.equal(bad.status, 1);
    assert.match(bad.out, /Unknown plan "bogus"\. Try one of: pro, max_5x, max_20x, team_standard, team_premium/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('QA-0928-172: a bare --model is a usage error, and help lists fable and the plans', () => {
  const dir = oneDay();
  try {
    const bare = run(['--model'], dir);
    assert.equal(bare.status, 1);
    assert.doesNotMatch(bare.out, /"true"/);
    assert.match(bare.out, /argument missing/);
    const help = run(['--help'], dir).out.replace(/\s+/g, ' ');
    assert.match(help, /haiku, sonnet, opus, fable/);
    assert.match(help, /pro, max_5x, max_20x, team_standard, team_premium/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an empty window names the window', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-whatif-empty-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  try {
    assert.match(run(['--days', '30'], dir).out, /No usage data found in the last 30 days\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Ledger handoff: the plan view's "Billed in this window" silently left out the
// turns QA-0928-54 excludes (unanchored, on a model we can't price). It names
// them now, and the model view claims the headline counts an excluded turn
// only when Claude Code reported its cost.
function withExcluded() {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-whatif-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  const ts = todayStart();
  writeFileSync(join(dir, 'sessions', 's.ndjson'), [
    { model: 'claude-opus-5-5', cost_usd: 20 }, { model: 'claude-sonnet-5', cost_usd: 10 },
    { model: 'claude-opus-6' }, { model: 'vertex_ai/claude-sonnet-5' },
  ].map(t => JSON.stringify({ ts, session_id: 's', speed_tier: 'standard', input_tokens: 1e6, output_tokens: 1e6, cache_read_tokens: 0, cache_write_tokens: 0, ...t })).join('\n') + '\n');
  return dir;
}

test('the plan view names the turns its billed total leaves out', () => {
  const dir = withExcluded();
  try {
    const { out } = run(['--plan', '--days', '1'], dir);
    assert.match(out, /Billed in this window:\s+\$30\.00 \(billing-grade\)/);
    assert.match(out, /Not priced:\s+2 turns not priced, so left out of the cost/);
    assert.match(out, /claude-opus-6 \(1\)/);
    assert.match(out, /vertex_ai\/claude-sonnet-5 \(1\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the model view never says the headline counts an unanchored excluded turn', () => {
  const dir = withExcluded();
  try {
    const out = run(['--model', 'sonnet', '--days', '1'], dir).out.replace(/\s+/g, ' ');
    assert.match(out, /2 turns unpriced and excluded from both sides above/);
    assert.doesNotMatch(out, /headline cost is unaffected|still count/);
    assert.match(out, /Claude Code sent no cost for these turns, so your headline totals leave them out too/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// RC 2026-09-28: with every turn in the window unpriced (unanchored, on models
// we can't price) the plan view printed "Billed $0.00", "$0.00/month" and told
// the user every plan costs more than API list rates. It now says there is
// nothing to compare, as the model view does.
function allUnpriced() {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-whatif-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  const ts = todayStart();
  writeFileSync(join(dir, 'sessions', 's.ndjson'), [
    { model: 'vertex_ai/claude-opus-5-5@20260922', cost_usd: null }, { model: 'claude-opus-7', cost_usd: null },
  ].map(t => JSON.stringify({ ts, session_id: 's', speed_tier: 'standard', input_tokens: 1e6, output_tokens: 1e5, cache_read_tokens: 0, cache_write_tokens: 0, ...t })).join('\n') + '\n');
  return dir;
}

test('the plan view with every turn unpriced shows no $0 bill, projection or plan verdicts', () => {
  const dir = allUnpriced();
  try {
    for (const args of [[], ['--plan'], ['--plan', 'pro']]) {
      const out = run(args, dir).out;
      const flat = out.replace(/\s+/g, ' ');
      assert.doesNotMatch(out, /more than API list rates|less than API list rates/, args.join(' '));
      assert.doesNotMatch(out, /\$0\.00\/month|Billed in this window:\s+\$0\.00/, args.join(' '));
      assert.match(out, /Billed in this window:\s+— \(not priced\)/);
      assert.match(flat, /All 2 turns in this window were excluded, so there is nothing to compare yet — this is not the same as having no usage/);
      assert.match(flat, /Not priced: 2 turns not priced/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the plan view says its comparison leaves the unpriced turns out', () => {
  const dir = withExcluded();
  try {
    const out = run(['--plan', '--days', '1'], dir).out.replace(/\s+/g, ' ');
    assert.match(out, /The projection and plan comparison below leave those 2 turns out\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// RC 2026-09-28: one exit code per class of input error. An unknown --plan
// already exited 1; an unknown or unpriceable --model exited 0.
test('an unknown or unpriceable --model exits 1, like an unknown --plan', () => {
  const dir = oneDay();
  try {
    for (const m of ['gpt', 'claude-opus-9-20270101']) {
      const r = run(['--model', m], dir);
      assert.equal(r.status, 1, `--model ${m}`);
      assert.match(r.out, /no figure shown/);
    }
    assert.equal(run(['--plan', 'foo'], dir).status, 1);
    assert.equal(run(['--model', 'sonnet'], dir).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
