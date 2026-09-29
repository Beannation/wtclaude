// The dashboard's Agent-SDK pool state can only change with the rate sheet
// (QA-0928-24). It used to be date-based and "activated" itself on June 15.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as config from './config.js';
import { AGENT_SDK_POOL_PAUSED_NOTE as CLI_NOTE } from '../../../src/utils/config.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

test('AGENT_SDK_POOL mirrors the shipped rate sheet', () => {
  const dir = `${ROOT}src/config`;
  const newest = readdirSync(dir).filter((f) => /^pricing-.*\.json$/.test(f)).sort().pop();
  const sheet = JSON.parse(readFileSync(`${dir}/${newest}`, 'utf8'));
  assert.equal(config.AGENT_SDK_POOL.activated, sheet.agent_sdk_pool.activated === true, `${newest} agent_sdk_pool.activated`);
});

test('the paused-split note is the CLI sentence, verbatim', () => {
  assert.equal(config.AGENT_SDK_POOL_PAUSED_NOTE, CLI_NOTE);
});

test('no date-based pool switch is exported', () => {
  assert.equal(config.dualPoolActive, undefined);
  assert.equal(config.DUAL_POOL_ACTIVATION_DATE, undefined);
});
