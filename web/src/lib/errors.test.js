// Unit tests for the dashboard's typed edge-function errors and the friendly
// messages the pages render (QA-0928-94 / 95 / 106 / 179).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, edgeError, describeError } from './errors.js';
import { dashboardQuery } from './api.js';

test('a 404 "User not found" becomes a typed user-not-found error', () => {
  const err = edgeError('get-dashboard', 404, '{"error":"User not found"}');
  assert.ok(err instanceof ApiError);
  assert.equal(err.code, 'user-not-found');
  assert.equal(err.status, 404);
  assert.ok(!err.message.includes('{'), 'no raw JSON body in the message');
});

test('a 404 "Session not found" is told apart from a missing user', () => {
  assert.equal(edgeError('get-session', 404, '{"error":"Session not found"}').code, 'not-found');
  assert.equal(edgeError('get-session', 500, 'boom').code, 'http');
  assert.equal(edgeError('get-dashboard', 400, '{"error":"days must be 1-365"}').code, 'bad-request');
});

test('describeError maps user-not-found to the not-yet-synced message', () => {
  const d = describeError(edgeError('get-dashboard', 404, '{"error":"User not found"}'));
  assert.equal(d.title, 'No synced data for this ID yet');
  assert.match(d.message, /wtclaude sync --enable/);
  assert.match(d.message, /privacy preview/);
  assert.equal(d.command, 'wtclaude sync --enable');
  assert.equal(d.detail, null, 'a known state needs no technical detail');
});

// Review follow-up: pages that branch on the kind of failure read
// errorInfo.code instead of parsing the friendly message.
test('describeError carries the error code', () => {
  assert.equal(describeError(edgeError('get-dashboard', 404, '{"error":"User not found"}')).code, 'user-not-found');
  assert.equal(describeError(edgeError('get-dashboard', 500, '')).code, 'http');
  assert.equal(describeError(new TypeError('Failed to fetch')).code, 'network');
  assert.equal(describeError(edgeError('get-session', 404, '{"error":"Session not found"}'), { what: 'session' }).code, 'not-found');
});

test('describeError keeps server detail out of the headline but available', () => {
  const d = describeError(edgeError('get-dashboard', 500, '{"error":"relation does not exist"}'));
  assert.doesNotMatch(d.message, /relation|500|\{/);
  assert.match(d.detail, /500/);
  assert.match(d.detail, /relation does not exist/);
});

test('network failures read as plain, true messages with no internal codes', () => {
  const d = describeError(new TypeError('Failed to fetch'));
  assert.match(d.message, /Couldn.t reach the WTClaude cloud/);
  assert.match(d.message, /wtclaude sync --status/);
  for (const e of [new TypeError('Failed to fetch'), new ApiError('not-configured', 'x'), new ApiError('not-linked', 'x')]) {
    const text = JSON.stringify(describeError(e));
    assert.doesNotMatch(text, /SEC Phase|VITE_DATA_MODE/);
  }
});

test('session detail errors: 404 is "not found", anything else says it could not load', () => {
  const nf = describeError(edgeError('get-session', 404, '{"error":"Session not found"}'), { what: 'session' });
  assert.equal(nf.title, 'Session not found');
  const other = describeError(new TypeError('Failed to fetch'), { what: 'session' });
  assert.equal(other.title, "Couldn't load this session");
});

// Contract B: the client sends the browser's IANA zone with the window.
test('dashboardQuery sends days and the browser time zone', () => {
  assert.deepEqual(dashboardQuery({ days: 90, tz: 'America/New_York' }), { days: '90', tz: 'America/New_York' });
  assert.deepEqual(dashboardQuery({ days: 30 }).days, '30');
  assert.equal(typeof dashboardQuery({ days: 30 }).tz, 'string');
  assert.deepEqual(dashboardQuery({ days: 'x', tz: '' }), { days: '30', tz: 'UTC' });
});
