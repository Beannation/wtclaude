// Linking a browser to an anonymous id (contract D; QA-0928-09 / 43 / 102).
//
// The anonymous id is a password equivalent: whoever holds it reads the
// dashboard. `wtclaude dashboard` opens /settings#link=<id> — a URL fragment is
// never sent to a server or written to a request log. public/boot.js lifts the
// id out of the address bar (and history) with history.replaceState before
// React loads and parks it on window.__wtcPendingLink; Settings then validates
// it and asks before replacing a DIFFERENT id already linked here. The legacy
// ?link= form is still accepted for one release.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidAnonId(id) {
  return typeof id === 'string' && UUID_RE.test(id.trim());
}

// { id, source: 'fragment' | 'query' | null, cleanUrl } for a URL. cleanUrl is
// the same path without the link (for replaceState), or null if none was found.
// With both forms the fragment wins and both are stripped, so neither id stays
// in the address bar. Mirrors public/boot.js, which must run as a plain script
// before any module.
export function extractLink(href) {
  const url = new URL(href, 'https://dashboard.invalid');
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const inHash = hash.has('link');
  const inQuery = url.searchParams.has('link');
  if (!inHash && !inQuery) return { id: null, source: null, cleanUrl: null };
  const id = inHash ? hash.get('link') : url.searchParams.get('link');
  if (inHash) { hash.delete('link'); url.hash = hash.toString(); }
  if (inQuery) url.searchParams.delete('link');
  return { id, source: inHash ? 'fragment' : 'query', cleanUrl: `${url.pathname}${url.search}${url.hash}` };
}

// What to do with an incoming id, given the one stored in this browser:
//   'invalid' — not a UUID: show an error, store nothing
//   'same'    — already linked to it
//   'store'   — nothing (valid) linked yet: link it
//   'confirm' — a DIFFERENT id is linked: ask before replacing it (QA-0928-43)
export function decideLink(pending, current) {
  if (!isValidAnonId(pending)) return 'invalid';
  if (!isValidAnonId(current)) return 'store';
  return pending.trim().toLowerCase() === current.trim().toLowerCase() ? 'same' : 'confirm';
}

// "••••-1b0c" — enough to tell two ids apart, not enough to use one.
export function maskId(id) {
  if (!id) return '';
  return `••••••••-••••-••••-••••-••••••••${String(id).trim().slice(-4)}`;
}

// The id boot.js captured (at load, or from a later same-document #link=
// navigation), if any — read without consuming it, so StrictMode's
// double-invoked initialisers see the same value.
export function peekPendingLink() {
  if (typeof window === 'undefined') return null;
  const p = window.__wtcPendingLink;
  if (p && typeof p.id === 'string') return p;
  // boot.js not loaded (e.g. a test harness): read the address bar directly.
  const r = extractLink(window.location.href);
  if (!r.source) return null;
  window.history.replaceState(window.history.state, '', r.cleanUrl);
  window.__wtcPendingLink = { id: r.id, source: r.source };
  window.__wtcLinkSeq = (window.__wtcLinkSeq || 0) + 1;
  return window.__wtcPendingLink;
}

// How many links this page has captured. A change while Settings is open
// means a new #link= arrived without a reload (useSyncExternalStore store).
export function pendingLinkSeq() {
  return (typeof window !== 'undefined' && window.__wtcLinkSeq) || 0;
}

export function subscribePendingLink(onChange) {
  window.addEventListener('wtc:link', onChange);
  return () => window.removeEventListener('wtc:link', onChange);
}

export function clearPendingLink() {
  if (typeof window !== 'undefined') window.__wtcPendingLink = null;
}
