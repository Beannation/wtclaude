// Route-name helpers (Layout's tab title, phone-menu label and window selector).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pageLabel, isDataRoute, normalizePath } from './routes.js';

// RC 0.3.2: React Router serves /sessions/ and /Settings as the same pages (its
// matching ignores a trailing slash and case), but these helpers compared the
// raw pathname with ===, so the tab title fell back to the bare product name and
// the window selector vanished — on /whatif/ the projection's window could not
// be changed.
test('a trailing slash or different case names the same page', () => {
  assert.equal(pageLabel('/sessions/'), 'Sessions');
  assert.equal(pageLabel('/Settings'), 'Settings');
  assert.equal(pageLabel('/WhatIf//'), 'What If');
  assert.equal(pageLabel('/'), 'Overview');
  assert.equal(pageLabel(''), 'Overview');
  assert.equal(pageLabel('/nope'), '');
});

test('a trailing slash or different case keeps the window selector', () => {
  assert.equal(isDataRoute('/whatif/'), true);
  assert.equal(isDataRoute('/Sessions'), true);
  assert.equal(isDataRoute('/compare-models/'), true);
  assert.equal(isDataRoute('/'), true);
  assert.equal(isDataRoute('/settings/'), false);
  assert.equal(isDataRoute('/leaderboard'), false);
});

test('normalizePath drops trailing slashes and lower-cases', () => {
  assert.equal(normalizePath('/Sessions/'), '/sessions');
  assert.equal(normalizePath('///'), '/');
  assert.equal(normalizePath(undefined), '/');
});
