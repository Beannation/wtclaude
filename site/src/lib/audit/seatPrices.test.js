// QA-0928-199: the audit's seat prices are a MIRROR of the shipped rate sheet (Vercel uploads
// only site/, so the site cannot import ../src at build time). This pins the mirror to the
// sheet so it can never drift silently — regenerate with `node scripts/sync-seat-prices.mjs`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEAT_PRICES } from './seatPrices.ts';

const CONFIG = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'src', 'config');

test('site seat-price mirror equals the newest shipped rate sheet', () => {
  const newest = readdirSync(CONFIG).filter((f) => /^pricing-.*\.json$/.test(f)).sort().pop();
  const sheet = JSON.parse(readFileSync(join(CONFIG, newest), 'utf8'));
  assert.equal(SEAT_PRICES.sheet, newest, `mirror was generated from ${SEAT_PRICES.sheet}; the newest sheet is ${newest}`);
  for (const plan of ['team_premium', 'team_standard']) {
    assert.equal(SEAT_PRICES[plan].price_monthly, sheet.plans[plan].price_monthly, `${plan} monthly drifted`);
    assert.equal(SEAT_PRICES[plan].price_monthly_annual_billing, sheet.plans[plan].price_monthly_annual_billing, `${plan} annual drifted`);
  }
});
