/**
 * One URL form per page (QA-0928-197). Every built page lives at its trailing-slash URL — the
 * form the canonical tags, sitemap and breadcrumbs use — but with no trailingSlash config both
 * forms serve 200, so a no-slash internal link emits a duplicate URL. The build guard in
 * astro.config.mjs runs this over every emitted page and fails the build on any hit.
 *
 * PURE — no imports, no fs — so it runs under `node --test` as-is.
 */

const SITE_ORIGIN = 'https://wtclaude.com';

/**
 * The href values in `html` that point at a built page without its trailing slash.
 * `pages` holds the built pages' paths in slash form ('/', '/docs/', '/blog/<slug>/').
 * Links that are not pages (files, /api/, redirect sources such as /dashboard, other hosts)
 * pass: only a path whose slash form is a built page is a duplicate.
 */
export function noSlashPageHrefs(html: string, pages: ReadonlySet<string>): string[] {
  const hits: string[] = [];
  for (const m of html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/g)) {
    const href = m[2];
    let rest: string;
    if (href.startsWith(SITE_ORIGIN + '/')) rest = href.slice(SITE_ORIGIN.length);
    else if (href.startsWith('/') && !href.startsWith('//')) rest = href;
    else continue;
    const path = rest.split(/[?#]/)[0];
    if (path.endsWith('/')) continue;
    if (pages.has(`${path}/`)) hits.push(href);
  }
  return hits;
}
