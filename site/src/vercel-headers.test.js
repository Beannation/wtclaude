// QA-0928-188 (site half): wtclaude.com must send nosniff, a no-framing header and a
// Referrer-Policy on every path. Compiled with @vercel/routing-utils (the package Vercel uses
// to turn vercel.json `headers` into routes) and matched the way those routes apply: every
// `continue: true` header route whose `src` fits the path adds its headers. No CSP is set
// here on purpose; a CSP needs every page, Umami and the spend audit checked under it first.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getTransformedRoutes } from '@vercel/routing-utils';

const cfg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'vercel.json'), 'utf8'));
const { routes, error } = getTransformedRoutes({ headers: cfg.headers ?? [] });

function headersFor(path) {
  const out = {};
  for (const r of routes) {
    if (!r.continue || !r.headers) continue;
    if (new RegExp(r.src).test(path)) Object.assign(out, r.headers);
  }
  return out;
}

const REQUIRED = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

test('vercel.json headers compile', () => {
  assert.equal(error, null);
  assert.ok(Array.isArray(cfg.headers) && cfg.headers.length > 0, 'vercel.json has no headers block');
});

test('every path gets nosniff, X-Frame-Options DENY and a Referrer-Policy', () => {
  for (const path of [
    '/',
    '/docs/',
    '/features/',
    '/business/audit/',
    '/business/audit/sample/',
    '/blog/is-claude-code-cost-accurate/',
    '/api/capture-lead',
    '/_astro/index.abc123.js',
    '/favicon.svg',
    '/sitemap-index.xml',
    '/404.html',
  ]) {
    const got = headersFor(path);
    for (const [k, v] of Object.entries(REQUIRED)) assert.equal(got[k], v, `${path}: ${k}`);
  }
});
