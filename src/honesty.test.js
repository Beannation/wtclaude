import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ───────────────────────────────────────────────────────────────────────────
// THE HONESTY GREP-GATE (charter: "runs before any publish — it has caught live
// overclaims before").
//
// This checks USER-FACING STRINGS, not comments. Comments are stripped first,
// deliberately: several of these banned shapes appear in comments precisely
// because they document what was removed and why, and a gate that fired on those
// would train people to delete the explanation.
// ───────────────────────────────────────────────────────────────────────────

// Strip comments while respecting string and template literals, so that a `//`
// inside a URL or a quote inside a comment cannot confuse the scan.
function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;      // "'" | '"' | '`' when inside a string
  while (i < src.length) {
    const c = src[i], n = src[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (n ?? ''); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  return out;
}

function shippedFiles(dir = join(ROOT, 'src'), acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { shippedFiles(p, acc); continue; }
    // `files` in package.json ships bin/ and src/ but excludes **/*.test.js.
    if (p.endsWith('.js') && !p.endsWith('.test.js')) acc.push(p);
  }
  return acc;
}

const SHIPPED = [...shippedFiles(), join(ROOT, 'bin', 'wtclaude.js')];

// Each rule: a pattern that must not appear in shipped user-facing strings, and
// why it is banned. The `why` is asserted into the failure message so whoever
// trips it learns the reason rather than just deleting the word.
const BANNED = [
  {
    pattern: /credits\s+(do\s*n[o']?t|never)\s+expire/i,
    why: 'Usage credits DO expire — jurisdiction-scoped, from 2026-09-10. The jurisdiction set is not published, so the sentence cannot be made safe by qualifying it.',
  },
  {
    // Targets the CLAIM shape, not the word. "bills from the first token" is a
    // mechanic, not a superlative — a gate that fires on it gets ignored.
    pattern: /\b(the|world'?s)\s+first\s+(accurate|claude|usage|cost|billing|tracker|tool)\b|\bfirst\s+(and\s+)?only\b|\bthe\s+only\s+(tracker|tool|one\s+that)\b/i,
    why: 'HQ honesty rule 1: no "first", no "only" as a product claim.',
  },
  {
    pattern: /step(?:s|ping)?[- ]up to \$3|\$3\s*\/\s*\$15.{0,40}(sept|sep|aug)/i,
    why: 'The Sonnet-5 step-up to $3/$15 was cancelled by Anthropic on 2026-08-10 and must never be presented as upcoming.',
  },
  {
    pattern: /fable\s+cliff|["'“]cliff["'”]|the cliff\b/i,
    why: 'Fable is permanent and plan-conditional since 2026-07-20. There is no cliff; a date cannot answer the question.',
  },
  {
    // WIDENED 2026-09-07. The rule above only caught the WORD "cliff". Both
    // CAVEATS arrays shipped in 0.3.0 with a countdown that never used it —
    // "included up to 50% of your weekly limit through ~July 19 ... then usage
    // credits" — so the gate passed on a false statement about a plan mechanic.
    // This catches the SHAPE: Fable inclusion bounded by a date.
    pattern: /fable[^.]{0,120}?\b(through|until|till|up\s+to)\s+(~\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*-?\s*\d{1,2}|included[^.]{0,80}?\b(through|until)\s+(~\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,
    why: 'Fable inclusion is PLAN-conditional, not date-bounded, since 2026-07-20. The rate sheet\'s `fable` block: the historical boundary date "is NOT a future event and must never be rendered as a countdown."',
  },
  {
    pattern: /(june-?15|billing split)[^.]{0,40}\b(is now active|now live|has activated)/i,
    why: 'The Agent-SDK credit split announced for 2026-06-15 is PAUSED and never took effect.',
  },
  {
    pattern: /anthropic (won'?t|will never|refuses to) build/i,
    why: 'Independence is a trust angle only. Anthropic demonstrably does build in this space.',
  },
  {
    pattern: /\b(2 stars?|two stars?)\b|\bstars?: ?\d+\b/i,
    why: 'Traction figures are removed, not refreshed (the repo reads 0 across the board after an unexplained reset).',
  },
];

// ADDED 2026-09-27 (BUILD-017). "Sonnet 5 is the Claude Code default" has been
// FALSE on every current-facing surface since Claude Code 2.1.280 (2026-09-22):
// Opus 5.5 is the default model on every paid plan, and Pro / Team Standard
// moved from Sonnet to Opus that day. The shape, not the words — "is the new
// default", "Claude Code's default", "the default model is Sonnet 5", "Sonnet 5
// (the new default)". Past tense ("was the default") is history and passes.
// Scoped to CURRENT-FACING surfaces: shipped CLI strings and help, the dashboard,
// site pages, meta descriptions and blog FAQ answers. Dated blog bodies — update
// boxes included — are history and are deliberately NOT scanned.
export const SONNET_DEFAULT = new RegExp([
  String.raw`\bsonnet\s*5\b[^.;!?\n]{0,30}?\b(is|as|remains|becomes)\s+(now\s+)?(the\s+)?(new\s+)?((claude\s+code(['’]s)?|cc(['’]s)?)\s+)?default\b`,
  String.raw`\b(new\s+)?(claude\s+code(['’]s)?\s+)?default(\s+model)?(\s+in\s+claude\s+code)?\s*(is|:|—|–|=|\()\s*(now\s+)?(claude\s+)?sonnet\s*5\b`,
  String.raw`\bsonnet\s*5\s*(\(|,|—|–)\s*(now\s+)?(the\s+|claude\s+code['’]s\s+)(new\s+)?(claude\s+code\s+)?default\b`,
].join('|'), 'i');

BANNED.push({
  pattern: SONNET_DEFAULT,
  why: 'Sonnet 5 has not been the Claude Code default since v2.1.280 (2026-09-22): Opus 5.5 is the default model on every paid plan (CC changelog + model-config docs). PMO wording for the replacement lives in the BUILD-017 kickoff, Job 2.',
});

test('honesty gate self-test: the Sonnet-default pattern catches the shape and passes history', () => {
  const caught = [
    'Sonnet 5 is the Claude Code default',
    'Sonnet 5 is the new default',
    'Sonnet 5 is now the default model',
    'Sonnet 5 (the new default) is cheaper',
    'Sonnet 5, the new Claude Code default,',
    "Claude Code's default model is Sonnet 5",
    'The default model: Sonnet 5',
    'Sonnet 5 at $2/$10 is the default',
  ];
  const passed = [
    'Sonnet 5 was the Claude Code default until v2.1.280',
    'Opus 5.5 is the Claude Code default. Fable 5.1 is the default Fable model, and how Fable bills depends on your plan. Sonnet 5 has the lowest input and output rates of the three.',
    'Sonnet 5 has the lowest input and output rates',
    'Pro and Team Standard moved from Sonnet to Opus',
    'Opus 5.5 is the default; Sonnet 5 stays at $2/$10',
  ];
  for (const t of caught) assert.ok(SONNET_DEFAULT.test(t), `should catch: "${t}"`);
  for (const t of passed) assert.ok(!SONNET_DEFAULT.test(t), `should pass: "${t}"`);
});

// The dashboard is a current-facing surface that reaches users at the DEPLOY.
// Same comment-stripped scan as the CLI, over web/src (tests excluded).
function dashboardFiles(dir = join(ROOT, 'web', 'src'), acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { dashboardFiles(p, acc); continue; }
    if (/\.(jsx?|tsx?)$/.test(p) && !/\.test\./.test(p)) acc.push(p);
  }
  return acc;
}

test('honesty gate: no Sonnet-5-is-the-default claim in the dashboard', () => {
  const hits = [];
  for (const file of dashboardFiles()) {
    const code = stripComments(readFileSync(file, 'utf8'));
    const m = code.match(SONNET_DEFAULT);
    if (m) hits.push(`${relative(ROOT, file)}: "${m[0]}"`);
  }
  assert.deepEqual(hits, [], `\n  Dashboard claims Sonnet 5 is the default:\n    ${hits.join('\n    ')}\n`);
});

test('honesty gate: no banned claim shapes in shipped user-facing strings', () => {
  const hits = [];
  for (const file of SHIPPED) {
    const code = stripComments(readFileSync(file, 'utf8'));
    for (const { pattern, why } of BANNED) {
      const m = code.match(pattern);
      if (m) hits.push(`${relative(ROOT, file)}: matched /${pattern.source}/ on "${m[0]}"\n      WHY BANNED: ${why}`);
    }
  }
  assert.deepEqual(hits, [], `\n  Honesty gate failed:\n    ${hits.join('\n    ')}\n`);
});

test('honesty gate: no banned claim shapes in the CLI help text users actually read', () => {
  // Command descriptions are the most-read strings in the product and the
  // easiest to forget. `fable`'s description carried "the ~July-19 Fable cliff"
  // until 2026-08-24.
  const help = execFileSync(process.execPath, [join(ROOT, 'bin', 'wtclaude.js'), '--help'], {
    encoding: 'utf8', env: { ...process.env, WTCLAUDE_DISABLE: '1' },
  });
  const hits = [];
  for (const { pattern, why } of BANNED) {
    const m = help.match(pattern);
    if (m) hits.push(`--help matched /${pattern.source}/ on "${m[0]}" — ${why}`);
  }
  assert.deepEqual(hits, [], `\n  Honesty gate failed on CLI help:\n    ${hits.join('\n    ')}\n`);
});

test('honesty gate: every credits-denominated surface carries the list-rate label', () => {
  // R-27: pre-purchased bundles cut the effective rate up to 30% and local data
  // cannot see which bundle a user holds, so a credits figure priced at list can
  // overstate the real cost invisibly. Anthropic's own /usage carries the same
  // hedge. Any file that talks about usage credits must carry the label.
  const REQUIRED = 'bundle discounts up to 30% and promos not reflected';
  const mustCarry = ['cli/fable.js', 'cli/credits.js'];
  for (const rel of mustCarry) {
    const src = readFileSync(join(ROOT, 'src', rel), 'utf8');
    assert.ok(src.includes(REQUIRED), `${rel} prints credits figures but is missing the list-rate label: "${REQUIRED}"`);
  }
});

test('honesty gate: the rate sheet never ships a live scheduled step-up unguarded', () => {
  // The Aug-31 detonation shipped as a dated `scheduled` array in a config file.
  // Nothing about that mechanism is wrong, but it must never leave the repo
  // without a test pinning both sides of the date — so the default is "absent".
  const dir = join(ROOT, 'src', 'config');
  const newest = readdirSync(dir).filter(f => f.startsWith('pricing-') && f.endsWith('.json')).sort().pop();
  const sheet = JSON.parse(readFileSync(join(dir, newest), 'utf8'));
  const scheduled = Object.entries(sheet.models).filter(([, m]) => Array.isArray(m.scheduled)).map(([k]) => k);
  assert.deepEqual(scheduled, [], `${newest} carries a scheduled rate change on: ${scheduled.join(', ')}`);
});

// ───────────────────────────────────────────────────────────────────────────
// SITE SCOPE (BUILD-017 Job 2, 2026-09-27). The site is a current-facing surface
// the CLI gate never scanned. Two rules only, deliberately — NOT the whole
// BANNED list: the Sonnet step-up rule above matches the PMO's own true copy
// ("the $3/$15 increase once scheduled for September 1, 2026 was cancelled"),
// and widening every rule to prose would fail on correct sentences.
//
// Scanned: site/src pages, components, layouts and lib, plus each blog post's
// FRONTMATTER description and FAQ answers — both are current-facing (the
// description is the /blog card, meta and JSON-LD; the FAQ is FAQPage JSON-LD).
// NOT scanned: blog bodies, update boxes included — they are dated history.
// HTML comments are scanned because nested ones ship in page source; JSX
// `{/* */}` comments and .astro frontmatter `//` comments never ship.
// ───────────────────────────────────────────────────────────────────────────

// The compare set as it stood before 0.3.1 ("Opus 5, Sonnet 5, and Fable …",
// "Opus 5 · Sonnet 5 …"): once 0.3.1 is live the set is Opus 5.5 / Sonnet 5 /
// Fable 5.1, and a current-facing list naming Opus 5 is stale.
const OLD_COMPARE_SET = /\bopus\s*5\b(?!\.5|-5)[^.\n]{0,12}sonnet\s*5\b[^.\n]{0,24}fable/i;

function stripAstroNonShipping(src) {
  let out = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');              // JSX comments
  const fm = out.match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    const cleaned = fm[1].replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    out = out.replace(fm[1], cleaned);
  }
  return out;
}

function siteFiles(dir = join(ROOT, 'site', 'src'), acc = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === 'content') continue;                              // blog handled below
      siteFiles(p, acc); continue;
    }
    if (/\.(astro|ts|js|mjs)$/.test(name)) acc.push(p);
  }
  return acc;
}

// Frontmatter description + FAQ answers of every blog post. Titles are exempt:
// titles never change (a dated post's title is part of its record).
function blogFrontmatterStrings() {
  const dir = join(ROOT, 'site', 'src', 'content', 'blog');
  const out = [];
  for (const name of readdirSync(dir).filter(n => n.endsWith('.md'))) {
    const fm = readFileSync(join(dir, name), 'utf8').match(/^---\n([\s\S]*?)\n---/);
    if (!fm) continue;
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^\s*(description|a):\s*(.*)$/);
      if (m) out.push({ where: `site/src/content/blog/${name} (${m[1] === 'a' ? 'FAQ answer' : 'description'})`, text: m[2] });
    }
  }
  return out;
}

// Exact, reasoned exemptions — keyed on the surface AND the matched text, so a
// new occurrence anywhere (or a second one on the same surface) still fails.
const SITE_EXEMPT = [
  {
    where: 'site/src/content/blog/state-of-claude-pricing-july-2026.md (description)',
    match: 'Sonnet 5 as the new default',
    why: 'The description opens "A dated record of Claude pricing as it stood on July 8, 2026 —" and lists this as a topic of that snapshot; its own promise ("the update at the top carries the current facts") is kept true by the 2026-09-27 box. Scoped history, not a claim about today.',
  },
];

test('honesty gate (site): no current-facing page, FAQ or description calls Sonnet 5 the default, or names the old compare set', () => {
  const hits = [];
  const check = (where, text) => {
    for (const [rule, re] of [['Sonnet-5-is-the-default', SONNET_DEFAULT], ['old compare set (Opus 5 · Sonnet 5 · Fable)', OLD_COMPARE_SET]]) {
      const all = [...text.matchAll(new RegExp(re.source, 'gi'))];
      for (const m of all) {
        if (SITE_EXEMPT.some(e => e.where === where && e.match === m[0])) continue;
        hits.push(`${where}: ${rule} on "${m[0]}"`);
      }
    }
  };
  for (const file of siteFiles()) {
    const raw = readFileSync(file, 'utf8');
    check(relative(ROOT, file), file.endsWith('.astro') ? stripAstroNonShipping(raw) : stripComments(raw));
  }
  for (const { where, text } of blogFrontmatterStrings()) check(where, text);
  assert.deepEqual(hits, [], `\n  Site honesty gate failed:\n    ${hits.join('\n    ')}\n`);
});

test('honesty gate (site) self-test: the scope can fail — a planted stale line is caught', () => {
  assert.ok(OLD_COMPARE_SET.test('re-prices your recorded usage across Opus 5, Sonnet 5, and Fable 5.1'));
  assert.ok(OLD_COMPARE_SET.test('Opus 5 · Sonnet 5 ($2/$10) · Fable 5.1'));
  assert.ok(!OLD_COMPARE_SET.test('Opus 5.5 ($4/$20) · Sonnet 5 ($2/$10) · Fable 5.1'));
  assert.ok(!OLD_COMPARE_SET.test('across Opus 5.5, Sonnet 5, and Fable 5.1'));
  assert.ok(SONNET_DEFAULT.test(stripAstroNonShipping('---\nconst a = 1;\n---\n<p>Sonnet 5 is the new Claude Code default.</p>')));
  assert.ok(!SONNET_DEFAULT.test(stripAstroNonShipping('---\n// Sonnet 5 is the new default\n---\n<p>{/* Sonnet 5 is the default */}ok</p>')),
    'non-shipping comments are exempt');
  assert.ok(SONNET_DEFAULT.test('<!-- Sonnet 5 is the default -->'), 'HTML comments ship, so they are scanned');
});
