import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ───────────────────────────────────────────────────────────────────────────
// Contrast gate for the honesty fine print on /compare-models and /whatif
// (QA-0928-186). The caveats rendered in the --faint token at 2.45-2.85:1; they
// carry the honesty copy, so they must meet WCAG AA for body text (4.5:1) in
// both themes. The theme tokens are read from web/src/index.css, so a token
// change that breaks the rule fails here.
// ───────────────────────────────────────────────────────────────────────────

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'src');
const css = readFileSync(join(WEB, 'index.css'), 'utf8');

// Theme token blocks: dark is :root (the default), light is [data-theme="light"].
function tokens(selectorStart) {
  const i = css.indexOf(selectorStart);
  assert.ok(i >= 0, `no ${selectorStart} block in index.css`);
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map(m => [m[1], m[2]]));
}
const THEMES = { dark: tokens(':root,'), light: tokens(':root[data-theme="light"]') };

// WCAG 2.x relative luminance and contrast ratio.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(fg, bg) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + 0.05) / (b + 0.05);
}

const BACKGROUNDS = ['bg', 'card', 'surface'];
const AA = 4.5;

test('the contrast helper matches known WCAG values', () => {
  assert.equal(Math.round(contrast('#000000', '#ffffff') * 10) / 10, 21);
  assert.equal(Math.round(contrast('#5c5c6e', '#161620') * 100) / 100, 2.75, 'the QA log measured --faint at 2.75:1 on dark cards');
});

test('QA-0928-186: the fine-print token on /compare-models and /whatif is 4.5:1 or better in both themes', () => {
  for (const [theme, t] of Object.entries(THEMES)) {
    for (const bg of BACKGROUNDS) {
      const ratio = contrast(t.muted, t[bg]);
      assert.ok(ratio >= AA, `${theme}: --muted ${t.muted} on --${bg} ${t[bg]} is ${ratio.toFixed(2)}:1`);
    }
  }
});

test('QA-0928-186: /compare-models and /whatif set no text in --faint', () => {
  for (const page of ['CompareModels.jsx', 'WhatIf.jsx']) {
    const src = readFileSync(join(WEB, 'pages', page), 'utf8');
    assert.doesNotMatch(src, /text-\[var\(--faint\)\]/, `${page} renders text in --faint`);
  }
});

// The --faint token itself (QA-0928-186, web stream). Every other page sets
// fine print in it: the /context-waste rate lines, the /compare column heads,
// the leaderboard header, the Overview footer, badge descriptions. It used to
// measure 2.45-3.02:1 and was reported here as a diagnostic; it is now raised
// and held to 4.5:1 on every background those lines sit on, in both themes.
test('QA-0928-186: --faint is 4.5:1 or better in both themes', () => {
  for (const [theme, th] of Object.entries(THEMES)) {
    for (const bg of BACKGROUNDS) {
      const ratio = contrast(th.faint, th[bg]);
      assert.ok(ratio >= AA, `${theme}: --faint ${th.faint} on --${bg} ${th[bg]} is ${ratio.toFixed(2)}:1 (under 4.5:1)`);
    }
  }
});

// --faint stays a step below --muted, so the two text levels still read as
// two levels after the raise.
test('QA-0928-186: --faint stays lower-contrast than --muted in both themes', () => {
  for (const [theme, th] of Object.entries(THEMES)) {
    assert.ok(contrast(th.faint, th.card) < contrast(th.muted, th.card), `${theme}: --faint is no longer below --muted`);
  }
});
