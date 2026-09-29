// Runs before React and before the module graph (a plain, synchronous script
// in <head>; a file rather than inline so the CSP can stay script-src 'self').
//
// 1. Theme (QA-0928-97): set data-theme from the saved choice before first
//    paint, so the page and the chart colours start in the right theme.
// 2. Link (contract D, QA-0928-09): `wtclaude dashboard` opens
//    /settings#link=<anonymous id>. Lift the id out of the address bar and
//    history at once and leave it on window.__wtcPendingLink; Settings validates
//    it and asks before replacing a different linked id. The legacy ?link= is
//    still read for one release. With both, the fragment wins and both are
//    stripped. A #link= that arrives without a reload (a same-document
//    navigation while the dashboard is open) is caught by the same listener;
//    each capture bumps window.__wtcLinkSeq and fires a 'wtc:link' event so an
//    open Settings page settles it. Mirrors web/src/lib/link.js extractLink().
(function () {
  try {
    var saved = window.localStorage.getItem('wtclaude_theme');
    window.document.documentElement.setAttribute('data-theme', saved === 'light' ? 'light' : 'dark');
  } catch {
    try { window.document.documentElement.setAttribute('data-theme', 'dark'); } catch { /* no DOM */ }
  }

  function captureLink() {
    try {
      var loc = window.location;
      var qs = (loc.search || '').replace(/^\?/, '');
      var hs = (loc.hash || '').replace(/^#/, '');
      var search = new URLSearchParams(qs);
      var hash = new URLSearchParams(hs);
      var inHash = hash.has('link');
      var inQuery = search.has('link');
      if (!inHash && !inQuery) return;
      var id = inHash ? hash.get('link') : search.get('link');
      // Rebuild only a part that carried an id; any other stays byte-for-byte.
      if (inHash) { hash.delete('link'); hs = hash.toString(); }
      if (inQuery) { search.delete('link'); qs = search.toString(); }
      window.__wtcPendingLink = { id: id, source: inHash ? 'fragment' : 'query' };
      window.__wtcLinkSeq = (window.__wtcLinkSeq || 0) + 1;
      window.history.replaceState(window.history.state, '', loc.pathname + (qs ? '?' + qs : '') + (hs ? '#' + hs : ''));
      window.dispatchEvent(new window.Event('wtc:link'));
    } catch { /* leave the URL alone; Settings reads it directly */ }
  }

  captureLink();
  try {
    window.addEventListener('popstate', captureLink);
    window.addEventListener('hashchange', captureLink);
  } catch { /* no events: the load-time capture above still ran */ }
})();
