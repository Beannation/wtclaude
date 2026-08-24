import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLatestPricing } from '../utils/pricing.js';
import { COMPARE_MODELS as CLI_MODELS } from './compute.js';
import { PRICING as WEB_PRICING, COMPARE_MODELS as WEB_MODELS } from '../../web/src/lib/compareModels.js';

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

test('web mirror cache multipliers match the shipped sheet', () => {
  const sheet = getLatestPricing().cache;
  assert.equal(WEB_PRICING.cache.read_multiplier, sheet.read_multiplier);
  assert.equal(WEB_PRICING.cache.write_multiplier_5m, sheet.write_multiplier_5m);
  assert.equal(WEB_PRICING.cache.write_multiplier_1h, sheet.write_multiplier_1h);
  assert.equal(WEB_PRICING.cache.write_multiplier, sheet.write_multiplier);
});

test('CLI and dashboard compare the same three models, in the same order', () => {
  assert.deepEqual(WEB_MODELS, CLI_MODELS, 'compare-models drifted between CLI and dashboard');
  assert.equal(CLI_MODELS[0].key, 'opus-5', 'the Opus compared must be CC\'s current default');
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
