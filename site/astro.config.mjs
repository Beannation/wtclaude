// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';
import { SHOW_DASHBOARD_LINK } from './src/config.ts';

/**
 * Build-time guard: while SHOW_DASHBOARD_LINK is false (SEC Phase C not deployed),
 * fail the build if any emitted page contains a /dashboard link. This makes the SEC
 * gate enforced, not just convention — a stray hardcoded link can't ship by accident.
 */
function dashboardLinkGuard() {
  return {
    name: 'wtclaude:dashboard-link-guard',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        if (SHOW_DASHBOARD_LINK) {
          logger.info('dashboard-link-guard: SHOW_DASHBOARD_LINK=true — link allowed, skipping.');
          return;
        }
        const root = fileURLToPath(dir);
        const offenders = [];
        const walk = (d) => {
          for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, entry.name);
            if (entry.isDirectory()) walk(p);
            else if (entry.name.endsWith('.html')) {
              const html = fs.readFileSync(p, 'utf8');
              if (/href=["']\/dashboard(?:["'/?#])/.test(html)) offenders.push(p);
            }
          }
        };
        walk(root);
        if (offenders.length) {
          throw new Error(
            `[dashboard-link-guard] SHOW_DASHBOARD_LINK is false but a /dashboard link was emitted:\n` +
              offenders.map((o) => `  - ${o}`).join('\n') +
              `\nThe dashboard link is gated until SEC Phase C — do not hardcode it; gate it on SHOW_DASHBOARD_LINK.`,
          );
        }
        logger.info('dashboard-link-guard: OK — no /dashboard links while the SEC gate is off.');
      },
    },
  };
}

// Static SSG → Vercel. Marketing site only (Home, /developers, /complete, /business, blog, docs).
// The /dashboard route is NOT part of this build — it is proxied via vercel.json (infra channel)
// to the separate Phase-0 dashboard app, and is gated OFF until SEC Phase C deploys.
// Sitemap lastmod — stamped at build time (accurate: it's when the deployed site was last built).
const BUILD_LASTMOD = new Date();

export default defineConfig({
  site: 'https://wtclaude.com',
  // Output stays static (default) — every existing page is still prerendered to HTML.
  // The adapter only kicks in for routes marked `export const prerender = false`
  // (currently just /api/capture-lead), which deploy as Vercel Functions.
  adapter: vercel(),
  integrations: [
    sitemap({
      serialize(item) {
        item.lastmod = BUILD_LASTMOD.toISOString();
        return item;
      },
    }),
    dashboardLinkGuard(),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
