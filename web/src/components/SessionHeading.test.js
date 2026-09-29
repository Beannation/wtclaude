// SessionHeading render tests (node --test via src/test-support/jsx.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, text } from '../test-support/jsx.js';

const C = new URL('./SessionHeading.jsx', import.meta.url);

// QA-0928-05 (0.3.2): a synced branch is a salted hash; say so on screen.
test('SessionHeading: a hashed branch is labelled hashed, with the upload note as its tooltip', async () => {
  const html = await render(C, 'default', { session: { git_branch: '#0123456789ab', session_id: 'abc' } });
  assert.match(text(html), /^Branch \(hashed\) #0123456789ab$/);
  assert.match(html, /title="Branch names are hashed before upload"/);
});

test('SessionHeading: no branch → the short session id, labelled as a session', async () => {
  const html = await render(C, 'default', { session: { git_branch: null, session_id: 'abcdef0123456789' }, idChars: 8 });
  assert.equal(text(html), 'Session abcdef01');
  assert.doesNotMatch(html, /title=/);
});
