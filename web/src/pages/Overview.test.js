// Overview render tests (node --test via src/test-support/jsx.js).
process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, text } from '../test-support/jsx.js';

const PAGE = new URL('./Overview.jsx', import.meta.url);

// QA-0928-189: one quality status on every surface. The site says the command
// ships and the field it reads isn't in the payloads yet; the card used to say
// "Computed locally from edit→test→re-edit cycles", as if it were working.
test('One-shot card: the same status the site gives, not "computed locally"', async () => {
  const t = text(await render(PAGE, 'OneShotCard'));
  assert.match(t, /The command ships; the edit-target field it reads isn't in current Claude Code payloads yet/);
  assert.match(t, /wtclaude quality/);
  assert.doesNotMatch(t, /Computed locally/i);
  assert.doesNotMatch(t, /edit→test→re-edit/);
});

// RC 0.3.2 (dash-prod): the run-rate line said "idle days counted as $0" even
// with EUR or JPY selected ("≈ €…/day … counted as $0").
test('run-rate note: the idle-day zero is currency-neutral', async () => {
  const { runRateNote } = await import('../lib/derive.js');
  const { formatCost } = await import('../lib/format.js');
  const rr = { days: 14, sinceStart: false, exact: true, firstDate: null, dailyAvg: 42.5, empty: false };
  for (const cur of ['EUR', 'JPY', 'USD']) {
    const note = runRateNote(rr, { utc: true, fc: (v) => formatCost(v, cur) });
    assert.match(note, /idle days counted as zero\.$/, note);
    assert.doesNotMatch(note, /\$0/, note);
  }
  assert.equal(runRateNote(rr, { utc: true, fc: (v) => formatCost(v, 'USD') }),
    '$42.50/day: the last 14 UTC days ÷ 14, idle days counted as zero.');
});

// RC 0.3.2 (dash-prod): without meta.first_activity_at the covered days start at
// the window's first synced day, and the line says that is what they are.
test('run-rate note names the first synced day when the server has no tracking start', async () => {
  const { runRateNote } = await import('../lib/derive.js');
  const fc = (v) => `$${v.toFixed(2)}`;
  const inexact = runRateNote({ days: 3, sinceStart: true, exact: false, firstDate: '2026-07-12', dailyAvg: 3, empty: false }, { utc: true, fc });
  assert.equal(inexact, "$3.00/day: the 3 UTC days since your first synced day in this window (2026-07-12) ÷ 3, idle days counted as zero. This server doesn't say when tracking began; if it began earlier, the rate is lower.");
  const exact = runRateNote({ days: 3, sinceStart: true, exact: true, firstDate: '2026-07-11', dailyAvg: 3, empty: false }, { utc: false, fc });
  assert.equal(exact, '$3.00/day: the 3 days since tracking began ÷ 3, idle days counted as zero.');
  assert.equal(runRateNote({ days: 1, empty: true }, { utc: false, fc }), 'No synced spend in the last 1 day.');
});
