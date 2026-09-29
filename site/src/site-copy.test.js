// Site copy regression gate for the 2026-09-28 clickthrough (QA-0928-117, -118, -119, -120,
// -189, -190, -191, -200). Each rule is a claim that was false about what ships; the source
// must not carry it again. Scans the page/component/layout sources and the named blog posts.
// Dormant SPLIT_LIVE=true restore copy is deliberately not targeted (it only renders on a flip,
// which gets its own review).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));
const read = (rel) => readFileSync(join(SRC, rel), 'utf8');

function files(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'content') files(p, acc); continue; }
    if (/\.(astro|ts)$/.test(name)) acc.push(p);
  }
  return acc;
}
const PAGES = files(SRC);

const BANNED = [
  [/reads the credential/i, 'setup reads no credential — it wires the statusline and creates ~/.wtclaude (QA-0928-119)'],
  [/never lose it/i, 'sync has no restore path — it is not a backup you can restore from (QA-0928-120)'],
  [/\bbackup\b/i, 'sync has no restore path — call it sync, not backup (QA-0928-120)'],
  [/billing-grade cache-read/i, '`waste` prices cache reads at list rates — an estimate (QA-0928-117)'],
  [/(paused|pausing)[^.]{0,60}before June 15/i, 'Anthropic paused the split ON June 15 ("Update June 15: We\'re pausing") (QA-0928-190)'],
  [/and the companion\b/i, 'the companion has not shipped (QA-0928-200)'],
  [/read live/i, 'the limit gauge is the latest status-line snapshot, not a live read (QA-0928-200)'],
  [/lights up (automatically )?(—|-|,)? ?no reinstall|lights up with no reinstall|per-pool, billing-grade, with no/i,
    'activating the split needs a WTClaude update (it reads the shipped rate sheet) and pool attribution is a heuristic (QA-0928-200)'],
  [/a preview of exactly what syncs|preview exactly what would sync/i, 'the sync preview shows counts, not the exact payload (QA-0928-120)'],
  [/cache hit rate/i, 'debrief prints the cache-read share of input-side tokens: context occupancy, not a hit rate (QA-0928-85)'],
  [/sync has cached|enable sync to populate/i, 'nothing writes the usage-credit balance; sync does not fetch it (QA-0928-76, BUILD-028)'],
];

test('no page, component or layout carries a claim that is false about what ships', () => {
  const hits = [];
  for (const f of PAGES) {
    const src = readFileSync(f, 'utf8');
    for (const [re, why] of BANNED) {
      const m = src.match(re);
      if (m) hits.push(`${relative(SRC, f)}: "${m[0]}" — ${why}`);
    }
  }
  assert.deepEqual(hits, [], '\n  ' + hits.join('\n  '));
});

test('the paused-split dating and per-pool claims are fixed in the blog posts named by QA-0928-190/-191', () => {
  const hits = [];
  for (const f of ['the-june-15-split.md', 'claude-billing-changes-june-2026.md', 'state-of-claude-pricing-july-2026.md']) {
    const src = read(join('content', 'blog', f));
    for (const [re, why] of [
      [/(paused|pausing)[^.]{0,60}before June 15/i, 'paused ON June 15'],
      [/`wtclaude today` shows your spend \*\*per-pool\*\*/i, 'today does not split per pool while the split is paused (QA-0928-191)'],
      [/dual-pool view lights up automatically, no reinstall/i, 'needs a WTClaude update (QA-0928-200)'],
    ]) {
      const m = src.match(re);
      if (m) hits.push(`${f}: "${m[0]}" — ${why}`);
    }
  }
  assert.deepEqual(hits, [], '\n  ' + hits.join('\n  '));
});

// /features and /docs badges must agree, and re-priced / waste figures are estimates (QA-0928-117).
function featureBadge(src, name) {
  const i = src.indexOf(`name: '${name}'`);
  assert.ok(i >= 0, `feature "${name}" not found`);
  const block = src.slice(i, src.indexOf('}', i));
  return (block.match(/badge: '([^']+)'/) || [])[1] ?? null;
}
function docsBadge(src, name) {
  const i = src.indexOf(`name: '${name}'`);
  assert.ok(i >= 0, `docs command "${name}" not found`);
  const block = src.slice(i, src.indexOf('desc:', i));
  return (block.match(/badge: '([^']+)'/) || [])[1] ?? null;
}

test('compare-models and waste are labelled estimates, identically on /features and /docs', () => {
  const features = read('pages/features.astro');
  const docs = read('pages/docs.astro');
  assert.equal(featureBadge(features, '`compare-models` (new)'), 'estimate');
  assert.equal(featureBadge(features, '`wtclaude waste` (new)'), 'estimate');
  assert.equal(docsBadge(docs, 'compare-models'), 'estimate');
  assert.equal(docsBadge(docs, 'waste'), 'estimate');
});

test('forecast / credits copy never presents included credits as in effect (QA-0928-118)', () => {
  // The SPLIT_LIVE=false strings: each mention of included credits is conditional on a revised split.
  const lines = [
    ...read('pages/features.astro').split('\n'),
    ...read('pages/docs.astro').split('\n'),
    ...read('pages/developers.astro').split('\n'),
  ];
  // Exempt: the dormant SPLIT_LIVE=true variants (the "with a countdown" / June-14 copy).
  const offenders = lines.filter((l) => /(vs|versus) your included credits/i.test(l) && !/SPLIT_LIVE \?|with a( countdown)?,?$|with a countdown|One line on June 14/.test(l.trim()));
  assert.deepEqual(offenders.map((l) => l.trim()), []);
  assert.doesNotMatch(read('pages/docs.astro'), /credit balance and burn/);
});

// Docs entry for one command, from its name to the end of its desc string.
function docsDesc(src, name) {
  const i = src.indexOf(`name: '${name}'`);
  assert.ok(i >= 0, `docs command "${name}" not found`);
  const d = src.indexOf('desc:', i);
  return src.slice(d, src.indexOf('\n', d));
}
function featureBody(src, name) {
  const i = src.indexOf(`name: '${name}'`);
  assert.ok(i >= 0, `feature "${name}" not found`);
  const b = src.indexOf('body:', i);
  return src.slice(b, src.indexOf('\n', b));
}

test('/docs describes blocks as fixed 5-hour UTC buckets, not the limit window (QA-0928-62)', () => {
  const blocks = docsDesc(read('pages/docs.astro'), 'blocks');
  assert.doesNotMatch(blocks, /rolling|resets on|pace against/i);
  assert.match(blocks, /fixed 5-hour UTC buckets/);
  assert.match(blocks, /not your (plan |subscription )?limit window/);
});

test('waste copy judges skills and subagents; CLAUDE.md files are listed, not judged (QA-0928-71)', () => {
  const texts = {
    features: featureBody(read('pages/features.astro'), '`wtclaude waste` (new)'),
    docs: docsDesc(read('pages/docs.astro'), 'waste'),
  };
  for (const [page, t] of Object.entries(texts)) {
    assert.doesNotMatch(t, /skills and rules/i, page);
    assert.match(t, /skills and subagents/, page);
    assert.match(t, /CLAUDE\.md files are listed as always loaded but not judged/, page);
  }
});

// QA-0928-44: under npx with no global install, `wtclaude setup` won't point Claude Code at
// the npx cache (npm can prune it) and asks for `npm i -g wtclaude` then `wtclaude setup`.
// So no page, post, email or endpoint may tell anyone to install with `npx wtclaude setup`.
function allSources(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === 'node_modules') continue;
    if (statSync(p).isDirectory()) { allSources(p, acc); continue; }
    if (/\.(astro|ts|md|mdx|html|txt|json)$/.test(name)) acc.push(p);
  }
  return acc;
}

test('no site source tells users to set up with npx; the install is global (QA-0928-44)', () => {
  const hits = [];
  for (const f of [...allSources(SRC), ...allSources(join(SRC, '..', 'public'))]) {
    const src = readFileSync(f, 'utf8');
    const m = src.match(/npx\s+(-y\s+)?wtclaude(@[\w.-]+)?\s+setup/);
    if (m) hits.push(`${relative(join(SRC, '..'), f)}: "${m[0]}"`);
  }
  assert.deepEqual(hits, [], '\n  ' + hits.join('\n  '));
  const docs = read('pages/docs.astro');
  assert.match(docs, /npm i -g wtclaude/);
  assert.match(read('config.ts'), /INSTALL_STEPS = \['npm i -g wtclaude', 'wtclaude setup'\]/);
  for (const e of ['confirm-guardian.html', 'confirm-companion.html']) {
    assert.match(read(join('emails', e)), /npm i -g wtclaude[\s\S]{0,200}wtclaude setup/, e);
  }
});

test('/docs tells 0.3.1-and-earlier installs to re-run setup once (QA-0928-10)', () => {
  const docs = read('pages/docs.astro');
  assert.match(docs, /0\.3\.1 or earlier/);
  assert.match(docs, /"type": "command"/);
  assert.match(docs, /wtclaude setup<\/code> once/);
});

// RC check BUILD-018: /docs describes debrief and credits as the 0.3.2 CLI prints them
// (src/cli/debrief.js, src/cli/credits.js), not as they printed before QA-0928-85 / -76.
test('/docs debrief: costliest turn and the cache-read share, no hit rate and no tip (QA-0928-85)', () => {
  const debrief = docsDesc(read('pages/docs.astro'), 'debrief');
  assert.doesNotMatch(debrief, /\btips?\b|your cache hit rate/i);
  assert.match(debrief, /costliest turn/);
  assert.match(debrief, /cache-read share/);
  assert.match(debrief, /not a hit rate/);
});

test('/docs credits: no balance is promised; WTClaude cannot read it yet (QA-0928-76/77)', () => {
  const credits = docsDesc(read('pages/docs.astro'), 'credits');
  assert.doesNotMatch(credits, /once sync|balance once|reported usage-credit balance/i);
  assert.match(credits, /can’t read your usage-credit balance yet/);
  assert.match(credits, /paused/);
});

test('/docs devices: always a local-only view of this machine (QA-0928-64)', () => {
  const devices = docsDesc(read('pages/docs.astro'), 'devices');
  assert.doesNotMatch(devices, /combined|rides cloud sync/i);
  assert.match(devices, /this machine/);
  assert.match(devices, /dashboard/);
});

// RC check BUILD-018: /features pills agree with their bodies while SPLIT_LIVE is false. A body
// that says the feature waits on a future WTClaude update (or on the paused split) is not
// "Available" — the readiness card got this in QA-0928-200; Dual-pool tracking did not.
function featureBlocks(src) {
  return src.split(/\n\s+\{\n\s+name: /).slice(1).map((chunk) => {
    const name = chunk.slice(0, chunk.indexOf('\n'));
    const status = (chunk.match(/\n\s+status: ([^\n]+),\n/) || [])[1] ?? '';
    const b = chunk.indexOf('body:');
    const bodySrc = b >= 0 ? chunk.slice(b, chunk.search(/\n\s+(note:|\},)/)) : '';
    // SPLIT_LIVE=false resolves `SPLIT_LIVE ? a : b` to b, for the status and for the body.
    const offStatus = /^SPLIT_LIVE \?/.test(status) ? status.slice(status.lastIndexOf(':') + 1).trim() : status;
    const offBody = /body: SPLIT_LIVE\s*\n/.test(bodySrc) ? bodySrc.slice(bodySrc.search(/\n\s+: /)) : bodySrc;
    return { name, status: offStatus, body: offBody };
  });
}

test('/features: nothing waiting on a future update or the paused split is marked Available', () => {
  const features = featureBlocks(read('pages/features.astro'));
  assert.ok(features.length > 10, `parsed ${features.length} features`);
  const dual = features.find((f) => /Dual-pool tracking/.test(f.name));
  assert.ok(dual, 'Dual-pool tracking not found');
  const offenders = features
    .filter((f) => f.status === "'available'" && /would light up|needs a WTClaude update|Paused with the split/i.test(f.body))
    .map((f) => f.name);
  assert.deepEqual(offenders, []);
  assert.equal(dual.status, "'paused'");
});
