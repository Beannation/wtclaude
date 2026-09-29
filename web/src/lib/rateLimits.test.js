// The plan-limit "current reading" rule (QA-0928-61), pinned against the CLI.
// Hermetic: the CLI module is imported with WTCLAUDE_DIR and HOME pointed at an
// empty temp dir, and only its pure latestRateLimit is called — nothing reads
// the developer's ~/.claude or ~/.wtclaude.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { latestRateLimitReading } from './rateLimits.js';

// The rule the deployed dashboard_rate_limits uses (migration 009): the newest
// row with any reading, both limits from that row.
function newestReadingByTime(turns) {
  const list = turns.filter((t) => t.rate_limit_5h_pct != null || t.rate_limit_7d_pct != null);
  const t = list.reduce((a, x) => (Date.parse(x.ts) > Date.parse(a.ts) ? x : a));
  return { five_hour: { used_percentage: t.rate_limit_5h_pct }, seven_day: { used_percentage: t.rate_limit_7d_pct } };
}

const TMP = mkdtempSync(join(tmpdir(), 'wtc-web-limit-'));
process.env.WTCLAUDE_DIR = join(TMP, 'wtclaude');
process.env.HOME = TMP;
const { latestRateLimit } = await import('../../../src/utils/sessions.js');

const R5 = '2026-09-28T15:10:00Z';
const R7 = '2026-10-04T23:00:00Z';
const R7_OLD = '2026-09-28T01:00:00Z';

// Rows as get-session / the turns table carries them (resets_at as timestamps),
// and the same rows as the CLI stores them (epoch seconds).
const rows = [
  // A concurrent session lagging behind: its newer rows carry older, lower readings.
  { ts: '2026-09-28T13:40:00.000Z', rate_limit_5h_pct: 33, rate_limit_5h_resets_at: R5, rate_limit_7d_pct: 12, rate_limit_7d_resets_at: R7 },
  { ts: '2026-09-28T13:42:25.000Z', rate_limit_5h_pct: 33, rate_limit_5h_resets_at: R5, rate_limit_7d_pct: 48, rate_limit_7d_resets_at: R7 },
  { ts: '2026-09-28T13:42:27.000Z', rate_limit_5h_pct: 32, rate_limit_5h_resets_at: '2026-09-28T15:10:30Z', rate_limit_7d_pct: 9, rate_limit_7d_resets_at: R7_OLD },
  { ts: '2026-09-28T13:43:00.000Z', model: 'claude-opus-5-5' },
];
const epoch = (iso) => Date.parse(iso) / 1000;
const cliRows = rows.map((r) => ({
  ...r,
  ...(r.rate_limit_5h_resets_at ? { rate_limit_5h_resets_at: epoch(r.rate_limit_5h_resets_at) } : {}),
  ...(r.rate_limit_7d_resets_at ? { rate_limit_7d_resets_at: epoch(r.rate_limit_7d_resets_at) } : {}),
}));

// The old newest-row-by-time rule reads 32% / 9% here; `wtclaude limit` (and
// get-dashboard's dashboard_rate_limits since migration 009) reads 33% / 48%.
test('the gauge rule matches `wtclaude limit` where newest-by-time does not', () => {
  const web = latestRateLimitReading(rows);
  const cli = latestRateLimit(cliRows);
  assert.equal(web.five_hour.used_percentage, cli.rate_limit_5h_pct);
  assert.equal(web.seven_day.used_percentage, cli.rate_limit_7d_pct);
  assert.equal(web.captured_at, cli.ts);
  assert.equal(Date.parse(web.five_hour.resets_at) / 1000, cli.rate_limit_5h_resets_at);
  assert.equal(Date.parse(web.seven_day.resets_at) / 1000, cli.rate_limit_7d_resets_at);
  assert.deepEqual([web.five_hour.used_percentage, web.seven_day.used_percentage], [33, 48]);
  assert.equal(web.captured_at, '2026-09-28T13:42:27.000Z', 'as of the newest reading');
  // The rule the deployed SQL uses picks the lagging row.
  const old = newestReadingByTime(rows);
  assert.deepEqual([old.five_hour.used_percentage, old.seven_day.used_percentage], [32, 9]);
});

test('a missing reading stays null (shown as —), never 0; no readings → null', () => {
  const only5h = [{ ts: '2026-09-28T13:42:00.000Z', rate_limit_5h_pct: 32, rate_limit_5h_resets_at: R5 }];
  const web = latestRateLimitReading(only5h);
  const cli = latestRateLimit(only5h.map((r) => ({ ...r, rate_limit_5h_resets_at: epoch(R5) })));
  assert.equal(web.seven_day.used_percentage, null);
  assert.equal(cli.rate_limit_7d_pct, null);
  assert.equal(latestRateLimitReading([{ ts: 'x', model: 'y' }]), null);
  assert.equal(latestRateLimitReading([]), null);
});

test('resets_at in epoch seconds, milliseconds or ISO all normalise the same', () => {
  const at = Date.parse(R5);
  for (const v of [at / 1000, at, R5]) {
    const r = latestRateLimitReading([{ ts: '2026-09-28T13:00:00Z', rate_limit_5h_pct: 12, rate_limit_5h_resets_at: v }]);
    assert.equal(r.five_hour.used_percentage, 12);
  }
});
