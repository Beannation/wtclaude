// One URL form per page (QA-0928-197): every internal link to a built page uses the trailing-
// slash form that the canonical tags, sitemap and breadcrumbs use. The build guard in
// astro.config.mjs runs noSlashPageHrefs over every emitted page; this pins the matcher.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { noSlashPageHrefs } from './url-form.ts';

const PAGES = new Set(['/', '/docs/', '/business/', '/business/audit/', '/blog/', '/blog/the-june-15-split/']);

test('a no-slash link to a built page is flagged, with its query or hash', () => {
  const html = `
    <a href="/docs">x</a>
    <a href='/business/audit?utm_source=share'>x</a>
    <a href="/blog/the-june-15-split#faq">x</a>
    <a href="https://wtclaude.com/business">x</a>`;
  assert.deepEqual(noSlashPageHrefs(html, PAGES), [
    '/docs',
    '/business/audit?utm_source=share',
    '/blog/the-june-15-split#faq',
    'https://wtclaude.com/business',
  ]);
});

test('slash-form links, the root, anchors, files, redirects and other hosts pass', () => {
  const html = `
    <a href="/">x</a> <a href="/#install">x</a> <a href="#top">x</a>
    <a href="/docs/">x</a> <a href="/business/audit/?utm_source=share">x</a> <a href="/docs/#faq">x</a>
    <link rel="canonical" href="https://wtclaude.com/blog/">
    <a href="/favicon.svg">x</a> <a href="/sitemap-index.xml">x</a> <a href="/_astro/a.css">x</a>
    <a href="/dashboard">x</a> <a href="/api/capture-lead">x</a>
    <a href="https://dashboard.wtclaude.com/settings">x</a> <a href="https://github.com/x/docs">x</a>
    <a href="//cdn.example/docs">x</a> <a href="mailto:hi@example.invalid">x</a>`;
  assert.deepEqual(noSlashPageHrefs(html, PAGES), []);
});
