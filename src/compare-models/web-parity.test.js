import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLatestPricing } from '../utils/pricing.js';
import { expectedCost as cliExpectedCost } from '../utils/cost.js';
import { computeWaste as cliComputeWaste } from '../waste/compute.js';
import { COMPARE_MODELS as CLI_MODELS, CAVEATS as CLI_CAVEATS, repriceSurface as cliReprice } from './compute.js';
import { getModelEntry as cliGetModelEntry } from '../utils/pricing.js';
import {
  PRICING as WEB_PRICING,
  COMPARE_MODELS as WEB_MODELS,
  CAVEATS as WEB_CAVEATS,
  expectedCost as webExpectedCost,
  repriceSurface as webReprice,
  resolveModel as webResolveModel,
} from '../../web/src/lib/compareModels.js';

// ───────────────────────────────────────────────────────────────────────────
// S7 / A1 GUARD — the browser dashboard cannot read the rate sheet from disk,
// so web/src/lib/compareModels.js hand-mirrors it. That mirror is exactly the
// kind of independently-maintained price constant that goes stale silently:
// on 2026-08-24 it was still carrying the CANCELLED Sonnet-5 step-up as a dated
// `scheduled` array, which would have fired in every user's browser on Aug-31
// with no deploy and no warning, and a cache write multiplier of 0.25 that
// under-priced writes 8x.
//
// These tests make that class of drift impossible: the mirror must equal the
// shipped sheet, or `npm test` fails before anything publishes.
// ───────────────────────────────────────────────────────────────────────────

test('web mirror covers every model in the shipped rate sheet, at identical rates', () => {
  const sheet = getLatestPricing().models;
  for (const [key, entry] of Object.entries(sheet)) {
    const mirrored = WEB_PRICING.models[key];
    assert.ok(mirrored, `web mirror is missing "${key}" — regenerate web/src/lib/compareModels.js`);
    assert.equal(mirrored.input, entry.input, `${key} input rate drifted`);
    assert.equal(mirrored.output, entry.output, `${key} output rate drifted`);
  }
});

test('web mirror invents no model the shipped sheet does not have', () => {
  const sheet = getLatestPricing().models;
  for (const key of Object.keys(WEB_PRICING.models)) {
    assert.ok(sheet[key], `web mirror has "${key}", which is not in the shipped rate sheet`);
  }
});

test('web mirror carries no scheduled rate change — that is how Aug-31 was armed', () => {
  for (const [key, entry] of Object.entries(WEB_PRICING.models)) {
    assert.equal(entry.scheduled, undefined, `web mirror has a scheduled rate change on "${key}"`);
  }
});

test('web mirror fast_mode matches the sheet — Opus 5.5 / Opus 5 / Opus 4.8 only', () => {
  const sheet = getLatestPricing().models;
  for (const [key, entry] of Object.entries(WEB_PRICING.models)) {
    const hasFast = !!entry.fast_mode;
    assert.equal(hasFast, !!sheet[key].fast_mode, `${key} fast_mode presence drifted`);
    if (hasFast) {
      assert.deepEqual(
        [entry.fast_mode.input, entry.fast_mode.output],
        [sheet[key].fast_mode.input, sheet[key].fast_mode.output],
        `${key} fast_mode rates drifted`);
    }
  }
});

test('web mirror GLOBAL cache multipliers match the shipped sheet', () => {
  const sheet = getLatestPricing().cache;
  assert.equal(WEB_PRICING.cache.read_multiplier, sheet.read_multiplier);
  assert.equal(WEB_PRICING.cache.write_multiplier_5m, sheet.write_multiplier_5m);
  assert.equal(WEB_PRICING.cache.write_multiplier_1h, sheet.write_multiplier_1h);
  assert.equal(WEB_PRICING.cache.write_multiplier, sheet.write_multiplier);
});

// ───────────────────────────────────────────────────────────────────────────
// A3 (2026-09-07). The four assertions above cover the GLOBAL multipliers only.
// That was sufficient while there was one cache-read number in the product; it
// is not sufficient now. Cache-read pricing is per-model, and the mirror could
// carry a correct global 0.1x while missing fable-5-1's 0.025x entirely — the
// mirror would then over-price every Fable 5.1 cache read by 4x, in the browser,
// with every global assertion still green. So the OVERRIDES are pinned too.
// ───────────────────────────────────────────────────────────────────────────

test('web mirror per-model cache-read overrides match the shipped sheet exactly', () => {
  const sheet = getLatestPricing();
  const globalMult = sheet.cache.read_multiplier;
  for (const [key, entry] of Object.entries(sheet.models)) {
    const sheetMult = entry.cache?.read_multiplier ?? globalMult;
    const web = WEB_PRICING.models[key];
    assert.ok(web, `web mirror is missing "${key}"`);
    const webMult = web.cache?.read_multiplier ?? WEB_PRICING.cache.read_multiplier;
    assert.equal(webMult, sheetMult,
      `${key}: cache-read multiplier drifted — sheet says ${sheetMult}, mirror resolves ${webMult}`);
  }
});

test('web mirror invents no cache-read override the shipped sheet does not have', () => {
  // Drift in the other direction: an override added to the mirror alone would
  // UNDER-price that model's cache reads in the browser.
  const sheet = getLatestPricing().models;
  for (const [key, entry] of Object.entries(WEB_PRICING.models)) {
    if (entry.cache?.read_multiplier === undefined) continue;
    assert.equal(entry.cache.read_multiplier, sheet[key]?.cache?.read_multiplier,
      `web mirror has a cache-read override on "${key}" that the shipped sheet does not`);
  }
});

test('web mirror and CLI price a cache read identically, model by model', () => {
  // The end-to-end check: not "do the constants match" but "do the two code
  // paths produce the same dollar figure." 1M cache-read tokens, every model.
  const sheet = getLatestPricing().models;
  for (const key of Object.keys(sheet)) {
    const id = `claude-${key}`;
    const cli = cliExpectedCost(id, 'standard', { cache_read_tokens: 1_000_000 }, '2026-09-07');
    const web = webExpectedCost(id, { cache_read_tokens: 1_000_000 }, '2026-09-07');
    assert.ok(Math.abs(cli - web) < 1e-9,
      `${key}: CLI prices 1M cache reads at $${cli}, dashboard at $${web}`);
  }
});

test('web mirror prices a Fable 5.1 cache read at $0.25/MTok, not $1', () => {
  // Named explicitly, because this is the number the release exists to get
  // right and the mirror is the surface that reaches users without a publish.
  const usd = webExpectedCost('claude-fable-5-1', { cache_read_tokens: 1_000_000 }, '2026-09-07');
  assert.ok(Math.abs(usd - 0.25) < 1e-9, `dashboard priced Fable 5.1 cache reads at $${usd}, expected $0.25`);
  const five = webExpectedCost('claude-fable-5', { cache_read_tokens: 1_000_000 }, '2026-09-07');
  assert.ok(Math.abs(five - 1.00) < 1e-9, `dashboard priced Fable 5 cache reads at $${five}, expected $1.00`);
  assert.ok(Math.abs(five / usd - 4) < 1e-9, 'the 4x divergence must survive in the browser mirror');
});

test('CLI and dashboard compare the same three models, in the same order', () => {
  assert.deepEqual(WEB_MODELS, CLI_MODELS, 'compare-models drifted between CLI and dashboard');
  assert.equal(CLI_MODELS[0].key, 'opus-5-5', 'the Opus compared must be CC\'s current default (Opus 5.5 since 2.1.280)');
  assert.equal(CLI_MODELS[0].label, 'Opus 5.5');
  assert.equal(CLI_MODELS[2].key, 'fable-5-1', 'the Fable compared must be CC\'s current default Fable (since 2.1.257)');
  assert.equal(CLI_MODELS[2].label, 'Fable 5.1');
});

test('the CLI and dashboard caveats carry no Fable date countdown', () => {
  // Both arrays shipped in 0.3.0 with one ("through ~July 19" / "through July
  // 7"). Fable has been plan-conditional, not date-bounded, since 2026-07-20.
  const countdown = /fable[^.]{0,140}?\b(through|until)\s+~?\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
  assert.ok(!countdown.test(CLI_CAVEATS.join(' ')), 'CLI caveats carry a Fable date countdown');
  assert.ok(!countdown.test(WEB_CAVEATS.join(' ')), 'dashboard caveats carry a Fable date countdown');
  for (const blob of [CLI_CAVEATS.join(' '), WEB_CAVEATS.join(' ')]) {
    assert.ok(/plan-conditional/i.test(blob), 'the plan-conditional mechanic must be stated');
  }
});

test('web contextWaste carries the same per-model cache-read overrides as the sheet', async () => {
  // The dashboard's context-waste tile keeps its OWN multiplier. Dead weight is
  // re-read at the CACHE-READ rate on every turn, so that multiplier is the
  // whole dollar figure on the tile — a stale global 0.1x would overstate a
  // Fable 5.1 user's dead weight by 4x.
  const { CACHE_READ_MULTIPLIER_BY_MODEL, computeWaste } = await import('../../web/src/lib/contextWaste.js');
  const sheet = getLatestPricing();
  const globalMult = sheet.cache.read_multiplier;
  for (const [key, entry] of Object.entries(sheet.models)) {
    const declared = entry.cache?.read_multiplier ?? globalMult;
    const web = CACHE_READ_MULTIPLIER_BY_MODEL[key] ?? globalMult;
    assert.equal(web, declared, `contextWaste cache-read multiplier drifted for "${key}"`);
  }
  // End-to-end through the tile's own computation, against the CLI's.
  const items = [{ id: 'a', tokens: 1_000_000 }];
  for (const key of ['opus-5-5', 'fable-5-1', 'fable-5', 'opus-5', 'sonnet-5']) {
    const web = computeWaste({ items, usedIds: [], turns: 1, days: 30, model: key });
    const cli = cliComputeWaste({ items, usedIds: [], turns: 1, days: 30, model: `claude-${key}`, today: '2026-09-27' });
    assert.equal(web.cache_read_multiplier, cli.cache_read_multiplier, `${key} waste multiplier`);
    assert.ok(Math.abs(web.per_turn_usd - cli.per_turn_usd) < 1e-9,
      `${key}: waste tile prices dead weight at $${web.per_turn_usd}/turn, CLI at $${cli.per_turn_usd}`);
  }
  // And the number itself: 1M dead tokens on Fable 5.1 = 1 * 10 * 0.025 = $0.25.
  const f51 = computeWaste({ items, usedIds: [], turns: 1, days: 30, model: 'fable-5-1' });
  assert.ok(Math.abs(f51.per_turn_usd - 0.25) < 1e-9, `expected $0.25/turn, got $${f51.per_turn_usd}`);
});

// B6 (2026-08-24): the CLI learned to handle v2.1.223's provider-prefixed model
// ids; the dashboard mirror had not, so `vertex_ai/claude-sonnet-5` missed every
// key and every alias, fell through the opus-only family fallback, resolved to
// null, and was priced at $0 — silently dropped from the comparison.
test('web mirror parses provider-prefixed model ids the same way the CLI does', async () => {
  const web = await import('../../web/src/lib/compareModels.js');
  const cli = await import('../utils/pricing.js');
  const cases = [
    'vertex_ai/claude-sonnet-5',
    'bedrock/anthropic.claude-opus-5-20260724',
    'anthropic.claude-haiku-4-5',
    'claude-opus-5[1m]',
    'claude-sonnet-5',
  ];
  for (const id of cases) {
    const w = web.parseModelId(id);
    const c = cli.parseModelId(id);
    assert.deepEqual([w.provider, w.key], [c.provider, c.key], `parseModelId drifted on "${id}"`);
  }
});

test('web mirror never prices a provider-prefixed turn at $0', async () => {
  const web = await import('../../web/src/lib/compareModels.js');
  const usd = web.expectedCost('vertex_ai/claude-sonnet-5', { input_tokens: 1_000_000 }, '2026-08-24');
  assert.ok(usd > 0, 'a real Anthropic model behind a provider prefix must not cost $0');
});

// S7: the dashboard's context-waste tile keeps its OWN input-rate table. It was
// missing opus-5 entirely, so every Opus 5 user — Claude Code's default `opus`
// since v2.1.219 — fell through to the Sonnet default of $2 against a real $5.
test('web contextWaste input rates cover the shipped sheet and match it', async () => {
  const { INPUT_RATE_BY_MODEL } = await import('../../web/src/lib/contextWaste.js');
  const sheet = getLatestPricing().models;
  for (const [key, entry] of Object.entries(sheet)) {
    assert.ok(key in INPUT_RATE_BY_MODEL, `contextWaste is missing "${key}" — it will silently use the default rate`);
    assert.equal(INPUT_RATE_BY_MODEL[key], entry.input, `contextWaste input rate drifted for "${key}"`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// BUILD-017 (2026-09-27) — Opus 5.5 and the family-fallback class, in the
// browser. Both mirrors reach users at the DEPLOY. Until this release the compare
// mirror priced an unknown Opus at the newest Opus's rates with NO flag (so every
// Opus 5.5 turn went into "your mix" at Opus 5's rates), and the waste mirror
// priced an unknown model at Sonnet's $2 and called it billing-grade.
// ───────────────────────────────────────────────────────────────────────────

test('web mirror prices an Opus 5.5 cache read at $0.20/MTok, not Opus 5\'s $0.50', () => {
  const usd = webExpectedCost('claude-opus-5-5', { cache_read_tokens: 1_000_000 }, '2026-09-27');
  assert.ok(Math.abs(usd - 0.20) < 1e-9, `dashboard priced Opus 5.5 cache reads at $${usd}, expected $0.20`);
  const five = webExpectedCost('claude-opus-5', { cache_read_tokens: 1_000_000 }, '2026-09-27');
  assert.ok(Math.abs(five / usd - 2.5) < 1e-9, 'the 2.5x divergence must survive in the browser mirror');
  // And its input/output, because Sonnet 5 shares the $0.20 cache read.
  assert.ok(Math.abs(webExpectedCost('claude-opus-5-5', { input_tokens: 1e6, output_tokens: 1e6 }, '2026-09-27') - 24) < 1e-9);
  assert.deepEqual(WEB_PRICING.models['opus-5-5'].fast_mode, { input: 8, output: 40 });
});

test('web mirror resolves ids with the CLI\'s flags — key, fallback, provider, priceable', () => {
  const ids = [
    'claude-opus-5-5', 'claude-opus-5-5[1m]', 'claude-opus-5-5-20260922', 'vertex_ai/claude-opus-5-5',
    'bedrock/anthropic.claude-opus-5-5', 'claude-opus-9-20270101', 'claude-opus-5', 'claude-fable-5-1',
    'claude-fable-9', 'claude-sonnet-9', 'vertex_ai/claude-sonnet-5', '',
  ];
  for (const id of ids) {
    const c = cliGetModelEntry(id);
    const w = webResolveModel(id);
    if (!c) { assert.equal(w, null, `${id}: CLI null, web resolved`); continue; }
    assert.deepEqual([w.key, w.fallback, w.provider, w.priceable], [c.key, c.fallback, c.provider, c.priceable], `${id} drifted`);
  }
});

test('web repriceSurface EXCLUDES and COUNTS what the CLI excludes — identical result on a mixed fixture', () => {
  const t = (model, extra = {}) => ({ model, input_tokens: 400_000, output_tokens: 90_000, cache_read_tokens: 6_000_000, cache_write_tokens: 150_000, ...extra });
  const turns = [
    t('claude-opus-5-5[1m]'), t('claude-opus-5-5'), t('claude-sonnet-5'), t('claude-fable-5-1'),
    t('claude-opus-5'),
    t('claude-opus-9-20270101'),        // family fallback -> excluded
    t('vertex_ai/claude-opus-5-5'),     // partner platform -> excluded
    t('claude-sonnet-9'),               // unresolved -> excluded
  ];
  const cli = cliReprice(turns, { today: '2026-09-27', days: 30 });
  const web = webReprice(turns, { today: '2026-09-27', days: 30 });
  assert.equal(web.unpriced_turn_count, 3, 'the browser must exclude the guess, the partner id and the unknown');
  assert.deepEqual(web.unpriced_models, ['claude-opus-9-20270101', 'vertex_ai/claude-opus-5-5', 'claude-sonnet-9']);
  assert.deepEqual(
    { ...web, models: web.models.map(m => ({ ...m })) },
    { ...cli, models: cli.models.map(m => ({ ...m })) },
    'CLI and dashboard re-pricing drifted');
});

test('an all-Opus-5.5 window is fully priced in both — the 0.3.0 exclusion is closed', () => {
  const turns = [{ model: 'claude-opus-5-5[1m]', input_tokens: 1e6, output_tokens: 1e6, cache_read_tokens: 1e6, cache_write_tokens: 0 }];
  for (const r of [cliReprice(turns, { today: '2026-09-27' }), webReprice(turns, { today: '2026-09-27' })]) {
    assert.equal(r.unpriced_turn_count, 0);
    assert.equal(r.present, true);
    assert.ok(Math.abs(r.baseline_window_usd - 24.2) < 1e-9, `baseline $${r.baseline_window_usd}, expected 4 + 20 + 0.20`);
    const opus = r.models.find(m => m.key === 'opus-5-5');
    assert.ok(Math.abs(opus.delta_vs_baseline_usd) < 1e-9, 'an Opus 5.5 user re-priced to Opus 5.5 nets $0');
  }
});

test('CLI and dashboard caveats are identical, string for string', () => {
  assert.deepEqual(WEB_CAVEATS, CLI_CAVEATS);
  const opus = CLI_CAVEATS.find(c => c.startsWith('Opus 5.5'));
  assert.ok(opus, 'the Opus 5.5 rate caveat is carried');
  assert.match(opus, /\$4\/\$20 per MTok with cache reads at \$0\.20, against Opus 5’s \$5\/\$25 and \$0\.50/);
  assert.match(opus, /20% less in and out, and 60% less on cache reads/);
  assert.ok(!/40%/.test(opus), 'Anthropic\'s "40% less to run" is their claim, never ours');
});

test('web contextWaste withholds exactly where the CLI withholds', async () => {
  const { computeWaste } = await import('../../web/src/lib/contextWaste.js');
  const items = [{ id: 'dead', tokens: 250_000 }];
  for (const model of ['claude-opus-5-5[1m]', 'opus-5-5', 'claude-opus-9-20270101', 'vertex_ai/claude-opus-5-5',
    'claude-sonnet-9', undefined, 'claude-fable-5-1']) {
    const cliModel = model && !model.includes('claude') ? `claude-${model}` : model;
    const w = computeWaste({ items, usedIds: [], turns: 40, days: 30, model });
    const c = cliComputeWaste({ items, usedIds: [], turns: 40, days: 30, model: cliModel, today: '2026-09-27' });
    assert.deepEqual(
      [w.priced, w.unpriced_reason, w.input_rate, w.cache_read_multiplier, w.per_turn_usd, w.monthly_usd, w.labels],
      [c.priced, c.unpriced_reason, c.input_rate, c.cache_read_multiplier, c.per_turn_usd, c.monthly_usd, c.labels],
      `${model}: dashboard and CLI waste drifted`);
  }
  // The specific 0.3.0 failure: an unknown model must not be billing-grade at Sonnet's rate.
  const unknown = computeWaste({ items, usedIds: [], turns: 40, days: 30, model: 'claude-opus-9' });
  assert.notEqual(unknown.input_rate, 2);
  assert.notEqual(unknown.labels.input_rate, 'billing-grade');
});

// Decision locked 2026-08-24: the rate sheet is the single source for prices and
// no surface may hand-maintain a price constant. The two lib mirrors above are
// the sanctioned exception (the browser cannot read the sheet) and are pinned
// here. On 2026-09-27 a THIRD table turned up outside every guard —
// web/src/pages/WhatIf.jsx, typed in during Phase 0 with Opus 4.8 / Sonnet 4.6
// / Haiku 4.5 — so this sweeps the whole dashboard for the shape.
test('no dashboard file outside the two pinned mirrors hand-maintains a price table', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join, relative } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = fileURLToPath(new URL('../../web/src/', import.meta.url));
  const ALLOWED = new Set([
    'lib/compareModels.js', 'lib/contextWaste.js',
    // Mock-mode demo data (VITE_DATA_MODE=mock) — synthetic sessions, never a
    // rate shown against a user's real usage.
    'lib/fixtures.js',
  ]);
  const RATE_TABLE = /\binput\s*:\s*\d+(\.\d+)?\s*,\s*output\s*:\s*\d/;
  const hits = [];
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      const rel = relative(root, p);
      if (!/\.(jsx?|tsx?)$/.test(rel) || ALLOWED.has(rel)) continue;
      if (RATE_TABLE.test(readFileSync(p, 'utf8'))) hits.push(rel);
    }
  };
  walk(root);
  assert.deepEqual(hits, [], `hand-maintained price table outside the pinned mirrors: ${hits.join(', ')}`);
});
