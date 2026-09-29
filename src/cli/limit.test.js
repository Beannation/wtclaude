import { test } from 'node:test';
import assert from 'node:assert/strict';

// Injected clock throughout: nothing here depends on when the suite runs.
process.env.TZ = 'America/New_York';
const { limitLines } = await import('./limit.js');

const NOW = Date.UTC(2026, 8, 28, 16, 0, 0); // 12:00 EDT
const H = 3_600_000, M = 60_000;
const iso = (ms) => new Date(ms).toISOString();
const sec = (ms) => Math.floor(ms / 1000);

// ── QA-0928-61: stale and missing readings are never shown as current ────────

test('limit: a 72 h-old snapshot whose windows have since reset says so, and shows no stale percentage', () => {
  const out = limitLines({
    ts: iso(NOW - 72 * H), rate_limit_5h_pct: 60, rate_limit_5h_resets_at: sec(NOW - 70 * H),
    rate_limit_7d_pct: 31, rate_limit_7d_resets_at: sec(NOW - H),
  }, NOW).join('\n');
  assert.match(out, /5-hour window .*—\s+window has reset since your last snapshot \(3d 0h ago\)/);
  assert.match(out, /7-day window .*—\s+window has reset since your last snapshot \(3d 0h ago\)/);
  assert.doesNotMatch(out, /resetting now|60%|31%/);
});

test('limit: "as of" is local time with its age, not an unlabelled UTC slice', () => {
  const out = limitLines({ ts: '2026-09-28T13:42:00.000Z', rate_limit_5h_pct: 16, rate_limit_5h_resets_at: sec(NOW + 69 * M) }, NOW).join('\n');
  assert.match(out, /as of your last turn \(2026-09-28 09:42 local, 2h 18m ago\)/);
  assert.doesNotMatch(out, /13:42/);
  assert.match(out, /5-hour window .* 16%\s+resets in 1h 9m/);
  assert.match(out, /7-day window .* —\s+reset time unknown/);
});

// ── QA-0928-155: resets_at that is not epoch seconds ─────────────────────────

test('limit: ISO-string and millisecond resets_at read correctly; garbage reads "reset time unknown"', () => {
  const out = limitLines({
    ts: iso(NOW - 5 * M), rate_limit_5h_pct: 22, rate_limit_5h_resets_at: iso(NOW + 2 * H),
    rate_limit_7d_pct: 30, rate_limit_7d_resets_at: NOW + 3 * 24 * H,
  }, NOW).join('\n');
  assert.match(out, /22%\s+resets in 2h 0m/);
  assert.match(out, /30%\s+resets in 3d 0h/);
  assert.doesNotMatch(out, /NaN/);
  assert.match(limitLines({ ts: iso(NOW), rate_limit_5h_pct: 5, rate_limit_5h_resets_at: 'soon' }, NOW).join('\n'), /5%\s+reset time unknown/);
});
