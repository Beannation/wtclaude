// The lead contract shared by /api/capture-lead and every client that POSTs to it
// (QA-0928-30 / -193 / -194). Pure — no network: the Twenty / Resend / Listmonk calls
// live in the endpoint and are never reached from here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEAD_KEYS, EMAIL_MAX, MONTHLY_RERUN_TAG_SUFFIX, TAG_MAX, checkLead, auditLeadBody, repeatSubmitPatch } from './lead-contract.ts';

const base = { email: 'someone@example.invalid', tag: 'spend_audit', source: '/business/audit', website: '', consent: false };

test('every key the spend audit sends is in the shared allow-list (QA-0928-30)', () => {
  const body = auditLeadBody({ email: 'a@example.invalid', tag: 'spend_audit', source: '/business/audit', honeypot: '', rerun: true });
  for (const k of Object.keys(body)) assert.ok(LEAD_KEYS.includes(k), `audit sends "${k}", which the endpoint rejects`);
  assert.equal(checkLead(body).kind, 'ok');
});

test('the audit payload the live bundle sent (with monthly_rerun) is accepted, not a 400', () => {
  for (const monthly_rerun of [true, false]) {
    const r = checkLead({ ...base, monthly_rerun });
    assert.equal(r.kind, 'ok', JSON.stringify(r));
  }
});

test('monthly_rerun rides the existing tag mechanism — no new CRM field', () => {
  assert.equal(checkLead({ ...base, monthly_rerun: true }).tag, 'spend_audit_monthly_rerun');
  assert.equal(checkLead({ ...base, monthly_rerun: false }).tag, 'spend_audit');
  assert.equal(checkLead({ ...base, tag: 'spend_audit_demo', monthly_rerun: true }).tag, 'spend_audit_demo_monthly_rerun');
  // CaptureForm never sends it — its tags are unchanged.
  assert.equal(checkLead({ ...base, tag: 'guardian', consent: true }).tag, 'guardian');
});

test('monthly_rerun must be a boolean', () => {
  const r = checkLead({ ...base, monthly_rerun: 'yes' });
  assert.equal(r.kind, 'reject');
  assert.equal(r.status, 400);
});

test('the surface stays strict: an unknown key is still a 400', () => {
  const r = checkLead({ ...base, total_net_usd: 4920 });
  assert.equal(r.kind, 'reject');
  assert.equal(r.status, 400);
  assert.match(r.error, /total_net_usd/);
});

test('non-object bodies are a 400', () => {
  for (const b of [null, 'x', 42, ['email']]) assert.equal(checkLead(b).kind, 'reject', JSON.stringify(b));
});

test('email: required, valid, and capped at 254 characters (QA-0928-193)', () => {
  assert.equal(checkLead({ ...base, email: '' }).kind, 'reject');
  assert.equal(checkLead({ ...base, email: 'not-an-email' }).kind, 'reject');
  const long = 'a'.repeat(5000) + '@example.invalid';
  const r = checkLead({ ...base, email: long });
  assert.equal(r.kind, 'reject');
  assert.equal(r.status, 400);
  const edge = 'a'.repeat(EMAIL_MAX - '@example.invalid'.length) + '@example.invalid';
  assert.equal(edge.length, EMAIL_MAX);
  assert.equal(checkLead({ ...base, email: edge }).kind, 'ok');
  assert.equal(checkLead({ ...base, email: edge + 'x' }).kind, 'reject');
  assert.equal(EMAIL_MAX, 254);
});

test('email is trimmed and lower-cased; tag and source are clipped', () => {
  const r = checkLead({ ...base, email: '  Some.One@Example.INVALID ', tag: 't'.repeat(100), source: 's'.repeat(400) });
  assert.equal(r.kind, 'ok');
  assert.equal(r.email, 'some.one@example.invalid');
  assert.equal(r.tag.length, 64);
  assert.equal(r.source.length, 256);
});

test('a filled honeypot is a silent bot drop, and the audit really sends it (QA-0928-194)', () => {
  const body = auditLeadBody({ email: 'a@example.invalid', tag: 'spend_audit', source: '/', honeypot: 'http://bot.example', rerun: false });
  assert.equal(body.website, 'http://bot.example');
  assert.equal(checkLead(body).kind, 'bot');
  assert.equal(checkLead({ ...base, website: '   ' }).kind, 'ok', 'whitespace-only is treated as empty, as before');
});

// Review of QA-0928-30: the audit asks no marketing question, so it must not send an answer —
// a `consent: false` from the audit used to opt a CaptureForm subscriber OUT on the repeat-submit PATCH.
test('the audit sends no consent answer at all: the gate asks no marketing question', () => {
  const body = auditLeadBody({ email: 'a@example.invalid', tag: 'spend_audit', source: '/', honeypot: '', rerun: true });
  assert.equal('consent' in body, false, 'the audit body carries no consent key');
  const r = checkLead(body);
  assert.equal(r.kind, 'ok');
  assert.equal(r.consent, undefined, 'no answer stays "no answer", not false');
});

test('consent is optional, but when present it must be a boolean', () => {
  const form = { ...base, tag: 'smb' }; // CaptureForm asks the question; the audit does not
  const { consent: _omit, ...noConsent } = form;
  assert.equal(checkLead(noConsent).consent, undefined);
  assert.equal(checkLead({ ...form, consent: true }).consent, true);
  assert.equal(checkLead({ ...form, consent: false }).consent, false);
  const r = checkLead({ ...base, consent: 'yes' });
  assert.equal(r.kind, 'reject');
  assert.equal(r.status, 400);
});

test('a repeat submit patches optInMarketing ONLY on an explicit consent answer', () => {
  const optedIn = { optInMarketing: true, source: 'smb' };
  // The spend audit (no consent key) never downgrades a CaptureForm opt-in.
  const audit = checkLead(auditLeadBody({ email: 'a@example.invalid', tag: 'spend_audit', source: '/business/audit', honeypot: '', rerun: false }));
  assert.equal('optInMarketing' in repeatSubmitPatch(optedIn, audit), false);
  // CaptureForm's checkbox is an explicit answer — patched either way, as before.
  assert.deepEqual(repeatSubmitPatch(optedIn, checkLead({ ...base, tag: 'smb', consent: false })), { optInMarketing: false });
  assert.deepEqual(repeatSubmitPatch({ optInMarketing: false, source: 'smb' }, checkLead({ ...base, tag: 'smb', consent: true })), { optInMarketing: true });
  // Unchanged values patch nothing.
  assert.deepEqual(repeatSubmitPatch(optedIn, checkLead({ ...base, tag: 'smb', consent: true })), {});
});

test('the monthly-rerun suffix survives the tag clip and the tag stays within 64 characters', () => {
  assert.equal(TAG_MAX, 64);
  const r = checkLead({ ...base, tag: 't'.repeat(100), monthly_rerun: true });
  assert.equal(r.kind, 'ok');
  assert.ok(r.tag.length <= TAG_MAX, `tag is ${r.tag.length} characters`);
  assert.ok(r.tag.endsWith(MONTHLY_RERUN_TAG_SUFFIX), r.tag);
  assert.equal(checkLead({ ...base, tag: 't'.repeat(100), monthly_rerun: false }).tag.length, TAG_MAX);
});

// RC check BUILD-018. The monthly re-run opt-in is stored as the `_monthly_rerun` suffix on the
// Business Contact's one `source` field (no new CRM field). A later submit used to replace the
// whole field, so any other form — or an audit re-unlock with the box left unticked (it defaults
// to unticked) — erased the opt-in. The suffix now carries over; the base tag still tracks the
// latest submit.
const audit = (rerun) => checkLead(auditLeadBody({ email: 'a@example.invalid', tag: 'spend_audit', source: '/business/audit', honeypot: '', rerun }));
const form = (tag, consent) => checkLead({ email: 'a@example.invalid', tag, source: '/developers', website: '', consent });

test('a later CaptureForm submit keeps the monthly re-run opt-in', () => {
  assert.deepEqual(
    repeatSubmitPatch({ optInMarketing: false, source: 'spend_audit_monthly_rerun' }, form('guardian', true)),
    { optInMarketing: true, source: 'guardian_monthly_rerun' },
  );
});

test('an audit re-unlock with the box unticked keeps the opt-in (unticked is "not asked")', () => {
  assert.deepEqual(repeatSubmitPatch({ optInMarketing: true, source: 'guardian_monthly_rerun' }, audit(false)), { source: 'spend_audit_monthly_rerun' });
  assert.deepEqual(repeatSubmitPatch({ source: 'spend_audit_monthly_rerun' }, audit(false)), {});
});

test('the suffix is only ever added by an explicit tick, never invented', () => {
  assert.deepEqual(repeatSubmitPatch({ source: 'guardian' }, audit(true)), { source: 'spend_audit_monthly_rerun' });
  assert.deepEqual(repeatSubmitPatch({ source: 'spend_audit' }, form('guardian', true)), { optInMarketing: true, source: 'guardian' });
  assert.deepEqual(repeatSubmitPatch({ source: 'guardian' }, audit(false)), { source: 'spend_audit' });
});

test('a carried-over suffix still fits: the base is clipped, the suffix is kept whole', () => {
  const patch = repeatSubmitPatch({ source: 'spend_audit_monthly_rerun' }, form('t'.repeat(200), true));
  assert.ok(patch.source.length <= TAG_MAX, `${patch.source.length}`);
  assert.ok(patch.source.endsWith(MONTHLY_RERUN_TAG_SUFFIX), patch.source);
  // No tag: the page path stands in, as before, and keeps the opt-in too.
  const noTag = repeatSubmitPatch({ source: 'spend_audit_monthly_rerun' }, checkLead({ email: 'a@example.invalid', tag: '', source: '/x', website: '' }));
  assert.deepEqual(noTag, { source: '/x_monthly_rerun' });
});

// RC check BUILD-018, deploy window: an audit tab loaded before 0.3.2 still sends `consent: false`
// (it never asked the question). An audit tag's consent is not an answer, so it moves nothing.
test('an audit tag never carries a consent answer, even from a stale pre-0.3.2 tab', () => {
  const legacy = { email: 'a@example.invalid', tag: 'spend_audit', source: '/business/audit/', website: '', consent: false, monthly_rerun: true };
  const r = checkLead(legacy);
  assert.equal(r.kind, 'ok');
  assert.equal(r.consent, undefined);
  assert.equal('optInMarketing' in repeatSubmitPatch({ optInMarketing: true, source: 'guardian' }, r), false);
  assert.equal(checkLead({ ...legacy, tag: 'spend_audit_demo', consent: true }).consent, undefined);
  // CaptureForm's tags keep their answer; a malformed consent is still a 400 on any tag.
  for (const tag of ['guardian', 'smb', 'smb_finance', 'complete']) assert.equal(checkLead({ ...legacy, tag, consent: false }).consent, false, tag);
  assert.equal(checkLead({ ...legacy, consent: 'no' }).kind, 'reject');
});
