import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getFablePromoCredits } from '../utils/config.js';
import { promoLines } from './fable.js';

// ───────────────────────────────────────────────────────────────────────────
// JOB 0 (BUILD-017, 2026-09-27) — a held release rots. 0.3.1 sat unshipped from
// 2026-09-07 across the Fable 5 promotional-credit expiry, and `wtclaude fable`
// kept printing "Credits expire 2026-09-17 at 11:59 PM PT" in the present tense
// after that instant had passed. These pin BOTH sides of the instant with a
// forced clock — not the date, the instant: 11:59 PM PT on Sep 17 is PDT
// (UTC-7), i.e. 2026-09-18T06:59:00Z.
// ───────────────────────────────────────────────────────────────────────────

const promo = getFablePromoCredits();
const BEFORE = new Date('2026-09-18T06:58:59Z');   // 11:58:59 PM PT, Sep 17
const AT = new Date('2026-09-18T06:59:00Z');       // 11:59:00 PM PT, Sep 17
const AFTER = new Date('2026-09-27T12:00:00Z');

test('promo status flips at 11:59 PM PT on 2026-09-17 — not at UTC midnight, not a day late', () => {
  assert.equal(promo.expires_at, '2026-09-17T23:59:00-07:00');
  assert.equal(promo.status(new Date('2026-09-10T00:00:00Z')), 'active');
  assert.equal(promo.status(new Date('2026-09-18T00:30:00Z')), 'active', 'still Sep 17 in California');
  assert.equal(promo.status(BEFORE), 'active');
  assert.equal(promo.status(AT), 'expired');
  assert.equal(promo.status(AFTER), 'expired');
});

test('before the instant: present tense, with the countdown', () => {
  const lines = promoLines(promo, new Date('2026-09-15T18:00:00Z'), ['fable-5'], '2026-09-15').join('\n');
  assert.match(lines, /Credits expire 2026-09-17 at 11:59 PM PT/);
  assert.match(lines, /2 days from today/);
  const onTheDay = promoLines(promo, new Date('2026-09-17T18:00:00Z'), ['fable-5'], '2026-09-17').join('\n');
  assert.match(onTheDay, /that is today/, 'the last day reads "today", not "0 days from today"');
});

test('after the instant: past tense, and no countdown or present-tense expiry anywhere', () => {
  for (const models of [['fable-5'], ['fable-5', 'fable-5-1'], []]) {
    const lines = promoLines(promo, AFTER, models, '2026-09-27').join('\n');
    assert.match(lines, /Expired 2026-09-17 at 11:59 PM PT/, `${models}: past tense`);
    assert.ok(!/\bexpire\b|\bexpires\b|from today|are spent before/i.test(lines), `${models}: nothing present-tense survives:\n${lines}`);
  }
  // Pinned right at the edge too.
  assert.match(promoLines(promo, AT, ['fable-5'], '2026-09-18').join('\n'), /Expired/);
  assert.match(promoLines(promo, BEFORE, ['fable-5'], '2026-09-17').join('\n'), /Credits expire/);
});

test('after the instant, a Fable-5.1-only window gets no promo block at all', () => {
  // Those credits never applied to Fable 5.1, and once expired there is nothing
  // left to explain. Before expiry the block said "not applicable" — pinned too.
  assert.deepEqual(promoLines(promo, AFTER, ['fable-5-1'], '2026-09-27'), []);
  assert.match(promoLines(promo, BEFORE, ['fable-5-1'], '2026-09-17').join('\n'), /Not applicable to your usage/);
});
