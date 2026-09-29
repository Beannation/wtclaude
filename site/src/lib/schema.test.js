// QA-0928-197: structured data uses the same URL form as the canonical tags and the sitemap
// (trailing slash), and BlogPosting.dateModified reflects the latest update when one exists.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { breadcrumbs, blogPosting, pagePath } from './schema.ts';

test('breadcrumb items use the canonical trailing-slash form', () => {
  const b = breadcrumbs([
    { name: 'Home', path: '/' },
    { name: 'Blog', path: '/blog' },
    { name: 'Post', path: '/blog/is-claude-code-cost-accurate' },
    { name: 'Already', path: '/docs/' },
  ]);
  assert.deepEqual(b.itemListElement.map((i) => i.item), [
    'https://wtclaude.com/',
    'https://wtclaude.com/blog/',
    'https://wtclaude.com/blog/is-claude-code-cost-accurate/',
    'https://wtclaude.com/docs/',
  ]);
});

test('pagePath adds the slash to page paths only', () => {
  assert.equal(pagePath('/features'), '/features/');
  assert.equal(pagePath('/features/'), '/features/');
  assert.equal(pagePath('/'), '/');
  assert.equal(pagePath('/assets/og-default.png'), '/assets/og-default.png');
  assert.equal(pagePath('/business/audit?utm_source=x'), '/business/audit?utm_source=x');
  assert.equal(pagePath('/docs#faq'), '/docs#faq');
  assert.equal(pagePath('https://example.com/x'), 'https://example.com/x');
});

test('dateModified is the updated date when given, else the publish date', () => {
  const base = { url: 'u', headline: 'h', description: 'd', author: 'a', image: 'i', datePublished: '2026-07-02T00:00:00.000Z' };
  assert.equal(blogPosting(base).dateModified, '2026-07-02T00:00:00.000Z');
  assert.equal(blogPosting({ ...base, dateModified: '2026-09-27T00:00:00.000Z' }).dateModified, '2026-09-27T00:00:00.000Z');
});
