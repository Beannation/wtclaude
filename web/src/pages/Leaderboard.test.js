// Leaderboard render tests (node --test via src/test-support/jsx.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, text } from '../test-support/jsx.js';

const PAGE = new URL('./Leaderboard.jsx', import.meta.url);

// RC 0.3.2 (dash-prod): the empty state promised "Your totals appear here after
// you opt in and your next wtclaude sync completes". Against a server or CLI
// without the QA-0928-39 opt-in path, an opted-in, synced user stays off the
// board, so the copy may say how a user gets listed but not promise it.
test('Leaderboard empty state explains the opt-in without promising the reader a place', async () => {
  const t = text(await render(PAGE, 'LeaderboardEmpty', { period: 'weekly' }));
  assert.match(t, /No one is on the weekly leaderboard yet\./);
  assert.match(t, /wtclaude share --enable/);
  assert.match(t, /0\.3\.2 or later/);
  assert.doesNotMatch(t, /Your totals appear here/i);
  assert.doesNotMatch(t, /will appear/i);
});
