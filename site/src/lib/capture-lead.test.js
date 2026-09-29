// /api/capture-lead end to end against an in-memory Twenty CRM (RC check BUILD-018). The network
// is stubbed: globalThis.fetch answers only the fake Twenty host and throws on anything else, and
// Resend / Listmonk stay unconfigured, so no request can leave the process.
// Kept under src/lib (not src/pages) so Astro never routes it.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The endpoint imports its email templates as `*.html?raw` and the contract without an
// extension (Vite resolves both); teach Node the same two things for this test.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.endsWith('?raw')) return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
      try { return next(`${specifier}.ts`, context); } catch { /* fall through */ }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('?raw')) {
      const text = readFileSync(fileURLToPath(url.slice(0, -'?raw'.length)), 'utf8');
      return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
    }
    return next(url, context);
  },
});

const TWENTY = 'http://twenty.stub.invalid/rest';
const BIZ = 'biz-wtclaude';
const people = [];
const contacts = [];
const calls = [];

function twentyStub(url, init = {}) {
  if (!String(url).startsWith(`${TWENTY}/`)) throw new Error(`unexpected network request: ${url}`);
  const method = init.method || 'GET';
  const path = decodeURIComponent(String(url).slice(TWENTY.length + 1));
  const body = init.body ? JSON.parse(init.body) : undefined;
  calls.push({ method, path: path.split('?')[0], body });
  const reply = (obj) => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
  let m;
  if (method === 'GET' && (m = path.match(/^people\?filter=emails\.primaryEmail\[eq\]:([^&]+)/)))
    return reply({ data: { people: people.filter((p) => p.email === m[1]) } });
  if (method === 'POST' && path === 'people') {
    const p = { id: `p${people.length + 1}`, email: body.emails.primaryEmail };
    people.push(p);
    return reply({ data: { createPerson: { id: p.id } } });
  }
  if (method === 'GET' && (m = path.match(/^businessContacts\?filter=personId\[eq\]:([^,]+),businessId\[eq\]:([^&]+)/)))
    return reply({ data: { businessContacts: contacts.filter((c) => c.personId === m[1] && c.businessId === m[2]) } });
  if (method === 'POST' && path === 'businessContacts') {
    const c = { id: `bc${contacts.length + 1}`, ...body };
    contacts.push(c);
    return reply({ data: { createBusinessContact: c } });
  }
  if (method === 'PATCH' && (m = path.match(/^businessContacts\/(.+)$/))) {
    const c = contacts.find((x) => x.id === m[1]);
    Object.assign(c, body);
    return reply({ data: { updateBusinessContact: c } });
  }
  throw new Error(`stub has no route for ${method} ${path}`);
}

let POST;
before(async () => {
  Object.assign(process.env, { TWENTY_API_URL: TWENTY, TWENTY_API_KEY: 'stub-key', WTCLAUDE_BUSINESS_ID: BIZ });
  for (const k of ['RESEND_API_KEY', 'LISTMONK_URL', 'LISTMONK_WTCLAUDE_LIST_ID', 'TWENTY_BUSINESS_CONTACT_PATH']) delete process.env[k];
  globalThis.fetch = async (url, init) => twentyStub(url, init);
  ({ POST } = await import('../pages/api/capture-lead.ts'));
});

async function submit(body) {
  calls.length = 0;
  const request = new Request('http://localhost/api/capture-lead', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const res = await POST({ request, clientAddress: '' });
  assert.equal(res.status, 200, await res.clone().text());
  return calls.filter((c) => c.path.startsWith('businessContacts') && c.method !== 'GET');
}

const EMAIL = 'rerun@example.invalid';
const auditBody = (monthly_rerun) => ({ email: EMAIL, tag: 'spend_audit', source: '/business/audit/', website: '', monthly_rerun });

test('the monthly re-run opt-in survives a later CaptureForm submit and an unticked re-unlock', async () => {
  // 1. The audit, box ticked: a new contact carries the opt-in.
  const [create] = await submit(auditBody(true));
  assert.equal(create.method, 'POST');
  assert.equal(create.body.source, 'spend_audit_monthly_rerun');
  assert.equal(create.body.optInMarketing, false);
  // 2. A CaptureForm signup with marketing consent: consent moves, the opt-in stays.
  const [p2] = await submit({ email: EMAIL, tag: 'guardian', source: '/developers/', website: '', consent: true });
  assert.deepEqual(p2.body, { optInMarketing: true, source: 'guardian_monthly_rerun' });
  // 3. The audit again, box left unticked: still opted in.
  const [p3] = await submit(auditBody(false));
  assert.deepEqual(p3.body, { source: 'spend_audit_monthly_rerun' });
  const stored = contacts.find((c) => c.name === EMAIL);
  assert.equal(stored.source, 'spend_audit_monthly_rerun');
  assert.equal(stored.optInMarketing, true);
});

test('a stale pre-0.3.2 audit tab (consent: false) does not opt a subscriber out', async () => {
  const email = 'subscriber@example.invalid';
  await submit({ email, tag: 'smb', source: '/business/', website: '', consent: true });
  const writes = await submit({ email, tag: 'spend_audit', source: '/business/audit/', website: '', consent: false, monthly_rerun: true });
  for (const w of writes) assert.equal('optInMarketing' in (w.body || {}), false, JSON.stringify(w.body));
  const stored = contacts.find((c) => c.name === email);
  assert.equal(stored.optInMarketing, true);
  assert.equal(stored.source, 'spend_audit_monthly_rerun');
});
