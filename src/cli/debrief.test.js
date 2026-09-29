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
// `wtclaude debrief` (BUILD-018). The stored per-turn tokens are context
// occupancy deltas (BUILD-014), not billed tokens, so:
//  • QA-0928-85: no "cache hit rate" and no causal CLAUDE.md tip.
//  • QA-0928-87: the costliest turn's token line is labelled as context growth,
//    so a large cost beside "11K in / 0 out" is not read as those tokens' price.
//  • QA-0928-174: the token total says which fields it sums (blocks sums all
//    four; debrief summed input + output with no label).
//  • The cache-read share says what it is over: the input side, each token
//    counted once (a stored input already holds the cache fields), so it must
//    not be called a share of the four-field "recorded tokens" total printed
//    above it, nor labelled as the sum of the per-turn fields.
// ───────────────────────────────────────────────────────────────────────────

const BIN = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'wtclaude.js');

// Today's LOCAL midnight: never in the future, always today (and this month),
// whatever minute the suite runs in.
const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };

test('debrief labels occupancy tokens honestly and makes no hit-rate claim', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-debrief-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  const ts = todayStart();
  writeFileSync(join(dir, 'sessions', 's.ndjson'), [
    { turn: 1, cost_usd: 9.5, input_tokens: 9_000, output_tokens: 200, cache_read_tokens: 3_000, cache_write_tokens: 6_000 },
    { turn: 2, cost_usd: 0.5, input_tokens: 1_000, output_tokens: 500, cache_read_tokens: 100, cache_write_tokens: 0 },
  ].map(t => JSON.stringify({ ts, session_id: 's', model: 'claude-opus-5-5[1m]', ...t })).join('\n') + '\n');
  try {
    const out = spawnSync(process.execPath, [BIN, 'debrief'], {
      env: { ...process.env, WTCLAUDE_NO_AUTOSYNC: '1', TZ: 'America/New_York', WTCLAUDE_DIR: dir, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude') }, encoding: 'utf8',
    }).stdout;
    assert.doesNotMatch(out, /cache hit/i);
    assert.doesNotMatch(out, /CLAUDE\.md|Tip:/);
    assert.match(out, /Cost: \$9\.50/);
    assert.match(out, /context growth, not billed tokens/);
    // input + output + cache read + cache write = 19.8K, labelled as such.
    assert.match(out, /Tokens:\s+20K recorded \(input \+ output \+ cache read \+ cache write\)/);
    // Input side counted once per turn (RC 2026-09-28): turn 1's input 9K
    // already holds its 3K read + 6K write, turn 2's is 1K, so reads 3.1K over
    // 10K = 31%. (Adding the cache fields again gave 3.1K / 19.1K = 16%.)
    // So the label must not tell the reader to add the Input, Cache read and
    // Cache write lines printed above it: that sum is the 16% double count.
    assert.match(out, /Cache-read share of recorded input-side tokens: 31%\n\s+\(input side, each token counted once; context occupancy, not a hit rate\)/);
    assert.doesNotMatch(out, /input \+ cache read \+ cache write;/);
    assert.doesNotMatch(out, /share of recorded tokens/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// QA-0928-55 / QA-0928-174 (ledger handoff): "Total cost:" was unlabelled and
// added fallback-priced unanchored turns through computeTurnCost. It is now the
// same total as `today` — billing-grade anchor plus labelled estimate, turns we
// cannot price left out and named — with its basis, and the costliest turn
// says when its cost is an estimate.
test('debrief labels the total by its basis, leaves out and names unpriceable turns, and labels an estimated costliest turn', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wtc-debrief-'));
  mkdirSync(join(dir, 'sessions'), { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify({ edit_hash_salt: 'deadbeefdeadbeefdeadbeefdeadbeef', anonymous_id: 'a1' }));
  const ts = todayStart();
  const BIG = { input_tokens: 1_000_000, output_tokens: 100_000, cache_read_tokens: 0, cache_write_tokens: 0 };
  writeFileSync(join(dir, 'sessions', 's.ndjson'), [
    { turn: 1, model: 'claude-opus-5-5', cost_usd: 3, input_tokens: 1_000, output_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0 },
    { turn: 2, model: 'claude-fable-5-1', ...BIG },   // unanchored, priceable: $10 + $5 estimate
    { turn: 3, model: 'claude-opus-6', ...BIG },      // unanchored, family fallback: excluded
    { turn: 4, model: 'claude-opus-5-5', cost_usd: 0.5 }, // a row missing its token fields
  ].map(t => JSON.stringify({ ts, session_id: 's', speed_tier: 'standard', ...t })).join('\n') + '\n');
  try {
    const out = spawnSync(process.execPath, [BIN, 'debrief'], {
      env: { ...process.env, WTCLAUDE_NO_AUTOSYNC: '1', TZ: 'America/New_York', WTCLAUDE_DIR: dir, HOME: dir, CLAUDE_CONFIG_DIR: join(dir, '.claude') }, encoding: 'utf8',
    }).stdout;
    // 3 + 0.5 anchored + 15 estimated = 18.50; the opus-6 turn adds nothing.
    assert.match(out, /Total cost:\s+\$18\.50\s+\(19% billing-grade, rest estimated\)/);
    assert.match(out, /Not priced:\s+1 turn not priced/);
    assert.match(out, /claude-opus-6 \(1\)/);
    assert.match(out, /Costliest turn: #2 \(claude-fable-5-1\)/);
    assert.match(out, /Cost: \$15\.00 \(estimated — Claude Code sent no cost for this turn\)/);
    assert.doesNotMatch(out, /NaN/, 'a row missing token fields counts them as 0');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
