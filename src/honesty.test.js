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
