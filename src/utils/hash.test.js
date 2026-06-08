import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { saltedHash, generateSalt, newId } from './hash.js';

test('saltedHash is deterministic for the same salt+value', () => {
  assert.equal(saltedHash('abc', '/path/x'), saltedHash('abc', '/path/x'));
});

test('saltedHash changes when the salt changes (per-install isolation)', () => {
  assert.notEqual(saltedHash('salt-A', '/same/path'), saltedHash('salt-B', '/same/path'));
});

test('saltedHash matches the collector algorithm byte-for-byte', () => {
  // The collector computes sha256(salt + ' ' + value).slice(0,12) — see
  // src/collector/index.js shortHash. Keep these in lockstep (R-14).
  const ref = (s, v) => createHash('sha256').update(String(s || '') + ' ' + String(v)).digest('hex').slice(0, 12);
  assert.equal(saltedHash('deadbeef', '/Users/x/proj'), ref('deadbeef', '/Users/x/proj'));
});

test('saltedHash is 12 hex chars', () => {
  assert.match(saltedHash('s', 'v'), /^[0-9a-f]{12}$/);
});

test('the space separator prevents salt/value boundary collisions', () => {
  // Without a separator, ("ab","c") and ("a","bc") would collide.
  assert.notEqual(saltedHash('ab', 'c'), saltedHash('a', 'bc'));
});

test('generateSalt is 32 hex chars and effectively unique', () => {
  const a = generateSalt(), b = generateSalt();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, b);
});

test('newId returns distinct UUIDs', () => {
  assert.notEqual(newId(), newId());
});
