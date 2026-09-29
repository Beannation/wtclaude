// Fixed zone first: the straddling-session fixture below puts turns on local
// days (the CLI's splitHistory), and its synced side reads the same days.
process.env.TZ = 'UTC';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLatestPricing } from '../utils/pricing.js';
import { expectedCost as cliExpectedCost } from '../utils/cost.js';
import { computeWaste as cliComputeWaste } from '../waste/compute.js';
import {
  COMPARE_MODELS as CLI_MODELS, CAVEATS as CLI_CAVEATS, repriceSurface as cliReprice,
  computeComparison as cliCompare, USD_WITHHELD_REASON as CLI_WITHHELD,
} from './compute.js';
import { getModelEntry as cliGetModelEntry } from '../utils/pricing.js';
import {
  PRICING as WEB_PRICING,
  COMPARE_MODELS as WEB_MODELS,
  CAVEATS as WEB_CAVEATS,
  expectedCost as webExpectedCost,
  repriceSurface as webReprice,
  resolveModel as webResolveModel,
  computeComparison as webCompare,
  USD_WITHHELD_REASON as WEB_WITHHELD,
  PLANS as WEB_PLANS,
  codeTurnsFromSessions as webCodeTurns,
} from '../../web/src/lib/compareModels.js';
import { splitHistory } from '../utils/window.js';

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
    // QA-0928-148: partner id shapes — Bedrock's -v1:0 version suffix and its
    // cross-region inference-profile prefixes, and Vertex's @YYYYMMDD version.
    'bedrock/anthropic.claude-opus-5-5-v1:0',
    'anthropic.claude-opus-5-5-v1:0',
    'anthropic.claude-sonnet-5-v2',
    'us.anthropic.claude-opus-5-5-v1:0',
    'eu.anthropic.claude-sonnet-5-v1:0',
    'apac.anthropic.claude-haiku-4-5-20251001-v1:0',
    'global.anthropic.claude-opus-5-5-v1:0',
    'jp.anthropic.claude-sonnet-5-v1:0',
    'au.anthropic.claude-fable-5-1-v1:0',
    'claude-opus-5-5@20260922',
    'vertex_ai/claude-sonnet-5@20260801',
    'us.claude-opus-5-5',
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
    // QA-0928-148: partner ids resolve to the model, flagged partner-served.
    'bedrock/anthropic.claude-opus-5-5-v1:0', 'us.anthropic.claude-opus-5-5-v1:0', 'global.anthropic.claude-sonnet-5-v1:0',
    'claude-opus-5-5@20260922', 'claude-opus-9@20270101',
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

test('CLI and dashboard agree on the monthly delta at a non-30-day window (release review, 2026-09-27)', () => {
  const turns = [{ model: 'claude-opus-5', input_tokens: 1e6, output_tokens: 2e5, cache_read_tokens: 5e6, cache_write_tokens: 1e5 }];
  const cli = cliReprice(turns, { today: '2026-09-27', days: 10 });
  const web = webReprice(turns, { today: '2026-09-27', days: 10 });
  assert.deepEqual(web.models, cli.models);
  for (const m of web.models) {
    assert.ok(Math.abs(m.monthly_delta_vs_baseline_usd - (m.monthly_usd - web.baseline_monthly_usd)) < 1e-6, m.key);
  }
});

// BUILD-018, decision 4 (2026-09-28): the Code surface shows % differences only,
// beside the billed total, on the CLI and the dashboard alike. The whole
// per-surface result is pinned, not just the rates, so the withholding (and the
// coverage-based /mo scaling on Cowork) cannot exist on one side only.
test('CLI and dashboard computeComparison agree field for field, withheld dollars included', () => {
  const t = (model) => ({ model, input_tokens: 400_000, output_tokens: 90_000, cache_read_tokens: 6_000_000, cache_write_tokens: 150_000 });
  const args = {
    codeTurns: [t('claude-opus-5-5[1m]'), t('claude-sonnet-5'), t('claude-opus-9-20270101')],
    coworkTurns: [t('claude-sonnet-5')],
    today: '2026-09-28', days: 30, coveredDays: { code: 30, cowork: 4 },
    billed: { usd: 99.5, anchored_usd: 99.5, estimated_usd: 0, anchored_turns: 3, estimated_turns: 0 },
  };
  const cli = cliCompare(args);
  const web = webCompare(args);
  assert.equal(WEB_WITHHELD, CLI_WITHHELD);
  for (const key of ['code', 'cowork']) {
    const { available, ...w } = web.surfaces[key]; // `available` is the tile's own flag
    assert.deepEqual(w, cli.surfaces[key], `${key} surface drifted`);
  }
  assert.equal(web.surfaces.code.usd_withheld, true);
  assert.ok(web.surfaces.code.models.every(m => m.monthly_usd === null && Number.isInteger(m.delta_pct)));
  assert.equal(web.surfaces.cowork.covered_days, 4);
});

// QA-0928-184 (BUILD-018): /whatif kept its own hard-coded plan table outside
// every parity guard (3 plans; the CLI shows the sheet's 5). The mirror now
// carries every priced plan in the sheet, in sheet order, at the sheet's price.
test('web plan mirror equals the rate sheet\'s priced plans, price for price', () => {
  const sheet = Object.entries(getLatestPricing().plans).filter(([, p]) => p && typeof p === 'object' && p.price_monthly);
  assert.deepEqual(
    WEB_PLANS.map(p => [p.key, p.label, p.price, !!p.per_seat]),
    sheet.map(([k, p]) => [k, p.label, p.price_monthly, !!p.per_seat]),
    'web/src/lib/compareModels.js PLANS drifted from the rate sheet');
});

// ───────────────────────────────────────────────────────────────────────────
// RC 0.3.2 (dash-prod): /compare-models and /whatif re-priced each synced
// session's WHOLE tokens (total_*), so a session that began before the window
// brought its earlier turns into the comparison and the token count differed
// from `wtclaude compare-models --days N`, which re-prices only the turns in
// the window (splitHistory). get-dashboard 0.3.2 sends each session's
// in-window tokens (contract B: window_input_tokens, window_output_tokens,
// window_cache_read_tokens, window_cache_write_tokens), and per-model
// in-window sums (window_models) when the server adds them. Synthetic history,
// in UTC (fixed at the top of this file).
// ───────────────────────────────────────────────────────────────────────────
const START = '2026-09-01';
const END = '2026-09-30';
const turnAt = (ts, model, input, output, read, write) => ({ ts, model, input_tokens: input, output_tokens: output, cache_read_tokens: read, cache_write_tokens: write });
const HISTORY = [
  // Straddles the window, one model: three big turns before it, two in it.
  { session_id: 's-one-model', turns: [
    turnAt('2026-08-20T12:00:00Z', 'claude-opus-5-5', 9_000_000, 400_000, 8_000_000, 900_000),
    turnAt('2026-08-25T12:00:00Z', 'claude-opus-5-5', 7_000_000, 300_000, 6_500_000, 400_000),
    turnAt('2026-08-31T12:00:00Z', 'claude-opus-5-5', 5_000_000, 200_000, 4_600_000, 300_000),
    turnAt('2026-09-02T12:00:00Z', 'claude-opus-5-5', 600_000, 40_000, 500_000, 90_000),
    turnAt('2026-09-03T12:00:00Z', 'claude-opus-5-5', 800_000, 60_000, 700_000, 80_000),
  ] },
  // Straddles the window with a model mix that changes at the boundary: all
  // Sonnet before it, mostly Opus inside it.
  { session_id: 's-mixed', turns: [
    turnAt('2026-08-29T12:00:00Z', 'claude-sonnet-5', 3_000_000, 500_000, 2_500_000, 400_000),
    turnAt('2026-08-30T12:00:00Z', 'claude-sonnet-5', 3_200_000, 450_000, 2_900_000, 250_000),
    turnAt('2026-09-05T12:00:00Z', 'claude-opus-5-5', 1_000_000, 90_000, 900_000, 60_000),
    turnAt('2026-09-06T12:00:00Z', 'claude-opus-5-5', 1_100_000, 70_000, 1_000_000, 50_000),
    turnAt('2026-09-07T12:00:00Z', 'claude-sonnet-5', 400_000, 30_000, 350_000, 40_000),
  ] },
  // Wholly inside the window.
  { session_id: 's-inside', turns: [
    turnAt('2026-09-20T12:00:00Z', 'claude-fable-5-1', 2_000_000, 150_000, 1_800_000, 120_000),
  ] },
];

// What get-dashboard sends for a session: whole-session totals and model
// counts (sessions columns), plus the in-window sums (dashboard_sessions).
function sum(turns, f) { return turns.reduce((a, t) => a + t[f], 0); }
function syncedSession(s, { windowFields = true, windowModels = false } = {}) {
  const inWin = s.turns.filter(t => t.ts.slice(0, 10) >= START && t.ts.slice(0, 10) <= END);
  const models_used = {};
  for (const t of s.turns) models_used[t.model] = (models_used[t.model] || 0) + 1;
  const out = {
    id: s.session_id, models_used, turn_count: s.turns.length,
    total_input_tokens: sum(s.turns, 'input_tokens'), total_output_tokens: sum(s.turns, 'output_tokens'),
    total_cache_read: sum(s.turns, 'cache_read_tokens'), total_cache_write: sum(s.turns, 'cache_write_tokens'),
  };
  if (windowFields) {
    Object.assign(out, {
      window_turn_count: inWin.length,
      window_input_tokens: sum(inWin, 'input_tokens'), window_output_tokens: sum(inWin, 'output_tokens'),
      window_cache_read_tokens: sum(inWin, 'cache_read_tokens'), window_cache_write_tokens: sum(inWin, 'cache_write_tokens'),
    });
  }
  if (windowModels) {
    out.window_models = {};
    for (const t of inWin) {
      const m = (out.window_models[t.model] ||= { usd: 0, turns: 0, excluded_turns: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 });
      m.turns += 1;
      for (const f of ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']) m[f] += t[f];
    }
  }
  return out;
}

const cliWindow = () => cliReprice(splitHistory(HISTORY, START, END).sessions.flatMap(s => s.turns), { today: END, days: 30 });
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: web ${a}, CLI ${b}`);

test('a session that straddles the window: the dashboard re-prices the same in-window tokens as `compare-models --days 30`', () => {
  const cli = cliWindow();
  // The fixture straddles for real: the CLI leaves the earlier turns out.
  assert.equal(cli.turn_count, 6, "2 + 3 + 1 turns in the window");
  const all = cliReprice(HISTORY.flatMap(s => s.turns), { today: END, days: 30 });
  assert.ok(all.tokens.input > 3 * cli.tokens.input, 'whole-session tokens are far above the window\'s');

  // Contract B with per-model in-window sums: identical to the CLI, field for field.
  const exact = webReprice(webCodeTurns(HISTORY.map(s => syncedSession(s, { windowModels: true }))), { today: END, days: 30 });
  assert.deepEqual(exact.tokens, cli.tokens);
  near(exact.baseline_window_usd, cli.baseline_window_usd, 'baseline');
  for (const [i, m] of exact.models.entries()) {
    near(m.window_usd, cli.models[i].window_usd, m.key);
    assert.equal(m.delta_pct, cli.models[i].delta_pct, `${m.key} %`);
  }
  assert.equal(exact.unpriced_turn_count, 0);

  // Contract B without window_models: the in-window tokens are the CLI's; only
  // their split across a session's models is the whole-session turn share.
  const shared = webReprice(webCodeTurns(HISTORY.map(s => syncedSession(s))), { today: END, days: 30 });
  for (const k of Object.keys(cli.tokens)) near(shared.tokens[k], cli.tokens[k], `${k} tokens`);
  // The single-model sessions need no split, so they match the CLI outright.
  const singles = HISTORY.filter(s => s.session_id !== 's-mixed');
  const cliSingles = cliReprice(splitHistory(singles, START, END).sessions.flatMap(s => s.turns), { today: END, days: 30 });
  const webSingles = webReprice(webCodeTurns(singles.map(s => syncedSession(s))), { today: END, days: 30 });
  assert.deepEqual(webSingles.tokens, cliSingles.tokens);
  for (const [i, m] of webSingles.models.entries()) assert.equal(m.delta_pct, cliSingles.models[i].delta_pct, `${m.key} %`);

  // A pre-0.3.2 server sends no window_* fields: whole-session totals, as before.
  const legacy = webReprice(webCodeTurns(HISTORY.map(s => syncedSession(s, { windowFields: false }))), { today: END, days: 30 });
  assert.deepEqual(legacy.tokens, all.tokens);
});

test('a listed session with no turns in the window adds nothing to the comparison', () => {
  // dashboard_session_ids also lists sessions that STARTED in the window; one
  // whose turns all fall outside it (or none synced) has window_turn_count 0.
  const quiet = { ...syncedSession(HISTORY[0]), window_turn_count: 0, window_input_tokens: 0, window_output_tokens: 0, window_cache_read_tokens: 0, window_cache_write_tokens: 0 };
  assert.deepEqual(webCodeTurns([quiet]), []);
  assert.equal(webReprice(webCodeTurns([quiet]), { today: END, days: 30 }).present, false);
});
