import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLatestPricing } from '../utils/pricing.js';
import { expectedCost as cliExpectedCost } from '../utils/cost.js';
import { computeWaste as cliComputeWaste } from '../waste/compute.js';
import { COMPARE_MODELS as CLI_MODELS, CAVEATS as CLI_CAVEATS } from './compute.js';
import {
  PRICING as WEB_PRICING,
  COMPARE_MODELS as WEB_MODELS,
  CAVEATS as WEB_CAVEATS,
  expectedCost as webExpectedCost,
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

test('web mirror fast_mode matches the sheet — Opus 5 / Opus 4.8 only', () => {
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
  assert.equal(CLI_MODELS[0].key, 'opus-5', 'the Opus compared must be CC\'s current default');
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
  for (const key of ['fable-5-1', 'fable-5', 'opus-5', 'sonnet-5']) {
    const web = computeWaste({ items, usedIds: [], turns: 1, days: 30, model: key });
    const cli = cliComputeWaste({ items, usedIds: [], turns: 1, days: 30, model: `claude-${key}`, today: '2026-09-07' });
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
