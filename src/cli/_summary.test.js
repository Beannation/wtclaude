import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveRange } from './_summary.js';

// resolveRange with an injected "today" so none of this depends on the run date.
const TODAY = '2026-09-28';
const r = (opts, span, defaults = ['2026-09-22', TODAY]) => resolveRange(defaults[0], defaults[1], opts, { span, today: TODAY });

// ── QA-0928-56: --until alone ends the command's own span on that day ────────

test('--until alone: today covers that day, week the 7 days ending it, month/tasks the 30', () => {
  assert.deepEqual(r({ until: '2026-09-01' }, 1), { startStr: '2026-09-01', endStr: '2026-09-01' });
  assert.deepEqual(r({ until: '2026-09-01' }, 7), { startStr: '2026-08-26', endStr: '2026-09-01' });
  assert.deepEqual(r({ until: '2026-07-01' }, 30), { startStr: '2026-06-02', endStr: '2026-07-01' });
});

test('--until alone on an all-time command keeps the all-time start', () => {
  assert.deepEqual(resolveRange('1970-01-01', TODAY, { until: '2026-09-01' }, { span: null, today: TODAY }),
    { startStr: '1970-01-01', endStr: '2026-09-01' });
});

test('--since alone runs to today; both given are used as-is; both reversed are swapped', () => {
  assert.deepEqual(r({ since: '2026-09-01' }, 7), { startStr: '2026-09-01', endStr: TODAY });
  assert.deepEqual(r({ since: '2026-09-01', until: '2026-09-05' }, 7), { startStr: '2026-09-01', endStr: '2026-09-05' });
  assert.deepEqual(r({ since: '2026-09-05', until: '2026-09-01' }, 7), { startStr: '2026-09-01', endStr: '2026-09-05' });
});

test('no flags: the command default', () => {
  assert.deepEqual(r({}, 7), { startStr: '2026-09-22', endStr: TODAY });
});

test('--since alone after today is an error, not a silently reversed range', () => {
  assert.throws(() => r({ since: '2026-10-05' }, 7), /--since 2026-10-05 is after today \(2026-09-28\)/);
});

// ── QA-0928-57 / QA-0928-159: malformed and impossible dates are rejected ────

test('malformed and impossible dates are rejected with the flag name', () => {
  assert.throws(() => r({ since: '2026-9-1' }, 7), /--since must be YYYY-MM-DD \(got "2026-9-1"\)/);
  assert.throws(() => r({ until: '2026-13-45' }, 7), /--until must be a real date/);
  assert.throws(() => r({ since: '2026-02-31', until: '2026-02-31' }, 1), /--since must be a real date/);
});
