// Dashboard copy + shell gate (BUILD-018, 2026-09-28). The dashboard reaches
// users at the DEPLOY, so a stale sentence here is live the moment it ships.
// Like the CLI honesty gate (src/honesty.test.js) this scans comment-stripped
// source, so comments may still document what was removed and why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../', import.meta.url));

function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '{' && n === '/' && src[i + 2] === '*') { const end = src.indexOf('*/}', i); i = end < 0 ? src.length : end + 3; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

function sourceFiles(dir = join(WEB, 'src'), acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { sourceFiles(p, acc); continue; }
    if (/\.(jsx?)$/.test(p) && !/\.test\./.test(p)) acc.push(p);
  }
  return acc;
}

const BANNED = [
  { pattern: /SEC Phase/i, why: 'Internal project jargon (QA-0928-95). Phase C shipped 2026-06-17; users never needed the code name.' },
  { pattern: /VITE_DATA_MODE\s*=|Data mode:/i, why: 'Build-mode jargon in rendered copy (QA-0928-95 / QA-0928-176).' },
  { pattern: /sync --configure/, why: '`wtclaude sync --configure` was removed; the opt-in is `wtclaude sync --enable` (QA-0928-96).' },
  {
    pattern: /sharpens this|(june[- ]?15|pool split|credit split)[^.\n]{0,60}\b(sharpens|is now active|now live|has activated|countdown|days? (left|until))/i,
    why: 'The June-15 Agent-SDK split is PAUSED; no surface may count down to it or say it refines a figure (QA-0928-24).',
  },
  { pattern: /community benchmarks/i, why: 'No community-benchmarks feature exists (QA-0928-39).' },
  { pattern: /stay on-device/i, why: 'The salted project hash IS synced; say why a signal is missing without an on-device claim (QA-0928-187).' },
  {
    pattern: /Enable sharing with[^.\n]{0,80}to appear/i,
    why: 'share --enable alone does not populate the leaderboard: the opt-in reaches the cloud with your next sync (QA-0928-39).',
  },
  { pattern: /cache hit rate/i, why: 'The stored per-turn tokens are context occupancy, so a cache-read share is not a hit rate (QA-0928-85).' },
  {
    pattern: /anonymous ID[^\n]{0,80}sync --status|sync --status[^\n]{0,40}to see yours/i,
    why: '`wtclaude sync --status` shows only the first 8 characters of the id (QA-0928-41); point to Settings\' Reveal/Copy or `wtclaude dashboard`.',
  },
  {
    pattern: /(MCP tools|memory files)[^.\n]{0,60}(never invoke|lives under)/i,
    why: '`wtclaude waste` inventories skills and subagents; CLAUDE.md files are listed but never judged (QA-0928-71), and it reads no MCP tools.',
  },
  { pattern: /the rate for the model\s+you actually ran/i, why: '`wtclaude waste` prices each model it saw at that model\'s own rate (QA-0928-20).' },
  {
    pattern: /(counted as|the figure is)\s+\$0\b/,
    why: 'A literal "$0" beside converted figures reads wrong in EUR or JPY; say "zero" or format it with the display currency (RC 0.3.2).',
  },
];

test('dashboard copy gate: no banned shapes in rendered strings', () => {
  const hits = [];
  for (const file of sourceFiles()) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const { pattern, why } of BANNED) {
      const m = code.match(pattern);
      if (m) hits.push(`${relative(WEB, file)}: "${m[0]}" — ${why}`);
    }
  }
  assert.deepEqual(hits, [], `\n  Dashboard copy gate failed:\n    ${hits.join('\n    ')}\n`);
});

test('dashboard copy gate self-test: the patterns fire on the old strings', () => {
  const old = [
    'Cloud sync is gated on the SEC Phase C deploy.',
    'Data mode: <code>{DATA_MODE}</code>',
    'cmd="wtclaude sync --configure"',
    'The June-15 pool split sharpens this as more days are tracked.',
    'Control what\'s shared for the leaderboard and community benchmarks.',
    'privacy: salted hashes stay on-device',
    'Enable sharing with <code>wtclaude share --enable</code> to appear on the leaderboard.',
    "{ type: 'efficient_day', label: 'Cache Champion', description: '50%+ cache hit rate in a day' },",
    'Or paste your anonymous ID (<code className="text-[var(--accent)]">wtclaude sync --status</code>):',
    "It looks like xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx — run wtclaude sync --status to see yours.",
    'Always-loaded skills, MCP tools and memory files that you never invoke still get re-read',
    'The full inventory of always-loaded skills, MCP tools and memory files lives under ~/.claude',
    '(<code>wtclaude waste</code> shows the rate for the model\n        you actually ran)',
    '`${fc(rr.dailyAvg)}/day: the last ${rr.days} days ÷ ${rr.days}, idle days counted as $0.`',
    "'Nothing is being re-read, so the figure is $0 — but no rate is named: '",
  ];
  for (const s of old) assert.ok(BANNED.some(({ pattern }) => pattern.test(s)), `should catch: ${s}`);
});

// Canon-owner handoff (compare-waste): the Context Waste fine print and empty-state
// note hard-code which numbers are billing-grade. The honesty labels come from
// computeWaste(), which web-parity pins to the CLI. When the canon owner relabels
// the rate and multiplier (src/waste/compute.js rateLabel plus the web mirror),
// this test fails until the page copy changes in the same commit set. Today the
// labels still say billing-grade, so nothing is flagged yet.
const CONTEXT_WASTE_CLAIMS = [
  { field: 'turns', noun: /\bturns\b/ },
  { field: 'input_rate', noun: /\brate\b/ },
  { field: 'cache_read_multiplier', noun: /\bmultiplier\b/ },
];

function billingGradeClaims(text) {
  const flat = text.replace(/\s+/g, ' ');
  const claims = new Set();
  for (const clause of flat.split(/[.;]/)) {
    if (!/billing-grade/.test(clause)) continue;
    for (const { field, noun } of CONTEXT_WASTE_CLAIMS) if (noun.test(clause)) claims.add(field);
  }
  return claims;
}

test('Context Waste copy calls a number billing-grade only when computeWaste labels it so', async () => {
  const { computeWaste } = await import('./lib/contextWaste.js');
  // One priced model: the case the priced fine print and the empty-state note describe.
  const w = computeWaste({ items: [{ id: 'dead', tokens: 1000 }], usedIds: [], turns: 10, days: 30, model: 'claude-opus-5-5' });
  assert.equal(w.priced, true, 'fixture model must resolve to a rate');
  const page = stripComments(readFileSync(join(WEB, 'src', 'pages', 'ContextWaste.jsx'), 'utf8'));
  const stale = [...billingGradeClaims(page)].filter((field) => w.labels[field] !== 'billing-grade');
  assert.deepEqual(stale, [],
    `ContextWaste.jsx still calls ${stale.join(', ')} billing-grade, but computeWaste labels ` +
    stale.map((f) => `${f} '${w.labels[f]}'`).join(', ') + '. Reword the page copy in the same commit set.');
});

test('Context Waste claim finder self-test: it reads both of today\'s sentences', () => {
  const all = ['turns', 'input_rate', 'cache_read_multiplier'];
  assert.deepEqual([...billingGradeClaims('Token size is an estimate; turns, rate and multiplier are\n   billing-grade.')].sort(), all.sort());
  assert.deepEqual([...billingGradeClaims("Token size is an estimate; turns, input rate and your model's own cache-read multiplier are billing-grade. Verdicts are REVIEW")].sort(), all.sort());
  assert.deepEqual([...billingGradeClaims('billing-grade: turns re-read (your transcript); list rates: the rate and multiplier.')], ['turns']);
  assert.equal(billingGradeClaims('{`$${waste.input_rate}/MTok`} input rate). Token size is an estimate').size, 0);
});

// QA-0928-176: the tab title is the product, not the Vite scaffold default.
test('index.html carries a real title and no inline script', () => {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8');
  assert.match(html, /<title>WTClaude Dashboard<\/title>/);
  // The CSP allows scripts from 'self' only, so the pre-React boot script must be
  // a file, never inline.
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/);
  assert.match(html, /<script src="\/boot\.js"><\/script>/);
});

// QA-0928-101: unknown paths render inside the layout, never a blank page.
test('the router has a catch-all route inside the layout', () => {
  const app = readFileSync(join(WEB, 'src', 'App.jsx'), 'utf8');
  assert.match(app, /<Route path="\*" element={<NotFound \/>} \/>/);
  const layoutOpen = app.indexOf('<Route element={<Layout />}>');
  assert.ok(layoutOpen >= 0 && app.indexOf('path="*"') > layoutOpen, 'catch-all sits inside the Layout route');
});

// QA-0928-188: security headers on the dashboard host.
test('vercel.json sends a CSP and the hardening headers on every path', () => {
  const cfg = JSON.parse(readFileSync(join(WEB, 'vercel.json'), 'utf8'));
  const block = (cfg.headers || []).find((h) => h.source === '/(.*)');
  assert.ok(block, 'a headers block for every path');
  const h = Object.fromEntries(block.headers.map(({ key, value }) => [key.toLowerCase(), value]));
  const csp = h['content-security-policy'] || '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /script-src 'self'(;|$)/, 'no unsafe-inline / unsafe-eval scripts');
  assert.match(csp, /connect-src 'self' https:\/\/[a-z0-9]+\.supabase\.co(;|$)/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.equal(h['referrer-policy'], 'no-referrer');
  assert.equal(h['x-content-type-options'], 'nosniff');
  assert.equal(h['x-frame-options'], 'DENY');
  // The Supabase host in the CSP is the one the dashboard and CLI talk to.
  const sync = readFileSync(join(WEB, '..', 'src', 'sync', 'index.js'), 'utf8');
  const hosted = sync.match(/HOSTED_SUPABASE_URL = '([^']+)'/)[1];
  assert.ok(csp.includes(hosted), `CSP connect-src must include ${hosted}`);
});
