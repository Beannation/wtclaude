// Fixed zone first: streaks and Cache Champion bucket turns by LOCAL date.
process.env.TZ = 'America/New_York';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeStatsFromSessions, longestStreak, getAllBadgeDefinitions } from './check.js';

// ───────────────────────────────────────────────────────────────────────────
// BUILD-018 badge fixes.
//  • QA-0928-86: streaks keyed on the UTC date, so seven local evenings
//    (alternating 19:00 and 21:00 EDT) scored a 1-day streak; the streak also
//    started at 1 with no data.
//  • QA-0928-166: Cache Champion took the best SINGLE TURN of any day.
//  • QA-0928-85: the badge called an occupancy-token share a "cache hit rate".
//  • QA-0928-167: Model Mixer counted claude-opus-5-5 and its [1m] variant as
//    two models.
// ───────────────────────────────────────────────────────────────────────────

const turn = (ts, over = {}) => ({
  ts, model: 'claude-opus-5-5', input_tokens: 100, output_tokens: 10, cache_read_tokens: 0, cache_write_tokens: 0, ...over,
});

// Seven local days, alternating 19:00 and 21:00 local — the 21:00 ones are the
// NEXT day in UTC.
function evenings(days) {
  return days.map((d, i) => [turn(new Date(`${d}T${i % 2 ? '21' : '19'}:00:00`).toISOString())]);
}

test('QA-0928-86: seven consecutive LOCAL evenings are a 7-day streak (Week Warrior)', () => {
  const days = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
  const stats = computeStatsFromSessions(evenings(days));
  assert.equal(stats.longestStreak, 7);
  const week = getAllBadgeDefinitions().find(b => b.type === 'week_streak');
  assert.equal(week.check(stats), true);
});

test('QA-0928-86: a streak across the DST change still counts each local day once', () => {
  // US DST ends 2026-11-01; that local day is 25 hours long.
  const days = ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03', '2026-11-04'];
  assert.equal(computeStatsFromSessions(evenings(days)).longestStreak, 7);
});

test('QA-0928-86: no data is a 0-day streak, and a gap breaks the run', () => {
  assert.equal(longestStreak([]), 0);
  assert.equal(computeStatsFromSessions([]).longestStreak, 0);
  assert.equal(longestStreak(['2026-09-01', '2026-09-02', '2026-09-04']), 2);
  assert.equal(longestStreak(['2026-09-01']), 1);
});

test('QA-0928-166: Cache Champion is judged on the day, not the best single turn', () => {
  const champ = getAllBadgeDefinitions().find(b => b.type === 'efficient_day');
  // 20 turns in one day; one tiny turn at 60% cache reads, the rest with none.
  const day = [turn('2026-09-20T15:00:00Z', { input_tokens: 40, cache_read_tokens: 60 })];
  for (let i = 0; i < 19; i++) day.push(turn(`2026-09-20T15:${String(i + 1).padStart(2, '0')}:00Z`, { input_tokens: 10_000 }));
  assert.equal(champ.check(computeStatsFromSessions([day])), false, 'a 0.03% day is not a Cache Champion day');
  // A meaningful day (10+ turns) where cache reads are most of the recorded tokens earns it.
  const good = Array.from({ length: 12 }, (_, i) => turn(`2026-09-21T15:${String(i).padStart(2, '0')}:00Z`, { input_tokens: 100, cache_read_tokens: 900 }));
  assert.equal(champ.check(computeStatsFromSessions([good])), true);
  // One turn is not a meaningful day, however high its share.
  assert.equal(champ.check(computeStatsFromSessions([[turn('2026-09-22T15:00:00Z', { input_tokens: 1, cache_read_tokens: 99 })]])), false);
});

test('QA-0928-85: no badge calls the occupancy share a "cache hit rate"', () => {
  for (const b of getAllBadgeDefinitions()) assert.doesNotMatch(b.description, /cache hit/i, b.type);
});

test('QA-0928-85: Cache Champion names the tokens its share is over, and output is not one of them', () => {
  const champ = getAllBadgeDefinitions().find(b => b.type === 'efficient_day');
  assert.match(champ.description, /input-side tokens/);
  assert.doesNotMatch(champ.description, /output/i);
  // 12 turns: reads 900 of 1,000 input-side tokens, beside 100K output each.
  // Over all four fields that is under 1%; over the fields the badge names, 90%.
  const day = Array.from({ length: 12 }, (_, i) => turn(`2026-09-21T15:${String(i).padStart(2, '0')}:00Z`, { input_tokens: 100, cache_read_tokens: 900, output_tokens: 100_000 }));
  assert.equal(computeStatsFromSessions([day]).bestCacheRate, 0.9);
  assert.equal(champ.check(computeStatsFromSessions([day])), true);
});

test('QA-0928-167: one model at two context sizes is not a Model Mixer', () => {
  const mixer = getAllBadgeDefinitions().find(b => b.type === 'model_mixer');
  const oneModel = [turn('2026-09-20T15:00:00Z'), turn('2026-09-20T15:01:00Z', { model: 'claude-opus-5-5[1m]' })];
  assert.equal(computeStatsFromSessions([oneModel]).maxModelsInSession, 1);
  assert.equal(mixer.check(computeStatsFromSessions([oneModel])), false);
  const twoModels = [turn('2026-09-20T15:00:00Z'), turn('2026-09-20T15:01:00Z', { model: 'claude-sonnet-5' })];
  assert.equal(mixer.check(computeStatsFromSessions([twoModels])), true);
});

test('QA-0928-86: `leaderboard --json` reports the local-day streak', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-streak-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  const days = ['2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19', '2026-09-20'];
  evenings(days).forEach((turns, i) => writeFileSync(join(dir, 'sessions', `s${i}.ndjson`), turns.map(t => JSON.stringify({ ...t, session_id: `s${i}`, cost_usd: 0.1 })).join('\n') + '\n'));
  try {
    const bin = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');
    const env = { ...process.env, WTCLAUDE_NO_AUTOSYNC: '1', WTCLAUDE_DIR: dir, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude'), TZ: 'America/New_York' };
    const json = JSON.parse(spawnSync(process.execPath, [bin, 'leaderboard', '--json'], { env, encoding: 'utf8' }).stdout);
    assert.equal(json.stats.longest_streak, 7);
    assert.equal(json.stats.active_days, 7);
    assert.match(spawnSync(process.execPath, [bin, 'badges'], { env, encoding: 'utf8' }).stdout, /\[x\] Week Warrior/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// RC 2026-09-28: the day share counted cache tokens twice. A stored
// input_tokens already includes cache reads and writes (DATA-NOTES: the
// context_window input figure contains them), so adding the cache fields on
// top capped the share at 50% on every current row and the badge could no
// longer be earned. The input side is now counted once: a row whose input is
// at least its cache read + write already holds them; a smaller input (older
// rows that stored uncached input only) gets them added.
test('Cache Champion: a day of cache-heavy turns whose input already includes the cache earns it', () => {
  const champ = getAllBadgeDefinitions().find(b => b.type === 'efficient_day');
  // 10 turns, each input 1,000 = 700 cache read + 300 cache write.
  // Hand-computed: reads 7,000 over an input side of 10,000 = 70%.
  // (The double count gave 7,000 / 20,000 = 35% and no badge.)
  const day = Array.from({ length: 10 }, (_, i) => turn(`2026-09-23T15:${String(i).padStart(2, '0')}:00Z`, { input_tokens: 1_000, cache_read_tokens: 700, cache_write_tokens: 300 }));
  assert.equal(computeStatsFromSessions([day]).bestCacheRate, 0.7);
  assert.equal(champ.check(computeStatsFromSessions([day])), true);
});

test('Cache Champion: a day mixing current rows and older uncached-input rows, hand-computed', () => {
  // 5 current rows: input 1,000 (= 600 read + 400 write) -> input side 1,000.
  // 5 older rows: input 200 uncached, 300 read, 0 write -> input side 500.
  // Reads 5*600 + 5*300 = 4,500 over 5*1,000 + 5*500 = 7,500 = 60%.
  const day = [
    ...Array.from({ length: 5 }, (_, i) => turn(`2026-09-24T15:0${i}:00Z`, { input_tokens: 1_000, cache_read_tokens: 600, cache_write_tokens: 400 })),
    ...Array.from({ length: 5 }, (_, i) => turn(`2026-09-24T16:0${i}:00Z`, { input_tokens: 200, cache_read_tokens: 300, cache_write_tokens: 0 })),
  ];
  assert.equal(computeStatsFromSessions([day]).bestCacheRate, 0.6);
});

// RC 0.3.2 (last round): the RC fix counts each input-side token once, but the
// description still said "input-side tokens (input + cache read + cache
// write)" -- the sum that fix removed, since a recorded input already includes
// its cache reads and writes. The description now states the formula as coded,
// and each of its claims is pinned against computeStatsFromSessions here.
// web/src/lib/badges.js carries the same words (web/src/lib/badges.test.js).
const CACHE_CHAMPION_DESCRIPTION = "Cache reads were half or more of a day's recorded input-side tokens, on a day with 10+ turns. "
  + "A turn's input side is its recorded input, which already includes cache reads and writes "
  + '(they are added only on older records whose input is smaller than the two combined)';

test('Cache Champion: the description states the formula the badge computes, claim by claim', () => {
  const champ = getAllBadgeDefinitions().find(b => b.type === 'efficient_day');
  assert.equal(champ.description, CACHE_CHAMPION_DESCRIPTION);
  assert.doesNotMatch(champ.description, /input \+ cache read \+ cache write/, 'not the double-counting sum');
  assert.doesNotMatch(champ.description, /hit rate/i);
  // n turns on one local day (10:00-11:50 UTC is 06:00-07:50 EDT on 09-25).
  const dayOf = (n, over) => Array.from({ length: n }, (_, i) => turn(`2026-09-25T${10 + Math.floor(i / 6)}:${(i % 6)}0:00Z`, over));
  // "half or more": exactly 50% earns it.
  const half = dayOf(10, { input_tokens: 1_000, cache_read_tokens: 500, cache_write_tokens: 100 });
  assert.equal(computeStatsFromSessions([half]).bestCacheRate, 0.5);
  assert.equal(champ.check(computeStatsFromSessions([half])), true);
  // "on a day with 10+ turns": 9 turns at 90% don't count.
  const nine = dayOf(9, { input_tokens: 1_000, cache_read_tokens: 900, cache_write_tokens: 50 });
  assert.equal(champ.check(computeStatsFromSessions([nine])), false);
  // "its recorded input, which already includes cache reads and writes":
  // input 1,000 holding 600 read + 400 write is an input side of 1,000, not 2,000.
  const current = dayOf(10, { input_tokens: 1_000, cache_read_tokens: 600, cache_write_tokens: 400 });
  assert.equal(computeStatsFromSessions([current]).bestCacheRate, 0.6);
  // "added only on older records whose input is smaller than the two combined":
  // input 200 < 700 read + 100 write, so the input side is 1,000.
  const older = dayOf(10, { input_tokens: 200, cache_read_tokens: 700, cache_write_tokens: 100 });
  assert.equal(computeStatsFromSessions([older]).bestCacheRate, 0.7);
  // Equal to the two combined is "not smaller": nothing is added (900 / 1,000).
  const equal = dayOf(10, { input_tokens: 1_000, cache_read_tokens: 900, cache_write_tokens: 100 });
  assert.equal(computeStatsFromSessions([equal]).bestCacheRate, 0.9);
  // Output never counts: 100K output beside each turn changes nothing.
  const withOutput = dayOf(10, { input_tokens: 1_000, cache_read_tokens: 600, cache_write_tokens: 400, output_tokens: 100_000 });
  assert.equal(computeStatsFromSessions([withOutput]).bestCacheRate, 0.6);
});

// RC 2026-09-28: `leaderboard`'s Total cost had no basis label (it included
// list-rate estimates) and read $0.00 when every turn was unpriced.
function lbDir(turns) {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-lb-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  writeFileSync(join(dir, 'sessions', 's.ndjson'), turns.map((t, i) => JSON.stringify({ session_id: 's', turn: i + 1, ts: '2026-09-20T15:00:00Z', input_tokens: 1_000_000, output_tokens: 100_000, cache_read_tokens: 0, cache_write_tokens: 0, ...t })).join('\n') + '\n');
  return dir;
}
function lb(dir, args = []) {
  const bin = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');
  const env = { ...process.env, WTCLAUDE_NO_AUTOSYNC: '1', WTCLAUDE_DIR: dir, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude'), TZ: 'America/New_York' };
  return spawnSync(process.execPath, [bin, 'leaderboard', ...args], { env, encoding: 'utf8' }).stdout;
}

test('leaderboard labels its total cost by basis, and shows no $0.00 when nothing is priced', () => {
  const mixed = lbDir([{ model: 'claude-opus-5-5', cost_usd: 10 }, { model: 'claude-opus-5-5', cost_usd: null }]);
  const none = lbDir([{ model: 'claude-opus-7', cost_usd: null }, { model: 'vertex_ai/claude-sonnet-5', cost_usd: null }]);
  try {
    // $10 anchored + $6.00 estimate (1M in at $4 + 100K out at $20).
    assert.match(lb(mixed), /Total cost: +~\$16\.00 \(63% billing-grade, rest estimated\)/);
    assert.equal(JSON.parse(lb(mixed, ['--json'])).stats.cost_basis.estimated_turns, 1);
    const out = lb(none);
    assert.doesNotMatch(out, /Total cost: +\$0\.00/);
    assert.match(out, /Total cost: +— \(not priced\)/);
    assert.match(out.replace(/\s+/g, ' '), /Not priced: 2 turns not priced/);
  } finally {
    rmSync(mixed, { recursive: true, force: true });
    rmSync(none, { recursive: true, force: true });
  }
});
