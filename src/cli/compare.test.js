// Pinned before any Date use, and passed to every spawned CLI, so "today" and
// the local-date window mean the same thing on both sides of the spawn.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');

// Run the real `compare` command against an isolated WTCLAUDE_DIR fixture. HOME
// is the fixture dir too, so the session-log side reads the fixture's
// .claude/projects and never the real one (it used to read the machine's).
function runCompare(dir, extraArgs = []) {
  const res = spawnSync(process.execPath, [BIN, 'compare', ...extraArgs], {
    env: cleanEnv({ WTCLAUDE_DIR: dir, HOME: dir }),
    encoding: 'utf8',
  });
  return res.stdout + res.stderr;
}

// A YYYY-MM-DD label local-day-offset days in the past. Used to seed a turn that
// is inside the 7-day window but outside today's 1-day window — the exact shape
// of the reported bug (data this week, none today).
function daysAgoTs(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(12, 0, 0, 0); // local noon → unambiguously falls on the local day n days back
  return d.toISOString();
}

// Configured fixture: per-install salt present (setup is "complete"), the
// collector wired into this HOME's Claude Code settings, and one billing-grade
// turn dated `n` days ago, with NO turn today.
function configuredWithOldData(daysBack) {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-compare-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'),
    JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  // HOME is this dir, so the cold-start copy's "is capture wired?" check reads
  // this file — never the machine's real ~/.claude/settings.json.
  mkdirSync(join(dir, '.claude'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'settings.json'),
    JSON.stringify({ statusLine: { type: 'command', command: 'wtclaude-collector' } }));
  const turn = {
    ts: daysAgoTs(daysBack),
    model: 'opus-4-8', speed_tier: 'standard',
    input_tokens: 300000, output_tokens: 120000,
    cache_read_tokens: 400000, cache_write_tokens: 200000,
    cost_usd: 18.42, session_id: 'sess-old',
  };
  writeFileSync(join(dir, 'sessions', 'sess-old.ndjson'), JSON.stringify(turn) + '\n');
  // The same session's transcript (compare is like for like, QA-0928-17).
  mkdirSync(join(dir, '.claude', 'projects', 'p'), { recursive: true });
  writeFileSync(join(dir, '.claude', 'projects', 'p', 'sess-old.jsonl'), JSON.stringify({
    type: 'assistant', timestamp: turn.ts, requestId: 'r1', sessionId: 'sess-old',
    message: { id: 'm1', role: 'assistant', model: 'claude-opus-4-8', stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 120000, cache_read_input_tokens: 400000, cache_creation_input_tokens: 200000 } },
  }) + '\n');
  return dir;
}

// REGRESSION (PM-BUILD-bugfix-001): a set-up user with data this week but none
// *today* runs bare `compare` (defaults to the 1-day/today window). Before the
// fix this printed "Run: wtclaude setup" — telling a correctly-configured user
// the product is broken. It must NOT, and must show the honest set-up-aware copy.
test('compare: empty today-window does not tell a configured user to run setup', () => {
  const dir = configuredWithOldData(3);
  try {
    const out = runCompare(dir); // default --days 1 → today only → empty
    assert.doesNotMatch(out, /wtclaude setup/, 'must NOT prompt a configured user to re-run setup');
    assert.match(out, /set up and capturing/, 'should show the honest set-up-aware empty state');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The same data IS reachable through a wider window — proves the data is intact
// and only the today-window was empty (so the old "no data, run setup" framing
// was doubly wrong).
test('compare --days 7: surfaces the prior-day data the default window missed', () => {
  const dir = configuredWithOldData(3);
  try {
    const out = runCompare(dir, ['--days', '7']);
    assert.match(out, /Billing-grade/, 'the comparison table renders');
    assert.match(out, /18\.42/, 'the billing-grade cost from 3 days ago is included');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// REGRESSION (QA-0610-01): the hero comparison must render a NON-ZERO session-log
// estimate + a gap from real-shaped JSONL (usage nested under message.usage, with
// duplicate streaming partials). Before the fix this column was $0 / N/A. Fixtures
// both sides via HOME: ~/.claude/projects (JSONL) + ~/.wtclaude (billing-grade).
test('compare: renders a non-zero, deduped session-log estimate + gap from nested message.usage', () => {
  const home = mkdtempSync(join(tmpdir(), 'wtc-home-'));
  const ts = new Date(); ts.setHours(12, 0, 0, 0); // local noon → today's local window
  const tsIso = ts.toISOString();

  // Billing-grade (accurate) side: one big-input turn today.
  const wt = join(home, '.wtclaude');
  mkdirSync(join(wt, 'sessions'), { recursive: true });
  writeFileSync(join(wt, 'config.json'),
    JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  writeFileSync(join(wt, 'sessions', 's.ndjson'), JSON.stringify({
    ts: tsIso, model: 'opus-4-8', speed_tier: 'standard',
    input_tokens: 500000, output_tokens: 50000, cache_read_tokens: 10000, cache_write_tokens: 10000,
    cost_usd: 20, session_id: 's',
  }) + '\n');

  // Session-log (JSONL) side: m1 written twice (streaming dup) + m2 → deduped input 2000.
  const proj = join(home, '.claude', 'projects', 'p');
  mkdirSync(proj, { recursive: true });
  // Same session id as the collector's (like for like, QA-0928-17).
  const entry = (n) => JSON.stringify({
    type: 'assistant', timestamp: tsIso, requestId: 'r' + n, sessionId: 's',
    message: { id: 'm' + n, role: 'assistant', model: 'claude-opus-4-8',
      usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 500, cache_creation_input_tokens: 0 } },
  });
  writeFileSync(join(proj, 's.jsonl'), [entry(1), entry(1), entry(2)].join('\n') + '\n');

  const res = spawnSync(process.execPath, [BIN, 'compare'], {
    env: cleanEnv({ HOME: home, WTCLAUDE_DIR: wt }), encoding: 'utf8',
  });
  const out = res.stdout + res.stderr;
  try {
    assert.doesNotMatch(out, /\$0\.0000/, 'session-log estimate must NOT render as $0');
    assert.match(out, /\d+(\.\d+)?x/, 'a numeric gap (Nx) must render');
    assert.match(out, /\b2K\b/, 'deduped session-log input is 2K (m1 once + m2), not 3K');
    // Billing-grade $20 vs a few cents of log-side estimate, input gap 250x:
    // the one case the canon headline is for (QA-0928-18 gate).
    assert.match(out, /undercounts input tokens by 250x/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

// A genuinely-unconfigured install (no salt) SHOULD still be told to run setup —
// the fix must not swallow the real first-run guidance.
test('compare: an unconfigured install is still told to run setup', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-compare-fresh-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  try {
    const out = runCompare(dir);
    assert.match(out, /wtclaude setup/, 'a fresh install must still be guided to setup');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────────────────────────────────────────────────────────
// BUILD-018 (2026-09-28) — QA-0928-17 / -18 / -68 / -69 / -74 / -165 / -19.
// Every fixture is a throwaway HOME (transcripts under ~/.claude/projects) plus a
// WTCLAUDE_DIR; nothing touches the real ~/.claude or ~/.wtclaude.
// ───────────────────────────────────────────────────────────────────────────
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { priceTurn } from '../utils/cost.js';

// The spawned CLI must not inherit a CLAUDE_CONFIG_DIR (it relocates the
// transcript root) or run an upload.
function cleanEnv(extra) {
  const env = { ...process.env, TZ: 'America/New_York', WTCLAUDE_NO_AUTOSYNC: '1', ...extra };
  delete env.CLAUDE_CONFIG_DIR;
  return env;
}

function todayNoonIso() {
  const d = new Date(); d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

// A HOME with a configured ~/.wtclaude holding `turns` (session id → turn list)
// and ~/.claude/projects transcripts (relative path → lines). transcripts=null
// leaves ~/.claude absent altogether.
function fixtureHome({ turns = {}, transcripts = {} } = {}) {
  const home = mkdtempSync(join(tmpdir(), 'wtc-cmp-home-'));
  const wt = join(home, '.wtclaude');
  mkdirSync(join(wt, 'sessions'), { recursive: true });
  writeFileSync(join(wt, 'config.json'),
    JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  for (const [sid, list] of Object.entries(turns)) {
    writeFileSync(join(wt, 'sessions', `${sid}.ndjson`), list.map(t => JSON.stringify({ session_id: sid, ...t })).join('\n') + '\n');
  }
  if (transcripts) {
    for (const [rel, lines] of Object.entries(transcripts)) {
      const p = join(home, '.claude', 'projects', rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, lines.join('\n') + '\n');
    }
  }
  return { home, wt };
}

function run(home, wt, args = []) {
  const res = spawnSync(process.execPath, [BIN, 'compare', ...args], {
    env: cleanEnv({ HOME: home, WTCLAUDE_DIR: wt }), encoding: 'utf8',
  });
  return { out: res.stdout + res.stderr, status: res.status };
}

const TOK = { input_tokens: 2000, output_tokens: 3000, cache_read_tokens: 400000, cache_write_tokens: 20000 };

function logLine({ session, id, model = 'claude-opus-5-5', entrypoint = 'cli', tokens = TOK, out, ts = todayNoonIso(), sidechain = false }) {
  return JSON.stringify({
    type: 'assistant', isSidechain: sidechain, timestamp: ts, requestId: 'r-' + id, sessionId: session, entrypoint,
    message: { id: 'm-' + id, role: 'assistant', model, stop_reason: 'end_turn',
      usage: { input_tokens: tokens.input_tokens, output_tokens: out ?? tokens.output_tokens,
        cache_read_input_tokens: tokens.cache_read_tokens, cache_creation_input_tokens: tokens.cache_write_tokens } },
  });
}

test('QA-0928-68: identical tokens on a priced model give Cost 1.0x — the log side is priced at the model it records', () => {
  // The billing-grade anchor is set to what the rate sheet says those tokens
  // cost on Opus 5.5, so a correctly-priced log side must land on 1.0x. The old
  // Sonnet 4.6 pin priced the same tokens at $3/$15 with 0.1x reads instead.
  const anchor = priceTurn('claude-opus-5-5', 'standard', TOK).usd;
  const { home, wt } = fixtureHome({
    turns: { 'sess-a': [{ ts: todayNoonIso(), model: 'claude-opus-5-5', speed_tier: 'standard', ...TOK, cost_usd: anchor }] },
    transcripts: { 'p/sess-a.jsonl': [logLine({ session: 'sess-a', id: 1 })] },
  });
  try {
    const { out } = run(home, wt);
    const costRow = out.split('\n').find(l => /cost/i.test(l) && /\$/.test(l));
    assert.ok(costRow, out);
    assert.match(costRow, /1\.0x\s*$/, `cost row must be 1.0x: ${costRow}`);
    assert.match(out, /priced at the model its log records/i, 'the pricing basis is stated under the table');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('QA-0928-17: only sessions both sides recorded are compared, and what was left out is said', () => {
  const anchor = priceTurn('claude-opus-5-5', 'standard', TOK).usd;
  const big = { input_tokens: 900000, output_tokens: 900000, cache_read_tokens: 9e8, cache_write_tokens: 9e6 };
  const { home, wt } = fixtureHome({
    turns: {
      'sess-a': [{ ts: todayNoonIso(), model: 'claude-opus-5-5', speed_tier: 'standard', ...TOK, cost_usd: anchor }],
      'sess-nolog': [{ ts: todayNoonIso(), model: 'claude-opus-5-5', speed_tier: 'standard', ...TOK, cost_usd: 99 }],
    },
    transcripts: {
      'p/sess-a.jsonl': [logLine({ session: 'sess-a', id: 1 })],
      // A subagent of sess-a carries the parent's sessionId: it stays in (the
      // statusline cost includes subagent spend).
      'p/sess-a/subagents/agent-1.jsonl': [logLine({ session: 'sess-a', id: 2, sidechain: true })],
      // Work the statusline never saw.
      'q/desk.jsonl': [logLine({ session: 'desk', id: 3, entrypoint: 'claude-desktop', tokens: big })],
      'q/sdk.jsonl': [logLine({ session: 'sdk', id: 4, entrypoint: 'sdk-cli', tokens: big })],
      'q/term.jsonl': [logLine({ session: 'term', id: 5, entrypoint: 'cli', tokens: big })],
    },
  });
  try {
    const { out } = run(home, wt);
    const row = (label) => out.split('\n').find(l => l.trim().startsWith(label));
    // Log side = sess-a main + its subagent = 2 x TOK; the foreign sessions' 900K are out.
    assert.match(row('Input tokens'), /4K/, row('Input tokens'));
    assert.doesNotMatch(out, /1\.8M|2\.7M/, 'desktop / SDK / unrecorded tokens must not be in the log column');
    // Billing side = sess-a only; sess-nolog ($99) has no transcript in the window.
    assert.doesNotMatch(out, /\$99|\$1\d\d\./, 'a collector session with no transcript is left out of the billing column too');
    assert.match(out, /1 desktop-app session/);
    assert.match(out, /1 Agent SDK session/);
    assert.match(out, /statusline doesn.t run there/);
    assert.match(out, /1 terminal session the collector didn.t record/);
    assert.match(out, /1 collector session with no transcript/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('QA-0928-18: no "undercounts" headline when the session-log cost is HIGHER — a neutral comparison instead', () => {
  // Billing-grade $0.50 with a 10M-input turn (input gap 10000x, the old gate),
  // but the log side's cache reads price far above $0.50.
  const { home, wt } = fixtureHome({
    turns: { 'sess-a': [{ ts: todayNoonIso(), model: 'claude-opus-5-5', speed_tier: 'standard',
      input_tokens: 10_000_000, output_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.5 }] },
    transcripts: { 'p/sess-a.jsonl': [logLine({ session: 'sess-a', id: 1,
      tokens: { input_tokens: 1000, output_tokens: 1000, cache_read_tokens: 50_000_000, cache_write_tokens: 0 } })] },
  });
  try {
    const { out } = run(home, wt);
    assert.doesNotMatch(out, /undercounts/, 'the headline must not print when the log estimate is higher');
    assert.match(out, /session-log estimate \$10\.02/i, 'the two numbers are stated');
    assert.match(out, /\$0\.500/);
    // RC 2026-09-28: one ratio, one direction. The table's cost-row ratio and
    // the sentence's are the same number (billing ÷ log), and the column says so.
    assert.match(out, /Billing ÷ log/);
    const row = /^  Cost +\S+ +\S+ +(\S+x)$/m.exec(out);
    const sentence = /the statusline figure is (\S+x) the estimate/.exec(out);
    assert.ok(row && sentence, out);
    assert.equal(row[1], sentence[1]);
    assert.equal(row[1], '0.05x');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('QA-0928-18: no "undercounts" headline when part of the billing-grade column is itself an estimate', () => {
  // The log side is far lower and the input gap is ~500x — the headline's case —
  // but one collector turn has no cost_usd anchor, so the billing column is
  // partly the CLI's own list-rate estimate. The headline says the billing
  // figure "is read from the statusline", which would then be only partly true.
  const { home, wt } = fixtureHome({
    turns: { 'sess-a': [
      { ts: todayNoonIso(), model: 'claude-opus-5-5', speed_tier: 'standard',
        input_tokens: 500000, output_tokens: 50000, cache_read_tokens: 10000, cache_write_tokens: 10000, cost_usd: 20 },
      { ts: todayNoonIso(), model: 'claude-opus-5-5', speed_tier: 'standard',
        input_tokens: 1000, output_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0 },
    ] },
    transcripts: { 'p/sess-a.jsonl': [logLine({ session: 'sess-a', id: 1,
      tokens: { input_tokens: 1000, output_tokens: 200, cache_read_tokens: 500, cache_write_tokens: 0 } })] },
  });
  try {
    const { out } = run(home, wt);
    assert.doesNotMatch(out, /undercounts/, out);
    // The share is ">99%" once the ledger stream's costBasisBadge lands.
    assert.match(out, /For the same sessions: statusline \$20\.\d+ \([<>]?\d+% billing-grade, rest estimated\), session-log estimate/, out);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('QA-0928-69: no transcript directory says so, shows no $0 estimate, and saves no card', () => {
  const { home, wt } = fixtureHome({
    turns: { 'sess-a': [{ ts: todayNoonIso(), model: 'claude-opus-5-5', speed_tier: 'standard', ...TOK, cost_usd: 4.2 }] },
    transcripts: null,
  });
  try {
    const { out } = run(home, wt, ['--share']);
    assert.match(out, /No Claude Code transcripts found at ~\/\.claude\/projects — nothing to compare against/);
    assert.doesNotMatch(out, /\$0\.0000|N\/A/);
    assert.equal(existsSync(join(home, 'Desktop')), false, 'no card on the Desktop');
    assert.equal(existsSync(join(wt, 'comparisons')), false, 'no fallback card either');
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('QA-0928-69: transcripts that exist but hold nothing in the window are named separately', () => {
  const old = new Date(); old.setDate(old.getDate() - 10); old.setHours(12, 0, 0, 0);
  const { home, wt } = fixtureHome({
    turns: { 'sess-a': [{ ts: todayNoonIso(), model: 'claude-opus-5-5', speed_tier: 'standard', ...TOK, cost_usd: 4.2 }] },
    transcripts: { 'p/sess-a.jsonl': [logLine({ session: 'sess-a', id: 1, ts: old.toISOString() })] },
  });
  try {
    const { out } = run(home, wt, ['--share']);
    assert.match(out, /No Claude Code transcript has a response/);
    assert.doesNotMatch(out, /\$0\.0000/);
    assert.equal(existsSync(join(home, 'Desktop')), false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('QA-0928-74: --days must be a whole number from 1 to 365 — a usage error, never NaN dates or an inverted range', () => {
  const { home, wt } = fixtureHome({ turns: { 'sess-a': [{ ts: todayNoonIso(), model: 'claude-opus-5-5', ...TOK, cost_usd: 1 }] } });
  try {
    for (const bad of ['abc', '0', '-3', '2.5', '366', '']) {
      const { out, status } = run(home, wt, ['--days', bad]);
      assert.equal(status, 1, `--days ${JSON.stringify(bad)} must exit 1`);
      // The same wording as whatif / forecast / compare-models / fable
      // (src/utils/window.js on the analysis stream), plus the one maximum.
      assert.match(out, /--days must be a whole number of days, 1 or more, up to 365 \(got "/, out);
      assert.doesNotMatch(out, /NaN|No usage data/);
    }
    assert.equal(run(home, wt, ['--days', '365']).status, 0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('QA-0928-165: a file named Desktop gets a plain-language reason and the real fallback path', () => {
  const { home, wt } = fixtureHome({
    turns: { 'sess-a': [{ ts: todayNoonIso(), model: 'claude-opus-5-5', speed_tier: 'standard', ...TOK, cost_usd: 1 }] },
    transcripts: { 'p/sess-a.jsonl': [logLine({ session: 'sess-a', id: 1 })] },
  });
  writeFileSync(join(home, 'Desktop'), 'not a folder');
  try {
    const { out } = run(home, wt, ['--share']);
    assert.match(out, /a file named Desktop is in the way/);
    assert.doesNotMatch(out, /EEXIST|ENOTDIR/);
    assert.match(out, /Saved to ~\/\.wtclaude\/comparisons instead/, out);
    assert.ok(readdirSync(join(wt, 'comparisons')).includes('wtclaude-comparison.svg'));
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('QA-0928-19: a 3-day --share card carries no "/day" label on 3-day totals', () => {
  const day = (n) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(12, 0, 0, 0); return d.toISOString(); };
  const { home, wt } = fixtureHome({
    turns: { 'sess-a': [0, 1, 2].map(n => ({ ts: day(n), model: 'claude-opus-5-5', speed_tier: 'standard', ...TOK, cost_usd: 1 })) },
    transcripts: { 'p/sess-a.jsonl': [0, 1, 2].map(n => logLine({ session: 'sess-a', id: n, ts: day(n) })) },
  });
  try {
    run(home, wt, ['--days', '3', '--share']);
    const svg = readFileSync(join(home, 'Desktop', 'wtclaude-comparison.svg'), 'utf8');
    assert.doesNotMatch(svg, /\/day/);
    assert.match(svg, /over 3 days/i);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
