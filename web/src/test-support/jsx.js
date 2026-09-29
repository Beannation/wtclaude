// Test-only helper (never imported by the app, so never bundled). It lets
// `node --test` import the dashboard's .jsx files and render a component to
// static HTML with react-dom/server, so what a page shows — an empty window's
// state, the words on a label — is pinned by a unit test like the lib/ logic.
//
// Two in-thread module hooks: extensionless relative imports resolve the way
// Vite resolves them (.js, then .jsx), and .jsx is compiled with the same oxc
// JSX transform Vite 8 uses (rolldown ships with Vite). Stylesheets and SVGs
// load as empty modules.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'rolldown/experimental';

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.{1,2}\//.test(specifier) && !/\.(jsx?|json|css|svg)$/.test(specifier)) {
      for (const ext of ['.js', '.jsx']) {
        try { return next(specifier + ext, context); } catch { /* try the next extension */ }
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith('file:') && url.endsWith('.jsx')) {
      const file = fileURLToPath(url);
      const { code, errors } = transformSync(file, readFileSync(file, 'utf8'), { jsx: { runtime: 'automatic' } });
      if (errors.length) throw new Error(`${file}: ${errors.map((e) => e.message).join('; ')}`);
      return { format: 'module', source: code, shortCircuit: true };
    }
    if (url.startsWith('file:') && /\.(css|svg)$/.test(url)) {
      return { format: 'module', source: 'export default "";', shortCircuit: true };
    }
    return next(url, context);
  },
});

// Render `exportName` from the module at `url` (a URL or file: href) with
// `props`, inside a MemoryRouter so <Link>/<NavLink> work. → HTML string.
export async function render(url, exportName, props = {}) {
  const [{ createElement }, { renderToStaticMarkup }, { MemoryRouter }, mod] = await Promise.all([
    import('react'), import('react-dom/server'), import('react-router-dom'), import(String(url)),
  ]);
  const Component = mod[exportName];
  if (typeof Component !== 'function') throw new Error(`${url} has no component export "${exportName}"`);
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Component, props)));
}

// The visible text of rendered HTML (tags dropped, entities for & < > " ' decoded,
// whitespace collapsed) — what a test asserts copy against.
export function text(html) {
  return html.replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ').trim();
}
