import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOneShot } from './quality.js';

test('computeOneShot: a target hit once is a one-shot success', () => {
  const r = computeOneShot([
    { session_id: 's1', edit_target_hash: 'aaa' },
    { session_id: 's1', edit_target_hash: 'bbb' },
  ]);
  assert.equal(r.targets, 2);
  assert.equal(r.oneShot, 2);
});

test('computeOneShot: the same target twice in a session is a retry (not one-shot)', () => {
  const r = computeOneShot([
    { session_id: 's1', edit_target_hash: 'aaa' },
    { session_id: 's1', edit_target_hash: 'aaa' },
  ]);
  assert.equal(r.targets, 1);
  assert.equal(r.oneShot, 0);
});

test('computeOneShot: the same hash in different sessions is two separate targets', () => {
  const r = computeOneShot([
    { session_id: 's1', edit_target_hash: 'aaa' },
    { session_id: 's2', edit_target_hash: 'aaa' },
  ]);
  assert.equal(r.targets, 2);
  assert.equal(r.oneShot, 2);
});

test('computeOneShot: turns without an edit_target_hash are ignored (coverage)', () => {
  const r = computeOneShot([
    { session_id: 's1', edit_target_hash: null },
    { session_id: 's1' },
    { session_id: 's1', edit_target_hash: 'aaa' },
  ]);
  assert.equal(r.total, 3);
  assert.equal(r.withHash, 1);
  assert.equal(r.targets, 1);
  assert.equal(r.oneShot, 1);
});

test('computeOneShot: all-null payloads yield zero targets (honest empty state)', () => {
  const r = computeOneShot([{ session_id: 's1' }, { session_id: 's1' }]);
  assert.equal(r.withHash, 0);
  assert.equal(r.targets, 0);
});
