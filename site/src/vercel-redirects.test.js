// QA-0928-111: site/vercel.json redirects must match the trailing-slash forms. Compiled with
// @vercel/routing-utils — the package Vercel uses to turn vercel.json `redirects` into routes —
// and matched the way those routes are matched (first `src` regex that fits the path, with any
// `has` host condition), so unreleased config can be checked without hitting production.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTransformedRoutes } from '@vercel/routing-utils';

const cfg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'vercel.json'), 'utf8'));
const { routes, error } = getTransformedRoutes({ redirects: cfg.redirects });

function resolve(host, path) {
  for (const r of routes) {
    if (r.has && !r.has.every((h) => h.type === 'host' && h.value === host)) continue;
    const m = new RegExp(r.src).exec(path);
    if (!m) continue;
    return { status: r.status, location: r.headers.Location.replace(/\$(\d+)/g, (_, i) => m[Number(i)] ?? '') };
  }
  return null; // falls through to the filesystem (200 or 404)
}

const OLD = '/blog/why-your-claude-code-cost-tracker-disagrees-with-your-bill';
const NEW = 'https://wtclaude.com/blog/is-claude-code-cost-accurate/';

test('vercel.json redirects compile', () => assert.equal(error, null));

test('www redirects every path to the apex, the root and slash forms included', () => {
  for (const [path, to] of [
    ['/', 'https://wtclaude.com/'],
    ['/developers', 'https://wtclaude.com/developers'],
    ['/developers/', 'https://wtclaude.com/developers/'],
    ['/blog/is-claude-code-cost-accurate/', 'https://wtclaude.com/blog/is-claude-code-cost-accurate/'],
  ]) assert.deepEqual(resolve('www.wtclaude.com', path), { status: 308, location: to }, path);
});

test('the apex host is not redirected by the www rule', () => {
  assert.equal(resolve('wtclaude.com', '/'), null);
  assert.equal(resolve('wtclaude.com', '/developers/'), null);
});

test('the old blog slug redirects, with and without its trailing slash, to the canonical URL', () => {
  assert.deepEqual(resolve('wtclaude.com', OLD), { status: 308, location: NEW });
  assert.deepEqual(resolve('wtclaude.com', OLD + '/'), { status: 308, location: NEW });
});

test('/dashboard, /dashboard/ and deep dashboard paths go to the dashboard app', () => {
  assert.deepEqual(resolve('wtclaude.com', '/dashboard'), { status: 307, location: 'https://dashboard.wtclaude.com' });
  assert.deepEqual(resolve('wtclaude.com', '/dashboard/'), { status: 307, location: 'https://dashboard.wtclaude.com' });
  assert.deepEqual(resolve('wtclaude.com', '/dashboard/settings'), { status: 307, location: 'https://dashboard.wtclaude.com/settings' });
  assert.equal(resolve('wtclaude.com', '/dashboards'), null);
});
