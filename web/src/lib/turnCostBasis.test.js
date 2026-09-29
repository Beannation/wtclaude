// The session-detail turn rule (derive.turnCostBasis), pinned against the CLI's
// own turnCostBasis (src/utils/cost.js) on the rows get-session returns.
// Hermetic, like rateLimits.test.js: the CLI module is imported with
// WTCLAUDE_DIR and HOME pointed at an empty temp dir, and only its pure
// functions are called — nothing reads the developer's ~/.claude or ~/.wtclaude.
//
// RC 0.3.2 regression: a turn with no cost_estimate_usd — every unanchored turn
// today's get-session returns (a 0.3.1 sync never sent one, and the 008 schema
// has no such column), and any turn an older CLI syncs after the deploy — read
// as 'not priced' whatever its model, where `wtclaude session` prices a model it
// can price from its tokens ('~$… estimated').
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { turnCostBasis } from './derive.js';

const TMP = mkdtempSync(join(tmpdir(), 'wtc-web-turncost-'));
process.env.WTCLAUDE_DIR = join(TMP, 'wtclaude');
process.env.HOME = TMP;
const cli = await import('../../../src/utils/cost.js');

// The CLI's 'excluded' (usd 0, shown as '—  not priced') is the web's
// 'not-priced' (usd null: no figure).
const asWeb = (c) => (c.basis === 'excluded' ? { usd: null, basis: 'not-priced' } : { usd: c.usd, basis: c.basis });
const close = (a, b) => (a == null || b == null ? a === b : Math.abs(a - b) < 1e-9);

// Synthetic token counts; cache traffic included so the per-model cache-read
// multiplier is exercised.
const TOK = { input_tokens: 12000, output_tokens: 3000, cache_read_tokens: 400000, cache_write_tokens: 20000 };
const ROWS = {
  // Synced by 0.3.1 into today's schema: no estimate key at all.
  'a priceable model with no estimate': { model: 'claude-opus-5-5', ...TOK, cost_usd: null, cumulative_cost_usd: null },
  // After the 009 deploy, a 0.3.1-synced row reads back with the column null.
  'a priceable model whose estimate column is null': { model: 'claude-fable-5-1', ...TOK, cost_usd: null, cumulative_cost_usd: null, cost_estimate_usd: null },
  'a legacy cost_usd 0 with cumulative null': { model: 'claude-sonnet-5', ...TOK, cost_usd: 0, cumulative_cost_usd: null },
  'an unknown model with no estimate': { model: 'claude-mystery-9', ...TOK, cost_usd: null, cumulative_cost_usd: null },
  'a family-fallback model with no estimate': { model: 'claude-opus-5-6', ...TOK, cost_usd: null, cumulative_cost_usd: null },
  'a turn with no model and no estimate': { ...TOK, cost_usd: null },
  'a fast turn with no estimate': { model: 'claude-opus-5-5', speed_tier: 'fast', ...TOK, cost_usd: null, cumulative_cost_usd: null },
  'an anchored turn on a model we cannot price': { model: 'claude-mystery-9', ...TOK, cost_usd: 1.25, cumulative_cost_usd: 9.5 },
  'an anchored $0 turn': { model: 'claude-opus-5-5', ...TOK, cost_usd: 0, cumulative_cost_usd: 9.5 },
  'a zero-token turn on an unknown model': { model: 'claude-mystery-9', input_tokens: 0, output_tokens: 0, cost_usd: null },
};

for (const [name, row] of Object.entries(ROWS)) {
  test(`turnCostBasis matches \`wtclaude session\`: ${name}`, () => {
    const web = turnCostBasis(row);
    const want = asWeb(cli.turnCostBasis(row));
    assert.equal(web.basis, want.basis);
    assert.ok(close(web.usd, want.usd), `${web.usd} vs ${want.usd}`);
  });
}

test('the priceable rows are estimates with a figure, not "not priced"', () => {
  for (const name of ['a priceable model with no estimate', 'a priceable model whose estimate column is null',
    'a legacy cost_usd 0 with cumulative null', 'a fast turn with no estimate']) {
    const b = turnCostBasis(ROWS[name]);
    assert.equal(b.basis, 'estimated', name);
    assert.ok(b.usd > 0, name);
  }
  assert.ok(turnCostBasis(ROWS['a fast turn with no estimate']).usd > turnCostBasis(ROWS['a priceable model with no estimate']).usd,
    'a fast turn is priced at the fast rates, as the CLI prices it');
});

// A 0.3.2 sync sends the CLI's own estimate as cost_estimate_usd (toSyncTurn):
// the page shows it as sent, which is what the CLI shows for the same row.
test('turnCostBasis shows a synced estimate as sent, equal to the CLI figure for the row', () => {
  const row = ROWS['a priceable model with no estimate'];
  const sent = cli.turnCostBasis(row).usd;
  const web = turnCostBasis({ ...row, cost_estimate_usd: sent });
  assert.deepEqual(web, { usd: sent, basis: 'estimated' });
  // An excluded turn goes up with cost_estimate_usd null and stays not priced.
  const excluded = { ...ROWS['an unknown model with no estimate'], cost_estimate_usd: null };
  assert.deepEqual(turnCostBasis(excluded), asWeb(cli.turnCostBasis(excluded)));
});
