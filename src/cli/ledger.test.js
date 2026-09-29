import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// End-to-end checks for the ledger commands (today/week/month/session/blocks/
// report/tasks/project/devices/watch/limit) through the real CLI. Every run is
// pinned to America/New_York and to explicit dates, so nothing here depends on
// the day the suite runs. Synthetic ids only; autosync is off.

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');
const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const LOCAL_DEV = '11111111-1111-4111-8111-111111111111';
const OTHER_DEV = '22222222-2222-4222-8222-222222222222';

function fixture(sessions, cfg = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-ledger-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: '00000000-0000-4000-8000-000000000000',
    device_id: LOCAL_DEV, device_label: 'laptop', sync_enabled: false, ...cfg,
  }));
  for (const [id, turns] of Object.entries(sessions)) {
    writeFileSync(join(dir, 'sessions', `${id}.ndjson`), turns.map(t => JSON.stringify({ session_id: id, ...t })).join('\n') + '\n');
  }
  return dir;
}

// Hermetic: HOME and CLAUDE_CONFIG_DIR are the fixture's own, so no run reads
// the developer's real ~/.claude (the cold-start copy checks its settings.json)
// or ~/.wtclaude, and the result is the same on any machine or CI.
function run(args, dir, env = {}) {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env, TZ: 'America/New_York', WTCLAUDE_DIR: dir, WTCLAUDE_NO_AUTOSYNC: '1', WTCLAUDE_AUTOSYNC_CHILD: '1', COLUMNS: '80',
      HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude'), ...env,
    },
  });
  return { code: r.status, out: r.stdout, err: r.stderr, all: r.stdout + r.stderr };
}

const tok = { input_tokens: 1000, output_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0 };
const t = (ts, extra = {}) => ({ ts, model: 'claude-opus-5-5', speed_tier: 'standard', ...tok, device_id: LOCAL_DEV, ...extra });

// ── QA-0928-14: a truncated line never crashes a read command ────────────────

test('every read command exits 0 with a truncated middle line and a truncated last line', () => {
  const dir = fixture({ 'aaaa0001-0000-4000-8000-000000000001': [t('2026-09-10T13:00:00.000Z', { turn: 1, cost_usd: 1 })] });
  appendFileSync(join(dir, 'sessions', 'aaaa0001-0000-4000-8000-000000000001.ndjson'),
    '{"ts":"2026-09-10T15:00:00.000Z","input_tok\n' + JSON.stringify(t('2026-09-10T14:00:00.000Z', { turn: 2, cost_usd: 2 })) + '\n{"ts":"2026-09-10T15:01:00.000Z","inp');
  const cmds = [
    ['today', '--since', '2026-09-10', '--until', '2026-09-10'], ['week', '--until', '2026-09-10'], ['month', '--until', '2026-09-10'],
    ['session'], ['session', 'aaaa0001'], ['blocks'], ['devices'], ['project'], ['report', '--cost-center', '--month', '2026-09'],
    ['tasks', '--until', '2026-09-10'], ['watch', '--once'], ['limit'], ['debrief'],
  ];
  for (const args of cmds) {
    const r = run(args, dir);
    assert.equal(r.code, 0, `${args.join(' ')} exited ${r.code}:\n${r.all}`);
    assert.doesNotMatch(r.all, /SyntaxError|    at /, `${args.join(' ')} printed a stack trace`);
  }
  // Same totals minus the bad line, and the skip is surfaced.
  const j = JSON.parse(run(['today', '--since', '2026-09-10', '--until', '2026-09-10', '--json'], dir).out);
  assert.equal(j.turns, 2);
  assert.equal(j.cost_usd, 3);
  assert.equal(j.skipped_lines, 1);
  assert.match(run(['today', '--since', '2026-09-10', '--until', '2026-09-10'], dir).out, /skipped 1 unreadable line in 1 session file \(aaaa0001\)/);
  assert.match(run(['session'], dir).out, /skipped 1 unreadable line/);
  assert.equal(JSON.parse(run(['session', '--json'], dir).out).skipped_lines, 1);
});

// RC 2026-09-28: the CHANGELOG says the damaged line is "skipped and named",
// but only some commands named it. Every read command now does — once, on
// stderr when the command did not already print it — and export records it.
test('every read command names a skipped damaged line, exactly once', () => {
  const dir = fixture({ 'aaaa0002-0000-4000-8000-000000000001': [t('2026-09-10T13:00:00.000Z', { turn: 1, cost_usd: 1 })] });
  appendFileSync(join(dir, 'sessions', 'aaaa0002-0000-4000-8000-000000000001.ndjson'),
    '{"ts":"2026-09-10T15:00:00.000Z","input_tok\n' + JSON.stringify(t('2026-09-10T14:00:00.000Z', { turn: 2, cost_usd: 2 })) + '\n');
  const cmds = [
    ['today', '--since', '2026-09-10', '--until', '2026-09-10'], ['today', '--since', '2026-09-10', '--until', '2026-09-10', '--json'],
    ['session'], ['blocks'], ['devices'], ['project'], ['tasks', '--until', '2026-09-10'], ['limit'], ['debrief'],
    ['whatif', '--days', '30'], ['compare-models', '--days', '30'], ['badges'], ['leaderboard'], ['export'],
    ['credits'], ['forecast'], ['readiness'], ['fable'], ['quality'],
  ];
  for (const args of cmds) {
    const r = run(args, dir, { WTCLAUDE_COWORK_AUDIT: join(dir, 'none.jsonl') });
    const hits = r.all.match(/skipped 1 unreadable line in 1 session file \(aaaa0002\)/g) || [];
    assert.equal(hits.length, 1, `${args.join(' ')} named the skipped line ${hits.length} times:\n${r.all}`);
  }
  const bundle = JSON.parse(run(['export'], dir).out);
  assert.equal(bundle.skipped_lines, 1);
  assert.match(bundle.note, /1 damaged line in 1 session file could not be read and is left out/);
});

// ── QA-0928-54: not-ours models are excluded from $ and named ────────────────

const BIG = { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_tokens: 0, cache_write_tokens: 0 };
function excludeFixture() {
  return fixture({
    'aaaaaaaa-0000-4000-8000-000000000001': [t('2026-09-10T13:00:00.000Z', { turn: 1, ...BIG, cost_usd: 59.02 })],
    'bbbbbbbb-0000-4000-8000-000000000001': [t('2026-09-10T13:10:00.000Z', { turn: 1, ...BIG, model: 'claude-fable-5-1' })],
    'bbbbbbbb-0000-4000-8000-000000000002': [t('2026-09-10T13:11:00.000Z', { turn: 1, ...BIG, model: 'claude-opus-6' })],
    'bbbbbbbb-0000-4000-8000-000000000003': [t('2026-09-10T13:12:00.000Z', { turn: 1, ...BIG, model: 'vertex_ai/claude-sonnet-5' })],
    'bbbbbbbb-0000-4000-8000-000000000004': [t('2026-09-10T13:13:00.000Z', { turn: 1, ...BIG, model: 'claude-zeta-9' })],
  });
}
const DAY = ['--since', '2026-09-10', '--until', '2026-09-10'];

test('today: unanchored turns on fallback/partner/unknown models are excluded from the total and named', () => {
  const dir = excludeFixture();
  const j = JSON.parse(run(['today', ...DAY, '--json'], dir).out);
  assert.equal(j.cost_usd, 74.02, '59.02 anchored + 15.00 Fable 5.1 estimate, nothing else');
  assert.equal(j.cost_basis.excluded_turns, 3);
  assert.deepEqual(j.cost_basis.excluded_models, { 'claude-opus-6': 1, 'vertex_ai/claude-sonnet-5': 1, 'claude-zeta-9': 1 });
  const txt = run(['today', ...DAY], dir).out;
  assert.match(txt, /\$74\.02/);
  assert.match(txt, /3 turns not priced/);
  assert.match(txt, /claude-opus-6/);
  assert.match(txt, /vertex_ai\/claude-sonnet-5/);
  assert.match(txt, /claude-zeta-9/);
  assert.doesNotMatch(txt, /\$89\.52|\$83\.02/);
});

test('session: an excluded session shows no dollar figure and says why', () => {
  const dir = excludeFixture();
  const list = run(['session'], dir).out;
  const zeta = list.split('\n').filter(l => /bbbbbbbb/.test(l));
  assert.equal(zeta.filter(l => /not priced/.test(l)).length, 3, list);
  assert.doesNotMatch(list, /~\$0\.0000/);
  const detail = run(['session', 'bbbbbbbb-0000-4000-8000-000000000004'], dir).out;
  assert.match(detail, /not priced/);
  assert.match(detail, /claude-zeta-9/);
});

// ── QA-0928-56 / QA-0928-57 / QA-0928-159: ranges and date validation ────────

function spreadFixture() {
  // One anchored turn per local day, 2026-08-01 .. 2026-09-30, each at 22:30 EDT
  // (02:30Z the next UTC day) plus one at 09:00 EDT — the evening turns are the
  // ones UTC bucketing would move to the wrong day (QA-BUG-10).
  const turns = [];
  let n = 1;
  for (let d = Date.UTC(2026, 7, 1); d <= Date.UTC(2026, 8, 30); d += 86_400_000) {
    const day = new Date(d).toISOString().slice(0, 10);
    turns.push(t(`${day}T13:00:00.000Z`, { turn: n++, cost_usd: 1 }));                            // 09:00 EDT
    turns.push(t(new Date(d + 26.5 * 3_600_000).toISOString(), { turn: n++, cost_usd: 0.25 }));   // 22:30 EDT
  }
  return fixture({ 'cccc0001-0000-4000-8000-000000000001': turns });
}

test('--until alone ends each command\'s own window on that day', () => {
  const dir = spreadFixture();
  const range = (args) => JSON.parse(run([...args, '--json'], dir).out).range;
  assert.deepEqual([range(['today', '--until', '2026-09-01']).since, range(['today', '--until', '2026-09-01']).until], ['2026-09-01', '2026-09-01']);
  assert.equal(range(['week', '--until', '2026-09-01']).since, '2026-08-26');
  assert.equal(range(['month', '--until', '2026-09-01']).since, '2026-08-03');
  const tasks = run(['tasks', '--until', '2026-09-01', '--json'], dir);
  assert.equal(JSON.parse(tasks.out).range.since, '2026-08-03');
  assert.equal(JSON.parse(run(['week', '--until', '2026-09-01', '--json'], dir).out).turns, 14);
});

test('today + yesterday = the 2-day window, with 21:00–23:59 EDT turns on their local day; today ⊆ week ⊆ month', () => {
  const dir = spreadFixture();
  const cost = (since, until) => JSON.parse(run(['today', '--since', since, '--until', until, '--json'], dir).out).cost_usd;
  const d1 = cost('2026-09-14', '2026-09-14');
  const d2 = cost('2026-09-15', '2026-09-15');
  assert.equal(d1, 1.25, 'each local day holds its morning and its 22:30 EDT turn');
  assert.equal(d1 + d2, cost('2026-09-14', '2026-09-15'));
  const j = (cmd) => JSON.parse(run([cmd, '--until', '2026-09-15', '--json'], dir).out).cost_usd;
  assert.ok(j('today') <= j('week') && j('week') <= j('month'));
  assert.equal(j('week'), 7 * 1.25);
  assert.equal(j('month'), 30 * 1.25);
});

test('project and devices reject malformed dates like the summary commands do, and handle reversed bounds', () => {
  const dir = spreadFixture();
  for (const cmd of [['devices'], ['devices', '--json'], ['project', '--json'], ['project']]) {
    const bad = run([...cmd, '--since', '2026-9-1'], dir);
    assert.equal(bad.code, 1, `${cmd.join(' ')}: ${bad.all}`);
    assert.match(bad.err, /--since must be YYYY-MM-DD \(got "2026-9-1"\)/);
  }
  const rev = JSON.parse(run(['devices', '--since', '2026-09-28', '--until', '2026-09-01', '--json'], dir).out);
  assert.equal(rev.combined.turns, 56, 'reversed bounds are swapped, never silently empty');
  const bad = run(['today', '--since', '2026-13-45'], dir);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /--since must be a real date/);
});

// ── QA-0928-59: an empty range is not a cold start ───────────────────────────

test('an existing user with an empty range gets a plain "no usage between" line, not the first-run copy', () => {
  const dir = spreadFixture();
  const cases = [
    [['week', '--since', '2026-01-01', '--until', '2026-01-07'], /No usage recorded between 2026-01-01 and 2026-01-07\./],
    [['today', '--since', '2026-01-03', '--until', '2026-01-03'], /No usage recorded on 2026-01-03\./],
    [['project', '--since', '2026-01-01', '--until', '2026-01-07'], /No projects recorded between 2026-01-01 and 2026-01-07\./],
    [['devices', '--since', '2026-01-01', '--until', '2026-01-07'], /No usage recorded between 2026-01-01 and 2026-01-07\./],
    [['today', '--since', '2026-01-03', '--until', '2026-01-03', '--group-by', 'branch'], /No usage recorded on 2026-01-03\./],
  ];
  for (const [args, want] of cases) {
    const r = run(args, dir);
    assert.equal(r.code, 0);
    assert.match(r.out, want, args.join(' '));
    assert.doesNotMatch(r.out, /first turn will show up here|recorded yet/, args.join(' '));
  }
});

// The fixture's own Claude Code settings, with our collector wired as setup
// writes it (an absolute path to this checkout's collector, "type": "command").
function wireCollector(dir) {
  mkdirSync(join(dir, '.claude'), { recursive: true });
  const collector = join(dirname(BIN), '..', 'src', 'collector', 'index.js');
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify({ statusLine: { type: 'command', command: collector } }));
}

test('a true cold start still gets the first-run guidance', () => {
  const setUp = fixture({});
  wireCollector(setUp);
  assert.match(run(['week', '--since', '2026-01-01', '--until', '2026-01-07'], setUp).out, /first turn will show up here/);
  const fresh = fixture({}, { edit_hash_salt: undefined });
  assert.match(run(['today', '--since', '2026-01-03', '--until', '2026-01-03'], fresh).out, /wtclaude setup/);
});

test('set up but not wired: the cold-start copy says nothing is being captured', () => {
  const dir = fixture({});   // no settings.json in this fixture's CLAUDE_CONFIG_DIR
  const out = run(['week', '--since', '2026-01-01', '--until', '2026-01-07'], dir).out;
  assert.match(out, /the collector is not wired into Claude Code yet/);
  assert.match(out, /it has no statusLine entry/);
  assert.doesNotMatch(out, /first turn will show up here/);
});

// QA-0928-07: a config.json that doesn't parse is not a fresh install. With no
// data, the read commands used to say "Looks like a fresh install. Run setup
// first" — and running setup is exactly what must not happen to a file holding
// the install's ids. They now say the file is unreadable and what to do.
test('a config.json that does not parse is named as unreadable, never "fresh install, run setup"', () => {
  const dir = fixture({});
  const broken = '{\n  "edit_hash_salt": "deadbeefdeadbeefdeadbeefdeadbeef",\n  "plan": "max5",\n}\n';
  writeFileSync(join(dir, 'config.json'), broken);
  for (const args of [['today', '--since', '2026-01-03', '--until', '2026-01-03'], ['week'], ['session'], ['quality'], ['compare']]) {
    const r = run(args, dir, { HOME: dir, CLAUDE_CONFIG_DIR: join(dir, 'no-claude') });
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.all}`);
    assert.doesNotMatch(r.all, /fresh install|Run setup first|Run: wtclaude setup/, args.join(' '));
    assert.match(r.all, /config\.json is not valid JSON \(line 4, column 1\)/, `${args.join(' ')}:\n${r.all}`);
    assert.match(r.all, /fix the file \(or restore a backup\)/);
  }
  assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), broken, 'the file is never rewritten');
});

// ── QA-0928-55: every cost display says billing-grade or estimated ───────────

function mixedFixture() {
  return fixture({
    'dddd0001-0000-4000-8000-000000000001': [
      t('2026-09-10T13:00:00.000Z', { turn: 1, cost_usd: 3, project_hash: 'p1aaaaaaaaaa', git_branch: 'main', cost_center: 'eng' }),
      t('2026-09-10T13:05:00.000Z', { turn: 2, model: 'claude-fable-5-1', input_tokens: 100_000, output_tokens: 10_000, project_hash: 'p1aaaaaaaaaa', git_branch: 'main', cost_center: 'eng' }),
    ],
  });
}
const MIXED = /\d+% billing-grade, rest estimated/;

test('every cost-printing ledger command labels a mixed total (text), carries cost_basis (json) and basis columns (csv)', () => {
  const dir = mixedFixture();
  const text = [
    ['today', ...DAY, '--group-by', 'project'], ['tasks', ...DAY], ['report', '--cost-center', '--month', '2026-09'],
    ['project', 'p1aaaaaaaaaa'], ['devices'], ['blocks'],
  ];
  for (const args of text) {
    const out = run(args, dir).out;
    assert.match(out, MIXED, `${args.join(' ')} prints a mixed total without its label:\n${out}`);
  }
  // Row-level tags on the tables.
  for (const args of [['today', ...DAY, '--group-by', 'project'], ['report', '--cost-center', '--month', '2026-09'], ['devices'], ['blocks']]) {
    assert.match(run(args, dir).out, /\bmixed\b/, `${args.join(' ')} rows carry a basis tag`);
  }
  const hasBasis = (cb) => cb && cb.anchored_turns === 1 && cb.estimated_turns === 1 && typeof cb.estimated_usd === 'number';
  assert.ok(hasBasis(JSON.parse(run(['today', ...DAY, '--group-by', 'project', '--json'], dir).out).groups[0].cost_basis));
  const rep = JSON.parse(run(['report', '--cost-center', '--month', '2026-09', '--json'], dir).out);
  assert.ok(hasBasis(rep.cost_basis) && hasBasis(rep.cost_centers[0].cost_basis));
  assert.ok(hasBasis(JSON.parse(run(['project', 'p1aaaaaaaaaa', '--json'], dir).out).cost_basis));
  const dev = JSON.parse(run(['devices', '--json'], dir).out);
  assert.ok(hasBasis(dev.combined.cost_basis) && hasBasis(dev.devices[0].cost_basis));
  assert.ok(hasBasis(JSON.parse(run(['blocks', '--json'], dir).out).blocks[0].cost_basis));
  for (const args of [['today', ...DAY], ['today', ...DAY, '--group-by', 'branch'], ['report', '--cost-center', '--month', '2026-09'], ['devices'], ['project', 'p1aaaaaaaaaa']]) {
    const header = run([...args, '--csv'], dir).out.split('\n')[0];
    assert.match(header, /,anchored_usd,estimated_usd,excluded_turns$/, `${args.join(' ')} --csv appends the basis columns: ${header}`);
  }
});

// Exact edges: a mixed total whose dollars are all anchor (the estimated turns
// cost exactly $0) or all estimate (the anchored turns carry cost_usd 0) takes
// that side's label, never "100%" / "0% billing-grade, rest estimated".
test('a mixed total that is all anchor or all estimate is labelled as such everywhere, never 100% / 0%', () => {
  const zeroTok = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 };
  const allAnchor = fixture({
    'ffff0001-0000-4000-8000-000000000001': [
      t('2026-09-10T13:00:00.000Z', { turn: 1, cost_usd: 5, cost_center: 'eng' }),
      t('2026-09-10T13:05:00.000Z', { turn: 2, ...zeroTok, cost_center: 'eng' }), // unanchored, $0 estimate
    ],
  });
  const allEstimate = fixture({
    'ffff0002-0000-4000-8000-000000000001': [
      t('2026-09-10T13:00:00.000Z', { turn: 1, cost_usd: 0, cost_center: 'eng' }), // anchored at $0
      t('2026-09-10T13:05:00.000Z', { turn: 2, model: 'claude-fable-5-1', input_tokens: 100_000, output_tokens: 10_000, cost_center: 'eng' }),
    ],
  });
  // (watch's frame is covered with an injected clock in watch.test.js.)
  const cmds = [['today', ...DAY], ['today', ...DAY, '--group-by', 'cost_center'], ['blocks'], ['devices'], ['report', '--month', '2026-09'], ['session']];
  for (const args of cmds) {
    const a = run(args, allAnchor).out;
    const e = run(args, allEstimate).out;
    for (const out of [a, e]) assert.doesNotMatch(out, /(100|0)% billing-grade|\bmixed\b/, `${args.join(' ')}:\n${out}`);
    assert.match(a, /\$5\.00(?!\d)/, `${args.join(' ')} all-anchor shows the anchor:\n${a}`);
    assert.doesNotMatch(a, /~\$5\.00/, `${args.join(' ')} all-anchor carries no "~":\n${a}`);
    assert.match(e, /estimated/, `${args.join(' ')} all-estimate says estimated:\n${e}`);
  }
  assert.match(run(['today', ...DAY], allAnchor).out, /Cost: +\$5\.00 {2}\(billing-grade\)/);
  assert.match(run(['today', ...DAY], allEstimate).out, /Cost: +\$[\d.]+ {2}\(estimated\)/);
});

// QA-0928-157: in a converted table every row tag describes the USD source —
// no row pairs a "≈" amount with a bare "billing-grade".
test('converted tables: no row pairs a ≈ amount with a bare "billing-grade" tag', () => {
  const dir = fixture({
    'abc12345-0000-4000-8000-000000000001': [
      t('2026-09-10T13:00:00.000Z', { turn: 1, cost_usd: 3, cost_center: 'eng', git_branch: 'main' }),
      t('2026-09-10T13:05:00.000Z', { turn: 2, cost_usd: 1.5, cost_center: 'eng', git_branch: 'main' }),
    ],
    'dddd0001-0000-4000-8000-000000000001': [
      t('2026-09-10T14:00:00.000Z', { turn: 1, cost_usd: 3, cost_center: 'ops', git_branch: 'dev' }),
      t('2026-09-10T14:05:00.000Z', { turn: 2, model: 'claude-fable-5-1', input_tokens: 100_000, output_tokens: 10_000, cost_center: 'ops', git_branch: 'dev' }),
    ],
  });
  const cmds = [
    ['report', '--month', '2026-09'], ['today', ...DAY, '--group-by', 'device'], ['today', ...DAY, '--group-by', 'cost_center'],
    ['devices'], ['session'], ['session', 'abc12345'], ['session', 'dddd0001'], ['today', ...DAY],
  ];
  for (const args of cmds) {
    const out = run([...args, '--currency', 'EUR'], dir).out;
    const converted = out.split('\n').filter(l => /≈ -?€\d/.test(l));
    assert.ok(converted.length > 0, `${args.join(' ')} shows converted amounts:\n${out}`);
    for (const l of converted) {
      // "converted from billing-grade USD $X" / "converted from USD $X — N% billing-grade" name the USD figure.
      const rest = l.replace(/\(converted from [^)]*\)/, '');
      assert.doesNotMatch(rest, /billing-grade(?! USD)/, `${args.join(' ')}: ${l}`);
    }
  }
  assert.match(run(['report', '--month', '2026-09', '--currency', 'EUR'], dir).out, /eng +≈ €4\.14 +2 +billing-grade USD/);
  assert.match(run(['session', 'abc12345', '--currency', 'EUR'], dir).out, /≈ €2\.76 billing-grade USD/);
  // USD output is unchanged.
  assert.match(run(['report', '--month', '2026-09'], dir).out, /eng +\$4\.50 +2 +billing-grade$/m);
});

// ── QA-0928-64 / QA-0928-158: devices is local-only; one label per device ────

function devicesFixture(cfg = {}) {
  return fixture({
    'eeee0001-0000-4000-8000-000000000001': [t('2026-09-10T13:00:00.000Z', { turn: 1, cost_usd: 4.5 })],
    'eeee0002-0000-4000-8000-000000000002': [t('2026-09-10T14:00:00.000Z', { turn: 1, cost_usd: 3, device_id: null })],
    'eeee0003-0000-4000-8000-000000000003': [t('2026-09-10T15:00:00.000Z', { turn: 1, cost_usd: 0.5, device_id: OTHER_DEV })],
  }, cfg);
}

test('devices with sync on is still labelled local-only, and its total is this machine\'s files', () => {
  const dir = devicesFixture({ sync_enabled: true, supabase_url: 'http://127.0.0.1:9' });
  const out = run(['devices'], dir).out;
  assert.match(out, /Local-only view/);
  assert.match(out, /TOTAL \(this machine's files\)/);
  assert.match(out, /dashboard/);
  assert.doesNotMatch(out, /COMBINED/);
  const j = JSON.parse(run(['devices', '--json'], dir).out);
  assert.equal(j.scope, 'local-only');
  assert.equal(j.sync_enabled, true);
});

test('devices with sync off keeps the enable-sync hint', () => {
  const out = run(['devices'], devicesFixture()).out;
  assert.match(out, /Local-only view/);
  assert.match(out, /sync --enable/);
});

test('--group-by device and devices give each bucket the same label; the error lists device', () => {
  const dir = devicesFixture();
  const grouped = JSON.parse(run(['today', ...DAY, '--group-by', 'device', '--json'], dir).out).groups.map(g => g.display).sort();
  const devices = JSON.parse(run(['devices', '--json'], dir).out).devices.map(d => d.label).sort();
  assert.deepEqual(grouped, ['(no device id)', 'device 22222222', 'laptop (this device)']);
  assert.deepEqual(devices, grouped);
  const bad = run(['week', '--group-by', 'bogus'], dir);
  assert.equal(bad.code, 1);
  assert.match(bad.err, /project, branch, cost_center, task, device/);
  assert.match(run(['session', '--group-by', 'bogus'], dir).err, /project, branch, cost_center, task, device/);
  assert.match(run(['week', '--help'], dir).out, /task \| device/);
});

// ── session / project: local dates, width, ambiguous ids, advertised flags ───

const LONG_BRANCH = 'feature/an-exceptionally-long-branch-name-that-overflows-the-session-table';
function sessionsFixture() {
  return fixture({
    // All on 09-14 local; the 23:30 EDT turn is 03:30Z on 09-15.
    'abc12345-0000-4000-8000-000000000001': [
      t('2026-09-14T17:53:00.000Z', { turn: 1, cost_usd: 1.25, project_hash: 'p1aaaaaaaaaa', git_branch: 'main' }),
      t('2026-09-15T03:30:00.000Z', { turn: 2, cost_usd: 2.5, project_hash: 'p1aaaaaaaaaa', git_branch: 'main' }),
    ],
    // Spans two local days (17:48 → 09:30 next morning).
    'abc98765-0000-4000-8000-000000000002': [
      t('2026-09-16T21:48:00.000Z', { turn: 1, cost_usd: 1, project_hash: 'p1bbbbbbbbbb', git_branch: LONG_BRANCH }),
      t('2026-09-17T13:30:00.000Z', { turn: 2, cost_usd: 1, project_hash: 'p1bbbbbbbbbb', git_branch: LONG_BRANCH }),
    ],
    'def00000-0000-4000-8000-000000000003': [t('2026-09-20T14:00:00.000Z', { turn: 1, cost_usd: 3, project_hash: 'p2cccccccccc', git_branch: 'dev' })],
  });
}

test('QA-0928-58/160: the session list shows local dates (first–last), not the UTC date', () => {
  const out = run(['session'], sessionsFixture()).out;
  const row = (id) => out.split('\n').find(l => l.includes(id));
  assert.match(row('abc12345'), /^ {2}2026-09-14 /, 'a 23:30 EDT turn lists under its local date');
  assert.doesNotMatch(row('abc12345'), /2026-09-15/);
  assert.match(row('abc98765'), /^ {2}2026-09-16–17 /);
  const j = JSON.parse(run(['session', '--json'], sessionsFixture()).out);
  assert.equal(j.sessions.find(s => s.session_id.startsWith('abc12345')).last_ts, '2026-09-15T03:30:00.000Z', 'JSON keeps UTC ISO timestamps');
});

test('QA-0928-160: session detail puts a local-date sub-header where the date changes', () => {
  const out = run(['session', 'abc98765'], sessionsFixture()).out;
  assert.match(out, /Session abc98765 · 2026-09-16–17 ·/);
  const i16 = out.indexOf('── 2026-09-16 ──'), i17 = out.indexOf('── 2026-09-17 ──');
  assert.ok(i16 > 0 && i17 > i16, out);
  assert.ok(out.indexOf('17:48') > i16 && out.indexOf('17:48') < i17);
  assert.ok(out.indexOf('09:30') > i17);
  assert.doesNotMatch(run(['session', 'abc12345'], sessionsFixture()).out, /── 2026/, 'single-day sessions need no sub-header');
});

test('QA-0928-163: the session list fits 80 columns; long branches are truncated with …, JSON keeps them whole', () => {
  const dir = sessionsFixture();
  const out = run(['session'], dir).out;
  for (const l of out.split('\n')) assert.ok(l.length <= 80, `${l.length} cols: ${l}`);
  assert.match(out, /feature\/an-exc[^\n]*…/);
  assert.ok(JSON.parse(run(['session', '--json'], dir).out).sessions.some(s => s.git_branch === LONG_BRANCH));
  const wide = run(['session'], dir, { COLUMNS: '200' }).out;
  assert.ok(wide.includes(LONG_BRANCH), 'a wide terminal shows the whole name');
});

test('QA-0928-163: a session across New Year still fits 80 columns, in USD and converted', () => {
  const dir = fixture({
    'aaaa2026-0000-4000-8000-000000000001': [
      t('2026-12-31T22:00:00.000Z', { turn: 1, cost_usd: 1234.5, git_branch: LONG_BRANCH }),
      t('2027-01-01T15:00:00.000Z', { turn: 2, cost_usd: 1, git_branch: LONG_BRANCH }),
    ],
    'bbbb2026-0000-4000-8000-000000000001': [t('2026-12-30T15:00:00.000Z', { turn: 1, git_branch: LONG_BRANCH })],
  });
  for (const cur of [[], ['--currency', 'EUR'], ['--currency', 'JPY']]) {
    const out = run(['session', ...cur], dir).out;
    for (const l of out.split('\n')) assert.ok(l.length <= 80, `${cur.join(' ')} ${l.length} cols: ${l}`);
    assert.match(out, /2026-12-31–01-01/, 'the year-crossing range drops the repeated year');
    assert.match(out, /feat/, 'the branch column keeps a visible prefix');
  }
  assert.match(run(['session', 'aaaa2026'], dir).out, /Session aaaa2026 · 2026-12-31–01-01 ·/);
});

test('QA-0928-63: an ambiguous session or project prefix is an error listing the matches, not the first match', () => {
  const dir = sessionsFixture();
  const s = run(['session', 'abc'], dir);
  assert.equal(s.code, 1);
  assert.match(s.err, /"abc" is ambiguous: 2 sessions/);
  assert.match(s.err, /abc12345-0000/);
  assert.match(s.err, /abc98765-0000/);
  const sj = run(['session', 'abc', '--json'], dir);
  assert.equal(sj.code, 1);
  assert.deepEqual(JSON.parse(sj.out).error, 'ambiguous');
  assert.equal(run(['session', 'abc1'], dir).code, 0, 'a unique prefix still works');
  const p = run(['project', 'p1', '--json'], dir);
  assert.equal(p.code, 1);
  const pj = JSON.parse(p.out);
  assert.equal(pj.error, 'ambiguous');
  assert.deepEqual(pj.matches.sort(), ['p1aaaaaaaaaa', 'p1bbbbbbbbbb']);
  assert.match(run(['project', 'p1'], dir).err, /"p1" is ambiguous: 2 projects/);
  const one = JSON.parse(run(['project', 'p1a', '--json'], dir).out);
  assert.equal(one.project_hash, 'p1aaaaaaaaaa');
  assert.equal(one.turns, 2, 'only the matched project is summed');
});

test('QA-0928-65: every advertised flag works or is rejected', () => {
  const dir = sessionsFixture();
  const csv = run(['session', '--csv'], dir).out.trim().split('\n');
  assert.match(csv[0], /^session_id,first_ts,last_ts,turns,cost_usd,tokens,git_branch,anchored_usd,estimated_usd,excluded_turns$/);
  assert.equal(csv.length, 4);
  assert.match(run(['session', '--currency', 'EUR'], dir).out, /≈ €/);
  const detail = run(['session', 'abc12345', '--currency', 'EUR'], dir).out;
  assert.match(detail, /≈ €3\.45 {2}\(converted from billing-grade USD \$3\.75\)/);
  assert.match(detail, /≈ €1\.15/);
  const dcsv = run(['session', 'abc12345', '--csv'], dir).out.trim().split('\n');
  assert.match(dcsv[0], /^turn,ts,model,cost_usd,cost_basis,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,speed_tier$/);
  assert.equal(dcsv.length, 3);
  const pcsv = run(['project', '--csv'], dir).out.trim().split('\n');
  assert.match(pcsv[0], /^project_hash,turns/);
  assert.equal(pcsv.length, 4);
  const tg = run(['tasks', '--group-by', 'project'], dir);
  assert.notEqual(tg.code, 0);
  assert.match(tg.err, /--group-by/);
});

// ── QA-0928-159: report and blocks input validation; bare report ─────────────

test('report: impossible months are rejected; a bare `report` is the monthly report its help describes', () => {
  const dir = mixedFixture();
  for (const m of ['2026-13', '2026-00']) {
    const r = run(['report', '--cost-center', '--month', m, '--json'], dir);
    assert.equal(r.code, 1, m);
    assert.match(r.err, /--month must be a real month as YYYY-MM/);
  }
  const bare = run(['report', '--month', '2026-09'], dir);
  assert.equal(bare.code, 0, bare.all);
  assert.match(bare.out, /Cost-center report · 2026-09/);
  assert.match(bare.out, /TOTAL/);
  assert.match(run(['report', '--help'], dir).out, /Monthly cost report/);
});

test('blocks --limit below 1 or not a whole number is rejected', () => {
  const dir = mixedFixture();
  for (const v of ['0', '-1', 'abc', '1.5']) {
    const r = run(['blocks', '--limit', v, '--json'], dir);
    assert.equal(r.code, 1, v);
    assert.match(r.err, /--limit must be a whole number of 1 or more/);
  }
  assert.equal(JSON.parse(run(['blocks', '--limit', '1', '--json'], dir).out).blocks.length, 1);
});

// ── QA-0928-62 (relabel only) / QA-0928-174: what a block and its tokens are ─

test('blocks says what it is: fixed 5-hour UTC buckets, not the limit window; never "rolling"', () => {
  const dir = mixedFixture();
  const out = run(['blocks'], dir).out;
  const help = run(['blocks', '--help'], dir).out;
  for (const text of [out, help]) {
    assert.match(text, /fixed 5-hour UTC/i);
    assert.match(text, /not your (rate-)?limit window/);
    assert.doesNotMatch(text, /rolling/i);
  }
  assert.match(JSON.parse(run(['blocks', '--json'], dir).out).note, /fixed 5-hour UTC buckets/);
});

test('blocks labels which token fields its Tokens column sums', () => {
  assert.match(run(['blocks'], mixedFixture()).out, /Tokens = all token fields \(input \+ output \+ cache read \+ cache write\)/);
});

// ── QA-0928-159: watch --interval below 1 is rejected ────────────────────────

test('watch --interval 0 / 0.5 / abc exits 1 with a message instead of silently becoming 5 s', () => {
  const dir = mixedFixture();
  for (const v of ['0', '0.5', 'abc']) {
    const r = run(['watch', '--interval', v], dir);
    assert.equal(r.code, 1, v);
    assert.match(r.err, /--interval must be a number of seconds, 1 or more/);
  }
});

// RC 2026-09-28: an unknown project id is an input error, as an unknown
// session id is (exit 1); a known project with nothing in the range is not.
test('project <unknown id> exits 1 like session <unknown id>; an empty range for a known one exits 0', () => {
  const dir = fixture({ 'cccc0001-0000-4000-8000-000000000001': [t('2026-09-10T13:00:00.000Z', { turn: 1, cost_usd: 1, project_hash: 'p1aaaaaaaaaa' })] });
  const unknown = run(['project', 'zzzz', '--since', '2026-09-01', '--until', '2026-09-30'], dir);
  assert.equal(unknown.code, 1);
  assert.match(unknown.all, /No usage for project "zzzz"/);
  assert.equal(run(['session', 'zzzz'], dir).code, 1);
  assert.equal(run(['project', 'p1aa', '--since', '2026-09-01', '--until', '2026-09-30'], dir).code, 0);
  const outside = run(['project', 'p1aa', '--since', '2026-10-01', '--until', '2026-10-31'], dir);
  assert.equal(outside.code, 0, 'a known project with nothing in the range is not an error');
  assert.match(outside.all, /No usage for project "p1aa"/);
});

// RC 2026-09-28: with data present, a config.json that doesn't parse left the
// read commands running silently (no plan, no currency, autosync off) while
// the CHANGELOG said every command names the file and stops. Read commands
// now keep working and say so once, on stderr; the file is never rewritten.
test('read commands with an unparsable config.json keep working and warn once on stderr, naming the file', () => {
  const dir = fixture({ 'eeee0001-0000-4000-8000-000000000001': [t('2026-09-10T13:00:00.000Z', { turn: 1, cost_usd: 1.5 })] });
  const broken = '{\n  "edit_hash_salt": "deadbeefdeadbeefdeadbeefdeadbeef",\n  "plan": "max5",\n}\n';
  writeFileSync(join(dir, 'config.json'), broken);
  const cmds = [
    ['today', '--since', '2026-09-10', '--until', '2026-09-10'], ['today', '--since', '2026-09-10', '--until', '2026-09-10', '--json'],
    ['week', '--until', '2026-09-10'], ['session'], ['limit'], ['badges'], ['credits'], ['devices'],
    // An empty range names the file in its own text — still exactly once.
    ['today', '--since', '2026-01-03', '--until', '2026-01-03'],
  ];
  for (const args of cmds) {
    const r = run(args, dir);
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.all}`);
    const hits = r.all.match(/config\.json is not valid JSON \(line 4, column 1\)/g) || [];
    assert.equal(hits.length, 1, `${args.join(' ')} named the file ${hits.length} times:\n${r.all}`);
  }
  const today = run(['today', '--since', '2026-09-10', '--until', '2026-09-10'], dir);
  assert.match(today.out, /\$1\.50/, 'the figures still show');
  assert.match(today.err, /config\.json is not valid JSON \(line 4, column 1\) — showing your data without it/);
  assert.equal(today.err.trim().split('\n').length, 1, 'one line');
  assert.equal(JSON.parse(run(['today', '--since', '2026-09-10', '--until', '2026-09-10', '--json'], dir).out).cost_usd, 1.5, 'stdout JSON stays clean');
  assert.equal(readFileSync(join(dir, 'config.json'), 'utf8'), broken, 'never rewritten');
  // The status line (Claude Code runs it) stays quiet.
  assert.equal(run(['statusline'], dir).err, '');
});
