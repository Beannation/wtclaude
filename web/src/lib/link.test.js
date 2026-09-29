// Unit tests for linking a browser to an anonymous id (contract D; QA-0928-09,
// QA-0928-43, QA-0928-102). The id is a password equivalent: it travels in the
// URL fragment, is validated, never silently replaces a different id, and is
// stripped from the address bar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { isValidAnonId, extractLink, decideLink, maskId } from './link.js';

const ID = '0f3c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c';
const OTHER = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

test('isValidAnonId accepts UUIDs only', () => {
  assert.equal(isValidAnonId(ID), true);
  assert.equal(isValidAnonId(ID.toUpperCase()), true);
  assert.equal(isValidAnonId(` ${ID} `), true);
  for (const bad of ['hello', '', null, undefined, `${ID}x`, ID.replace(/-/g, '')]) {
    assert.equal(isValidAnonId(bad), false, String(bad));
  }
});

test('extractLink reads #link= and strips it from the URL', () => {
  const r = extractLink(`https://dashboard.wtclaude.com/settings#link=${ID}`);
  assert.equal(r.id, ID);
  assert.equal(r.source, 'fragment');
  assert.equal(r.cleanUrl, '/settings');
});

test('extractLink still reads the legacy ?link= and keeps other params', () => {
  const r = extractLink(`https://dashboard.wtclaude.com/settings?x=1&link=${ID}#top`);
  assert.equal(r.id, ID);
  assert.equal(r.source, 'query');
  assert.equal(r.cleanUrl, '/settings?x=1#top');
});

// Review follow-up: with both forms, the fragment (what the CLI opens) wins
// and BOTH ids leave the address bar — the query one used to stay.
test('extractLink with ?link= and #link= takes the fragment and strips both', () => {
  const r = extractLink(`https://dashboard.wtclaude.com/settings?link=${OTHER}#link=${ID}`);
  assert.equal(r.id, ID);
  assert.equal(r.source, 'fragment');
  assert.equal(r.cleanUrl, '/settings');
  const kept = extractLink(`https://dashboard.wtclaude.com/settings?x=1&link=${OTHER}#link=${ID}&y=2`);
  assert.equal(kept.cleanUrl, '/settings?x=1#y=2');
});

test('extractLink leaves an ordinary URL alone', () => {
  const r = extractLink('https://dashboard.wtclaude.com/sessions?s=abc');
  assert.equal(r.id, null);
  assert.equal(r.cleanUrl, null);
});

test('decideLink: validate, never silently replace a different id', () => {
  assert.equal(decideLink('hello', ''), 'invalid');
  assert.equal(decideLink(ID, ''), 'store');
  assert.equal(decideLink(ID, ID), 'same');
  assert.equal(decideLink(ID, OTHER), 'confirm');
  assert.equal(decideLink(ID, 'garbage-stored-earlier'), 'store', 'an invalid stored value is not a link worth protecting');
});

test('maskId shows only the last four characters', () => {
  const m = maskId(ID);
  assert.ok(m.endsWith('1b0c'));
  assert.ok(!m.includes('0f3c2b1a'));
  assert.equal(maskId(''), '');
});

// The boot script runs before React and before the module graph loads, so the
// id leaves the address bar (and history) at first paint. Run it in a sandbox.
function runBoot(href, stored = {}) {
  const src = readFileSync(fileURLToPath(new URL('../../public/boot.js', import.meta.url)), 'utf8');
  const calls = [];
  const attrs = {};
  const listeners = {};
  const events = [];
  const at = (h) => { const u = new URL(h); return { href: h, pathname: u.pathname, search: u.search, hash: u.hash }; };
  const window = {
    location: at(href),
    // Like the real one, replaceState also changes what location reports.
    history: { state: null, replaceState: (s, t, u) => { calls.push(u); window.location = at(new URL(u, href).href); } },
    localStorage: { getItem: (k) => stored[k] ?? null },
    document: { documentElement: { setAttribute: (k, v) => { attrs[k] = v; } } },
    addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
    dispatchEvent: (e) => { events.push(e.type); return true; },
    Event,
    URLSearchParams,
  };
  window.window = window;
  vm.runInNewContext(src, window);
  // The sandbox's objects come from another realm; copy results into this one.
  const pending = () => (window.__wtcPendingLink == null ? window.__wtcPendingLink : { ...window.__wtcPendingLink });
  // A same-document navigation (only the fragment changes): no reload, so
  // boot.js's listeners are all that see it.
  const navigate = (h) => {
    window.location = at(h);
    for (const type of ['popstate', 'hashchange']) for (const fn of listeners[type] || []) fn({ type });
  };
  return { get pending() { return pending(); }, get seq() { return window.__wtcLinkSeq; }, calls, attrs, events, navigate };
}

test('boot.js captures #link=, strips it with replaceState, and applies the saved theme', () => {
  const { pending, calls, attrs } = runBoot(`https://dashboard.wtclaude.com/settings#link=${ID}`, { wtclaude_theme: 'light' });
  assert.deepEqual(pending, { id: ID, source: 'fragment' });
  assert.deepEqual(calls, ['/settings']);
  assert.equal(attrs['data-theme'], 'light');
});

test('boot.js with ?link= and #link= stores the fragment id and strips both', () => {
  const both = runBoot(`https://dashboard.wtclaude.com/settings?link=${OTHER}#link=${ID}`);
  assert.deepEqual(both.pending, { id: ID, source: 'fragment' });
  assert.deepEqual(both.calls, ['/settings']);
  const kept = runBoot(`https://dashboard.wtclaude.com/settings?x=1&link=${OTHER}#link=${ID}&y=2`);
  assert.deepEqual(kept.calls, ['/settings?x=1#y=2']);
});

// Review follow-up: pasting /settings#link=<id> while the dashboard is open is
// a same-document navigation — no reload, so the load-time capture never saw
// it. boot.js now also listens, strips the id at once, bumps the capture
// counter and tells the page (Settings then asks or links, see Settings.jsx).
test('boot.js captures a #link= that arrives by same-document navigation', () => {
  const b = runBoot('https://dashboard.wtclaude.com/settings');
  assert.equal(b.pending, undefined);
  assert.deepEqual(b.calls, []);
  b.navigate(`https://dashboard.wtclaude.com/settings#link=${ID}`);
  assert.deepEqual(b.pending, { id: ID, source: 'fragment' });
  assert.deepEqual(b.calls, ['/settings'], 'stripped once, even though popstate and hashchange both fire');
  assert.equal(b.seq, 1);
  assert.deepEqual(b.events, ['wtc:link']);
  b.navigate('https://dashboard.wtclaude.com/settings#top');
  assert.equal(b.seq, 1, 'an ordinary fragment is left alone');
  assert.deepEqual(b.calls, ['/settings']);
});

test('boot.js handles the legacy ?link= and does nothing on ordinary URLs', () => {
  const legacy = runBoot(`https://dashboard.wtclaude.com/settings?x=1&link=${ID}#top`);
  assert.deepEqual(legacy.pending, { id: ID, source: 'query' });
  assert.deepEqual(legacy.calls, ['/settings?x=1#top']);
  assert.equal(legacy.attrs['data-theme'], 'dark');
  const plain = runBoot('https://dashboard.wtclaude.com/sessions?s=1');
  assert.equal(plain.pending, undefined);
  assert.deepEqual(plain.calls, []);
});
