// Badge copy parity with the CLI (QA-0928-85). The dashboard's badge list must
// say what src/badges/check.js says, word for word — the CLI is where the
// badges are computed, and its descriptions are the reviewed wording (no
// "cache hit rate": the stored per-turn tokens are context occupancy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ALL_BADGES } from './badges.js';

const CLI = readFileSync(new URL('../../../src/badges/check.js', import.meta.url), 'utf8');

// The CLI's BADGE_DEFINITIONS as { type, label, description }, with its
// template constants substituted.
function cliBadges() {
  const consts = Object.fromEntries([...CLI.matchAll(/^const (\w+) = (\d+);/gm)].map((m) => [m[1], m[2]]));
  const out = [];
  const re = /type:\s*'([^']+)',\s*label:\s*'([^']+)',\s*description:\s*(['`])((?:(?!\3).)*)\3/gs;
  for (const m of CLI.matchAll(re)) {
    const description = m[4].replace(/\$\{(\w+)\}/g, (_, k) => {
      assert.ok(k in consts, `unknown constant ${k} in a CLI badge description`);
      return consts[k];
    });
    out.push({ type: m[1], label: m[2], description });
  }
  return out;
}

test('the CLI badge definitions parse (guards the parser below)', () => {
  const cli = cliBadges();
  assert.equal(cli.length, 8);
  assert.ok(cli.every((b) => b.description && !b.description.includes('${')));
});

test('QA-0928-85: every dashboard badge label and description mirrors src/badges/check.js exactly', () => {
  assert.deepEqual(ALL_BADGES, cliBadges());
});

test('QA-0928-85: no badge calls the cache-read share a hit rate', () => {
  for (const b of ALL_BADGES) assert.doesNotMatch(b.description, /hit rate/i, b.type);
});

// RC 0.3.2 (last round): the CLI's day share counts each input-side token once
// (a recorded input already includes its cache reads and writes), but both
// descriptions still read "(input + cache read + cache write)", the sum that
// fix removed. The words are pinned to the formula in src/badges/check.test.js;
// here, that the dashboard does not keep the old sum.
test('Cache Champion describes the input side as counted once, not as a three-field sum', () => {
  const champ = ALL_BADGES.find((b) => b.type === 'efficient_day');
  assert.doesNotMatch(champ.description, /input \+ cache read \+ cache write/);
  assert.match(champ.description, /recorded input, which already includes cache reads and writes/);
  assert.match(champ.description, /added only on older records whose input is smaller than the two combined/);
});
