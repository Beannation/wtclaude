/**
 * WTClaude lead-capture endpoint  —  Astro server endpoint, deployed as a Vercel Function.
 * Route: POST /api/capture-lead   (requires the @astrojs/vercel adapter; see astro.config.mjs)
 *
 * Pipeline for a CaptureForm.astro submission:
 *   1. validate + honeypot + best-effort rate-limit
 *   2. Twenty CRM: upsert Person (dedupe on email) -> upsert Business Contact tagged to WTClaude
 *   3. Resend: send the "you're on the list" welcome email  (ONLY on a brand-new subscribe)
 *   4. Listmonk: add subscriber to the WTClaude list         (feature-flagged OFF until deployed)
 *
 * Built to the LIVE form contract (CaptureForm.astro), NOT the runbook draft:
 *   { email, tag, source, website (honeypot), consent }
 *   - consent -> optInMarketing,  tag -> source,  signupDate = server time (form sends no ts)
 *
 * Hard rules:
 *   - Every credential comes from env. Nothing hardcoded.
 *   - Data surface is email + opt-in + tag/source only. Any other field is rejected (400).
 *   - The client never sees an internal error: on a CRM failure we still 200 (and log loudly)
 *     so the UX succeeds and the lead stays recoverable from the function logs.
 *   - The CRM write and the welcome email are independent; one failing must not block the other.
 */

// Branded HTML email templates — synced into site/src/emails/ from the GTM source
// (WTCLAUDE/Build Files/email-templates/). Imported as raw strings, bundled into the
// function at build time (Vercel only uploads site/, so they must live inside it).
import guardianHtml from '../../emails/confirm-guardian.html?raw';
import businessHtml from '../../emails/confirm-business.html?raw';
import financeHtml from '../../emails/confirm-finance.html?raw';
import companionHtml from '../../emails/confirm-companion.html?raw';

// This route is on-demand (not prerendered) — it must run as a Vercel Function.
export const prerender = false;

const TWENTY_API_URL = process.env.TWENTY_API_URL;          // e.g. https://<host>/rest  (no trailing slash)
const TWENTY_API_KEY = process.env.TWENTY_API_KEY;
const WTCLAUDE_BUSINESS_ID = process.env.WTCLAUDE_BUSINESS_ID;
// REST path for the Business Contact custom object. Override if Twenty's plural differs.
const BIZ_CONTACT_PATH = process.env.TWENTY_BUSINESS_CONTACT_PATH || 'businessContacts';

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const WELCOME_FROM = process.env.WELCOME_FROM || 'WTClaude <hello@wtclaude.com>';
const WELCOME_REPLY_TO = process.env.WELCOME_REPLY_TO || ''; // set to the monitored inbox

// Listmonk — OFF until LISTMONK_URL + LISTMONK_WTCLAUDE_LIST_ID are set (runbook step 5).
const LISTMONK_URL = process.env.LISTMONK_URL || '';
const LISTMONK_API_USER = process.env.LISTMONK_API_USER || '';
const LISTMONK_API_TOKEN = process.env.LISTMONK_API_TOKEN || '';
const LISTMONK_WTCLAUDE_LIST_ID = process.env.LISTMONK_WTCLAUDE_LIST_ID || '';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// The ONLY keys the live form sends. Anything else is rejected — keeps the data surface tight.
const ALLOWED_KEYS = new Set(['email', 'tag', 'source', 'website', 'consent']);

/**
 * COPY — verbatim from GTM's authored confirmation emails
 * (WTCLAUDE/Build Files/confirmation-emails-website-captures.md). GTM owns the wording;
 * do not edit copy here — sync from that file. Each `tag` routes to its section (§1–§4).
 * Sent as plain text for exact fidelity (HTML templates are a future GTM deliverable).
 * Transactional: sent regardless of the consent box, once per new subscribe.
 */
const FOOTER =
  'WTClaude is an independent, open-source project — not affiliated with Anthropic. ' +
  "You're getting this because you asked to be notified at wtclaude.com. " +
  'To update your preferences or unsubscribe, just reply to this email.';

const EMAILS: Record<string, { subject: string; body: string }> = {
  // §1 — Guardian waitlist (/developers). Pricing deliberately omitted (GTM note).
  guardian: {
    subject: "You're on the list for WTClaude Guardian",
    body: `Thanks for signing up for Guardian.

Quick context: WTClaude's free tracker already shows your Claude Code cost and
limits — billing-grade, right in your terminal. Guardian is the optional
upgrade that sits on top: proactive limit forecasting, spend recommendations,
and coaching — the "what to do about it," not just the number.

It's still in the works. We'll send you a single note the day it's ready —
no spam in between.

While you wait, the free tracker is live right now:

    npx wtclaude setup

— WTClaude · independent, not affiliated with Anthropic`,
  },
  // §2 — WTClaude for Business waitlist (/business). NO pricing.
  smb: {
    subject: "You're on the list for WTClaude for Business",
    body: `Thanks for signing up for WTClaude for Business.

It's the independent, billing-grade way to run Claude across your team — in one
place instead of five tools: see under the cap in real time, never pay for a
seat nobody's using, and give every team lead their own view. We measure and
recommend; you stay in control of your account.

It's coming soon. We'll send you a single note the day it's ready — no spam.

Want a head start now? The free spend audit finds where your team is overpaying
in about 60 seconds, right in your browser (your data never leaves it):

    → https://wtclaude.com/business/audit

— WTClaude · independent, not affiliated with Anthropic`,
  },
  // §3 — WTClaude for Finance waitlist (/business/finance). NO pricing.
  smb_finance: {
    subject: "You're on the list for WTClaude for Finance",
    body: `Thanks for signing up for WTClaude for Finance.

It's the finance side of WTClaude for Business: allocation and chargeback on
Anthropic's own spend data, a pre-invoice accrual to book against (a clearly
labeled estimate, not the invoice), budget-vs-actual, and a heads-up before the
150-seat cliff — built for whoever has to explain the Claude line item.

It's coming soon. We'll send you a single note the day it's ready — no spam.

In the meantime, the free spend audit shows where the team is overpaying today,
right in your browser:

    → https://wtclaude.com/business/audit

— WTClaude · independent, not affiliated with Anthropic`,
  },
  // §4 — Companion / Complete-User waitlist (/complete).
  complete: {
    subject: "You're on the list for the WTClaude companion",
    body: `Thanks for signing up for the WTClaude companion.

It puts your whole Claude picture in one place — Chat, Cowork, and Code — with
a warning before you hit a limit. It reads the usage data already on your Mac:
no account, no sign-in, and nothing leaves your machine.

It's coming soon, and it'll be free. We'll send you a single note the day it's
ready — no spam.

If you live in the terminal, the free command-line tracker is available right
now:

    npx wtclaude setup

— WTClaude · independent, not affiliated with Anthropic`,
  },
};

// Branded HTML version per tag. Sent as the `html` part (multipart/alternative) with the
// plain-text body above as the automatic fallback. HTML carries its own footer/preheader.
const HTML: Record<string, string> = {
  guardian: guardianHtml,
  smb: businessHtml,
  smb_finance: financeHtml,
  complete: companionHtml,
};

// --- best-effort per-instance rate limit -------------------------------------
// NOTE: serverless instances are ephemeral and not shared, so this only throttles a
// burst hitting the same warm instance. The honeypot is the primary bot defense.
// For real distributed limiting, back this with Vercel KV / Upstash later.
const HITS = new Map<string, number[]>();
function rateLimited(ip: string, windowMs = 60_000, max = 8): boolean {
  if (!ip) return false;
  const now = Date.now();
  const recent = (HITS.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  HITS.set(ip, recent);
  return recent.length > max;
}

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// --- Twenty REST -------------------------------------------------------------
async function twenty(path: string, opts: { method?: string; body?: unknown } = {}) {
  const { method = 'GET', body } = opts;
  const res = await fetch(`${TWENTY_API_URL}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TWENTY_API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const err: any = new Error(`Twenty ${method} /${path} -> ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

// Defensive extractors — absorb envelope variance across Twenty versions.
const firstRecord = (j: any, plural: string) =>
  (j?.data?.[plural] || j?.data?.records || j?.data || j?.records || [])[0] || null;
const createdRecord = (j: any) => {
  const d = j?.data || j;
  if (!d) return null;
  if (d.id) return d; // already flat
  const k = Object.keys(d).find((key) => /^create/i.test(key)); // e.g. createPerson
  return k ? d[k] : d;
};

async function findOrCreatePerson(email: string) {
  const filter = `emails.primaryEmail[eq]:${encodeURIComponent(email)}`;
  const found = await twenty(`people?filter=${filter}&limit=1`);
  const existing = firstRecord(found, 'people');
  if (existing?.id) return { id: existing.id, created: false };
  const made = await twenty('people', { method: 'POST', body: { emails: { primaryEmail: email } } });
  const rec = createdRecord(made);
  if (!rec?.id) throw new Error('Twenty: person create returned no id');
  return { id: rec.id, created: true };
}

async function upsertBusinessContact(args: {
  personId: string; email: string; tag: string; source: string; consent: boolean;
}) {
  const { personId, email, tag, source, consent } = args;
  const filter = `personId[eq]:${personId},businessId[eq]:${WTCLAUDE_BUSINESS_ID}`;
  const found = await twenty(`${BIZ_CONTACT_PATH}?filter=${filter}&limit=1`);
  const existing = firstRecord(found, BIZ_CONTACT_PATH) || firstRecord(found, 'businessContacts');

  if (existing?.id) {
    // Repeat submit — refresh opt-in / source if changed; never touch stage or original signupDate.
    const patch: Record<string, unknown> = {};
    if (existing.optInMarketing !== consent) patch.optInMarketing = consent;
    const newSource = tag || source || '';
    if (newSource && existing.source !== newSource) patch.source = newSource;
    if (Object.keys(patch).length) {
      await twenty(`${BIZ_CONTACT_PATH}/${existing.id}`, { method: 'PATCH', body: patch });
    }
    return { id: existing.id, created: false };
  }

  const made = await twenty(BIZ_CONTACT_PATH, {
    method: 'POST',
    body: {
      personId,
      businessId: WTCLAUDE_BUSINESS_ID,
      name: email,
      source: tag || source || '',
      optInMarketing: consent === true,
      signupDate: new Date().toISOString(),
      lifecycleStage: 'SUBSCRIBER',
    },
  });
  const rec = createdRecord(made);
  return { id: rec?.id || null, created: true };
}

// --- Resend ------------------------------------------------------------------
// Returns true if an email was sent, false if there's no template for this tag
// (unknown tag -> recorded in CRM but intentionally not emailed: never send unapproved copy).
async function sendWelcome(email: string, tag: string): Promise<boolean> {
  const tmpl = EMAILS[tag];
  if (!tmpl) return false;
  const payload: Record<string, unknown> = {
    from: WELCOME_FROM,
    to: [email],
    subject: tmpl.subject,
    text: `${tmpl.body}\n\n${FOOTER}`,
  };
  const html = HTML[tag];
  if (html) payload.html = html; // multipart/alternative: HTML + plain-text fallback
  if (WELCOME_REPLY_TO) payload.reply_to = WELCOME_REPLY_TO;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Resend -> ${res.status}: ${await res.text()}`);
  return true;
}

// --- Listmonk (feature-flagged off) -----------------------------------------
async function addToListmonk(email: string) {
  if (!LISTMONK_URL || !LISTMONK_WTCLAUDE_LIST_ID) return; // not configured -> skip
  const auth = Buffer.from(`${LISTMONK_API_USER}:${LISTMONK_API_TOKEN}`).toString('base64');
  const res = await fetch(`${LISTMONK_URL}/api/subscribers`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      name: '',
      status: 'enabled',
      lists: [Number(LISTMONK_WTCLAUDE_LIST_ID)],
      preconfirm_subscriptions: true,
    }),
  });
  if (!res.ok) throw new Error(`Listmonk -> ${res.status}`);
}

// --- handler -----------------------------------------------------------------
export const POST = async ({ request, clientAddress }: { request: Request; clientAddress: string }) => {
  // Fail safe if misconfigured (missing required server env) — never block the UX.
  if (!TWENTY_API_URL || !TWENTY_API_KEY || !WTCLAUDE_BUSINESS_ID) {
    console.error('[capture] missing required env (TWENTY_API_URL / TWENTY_API_KEY / WTCLAUDE_BUSINESS_ID)');
    return json({ ok: true });
  }

  const ip = (request.headers.get('x-forwarded-for') || clientAddress || '').split(',')[0].trim();
  if (rateLimited(ip)) return json({ error: 'slow down' }, 429);

  const data = await request.json().catch(() => null);
  if (!data || typeof data !== 'object') return json({ error: 'invalid body' }, 400);

  // Strict surface — reject any unexpected key rather than silently ignoring it.
  const extra = Object.keys(data).filter((k) => !ALLOWED_KEYS.has(k));
  if (extra.length) return json({ error: `unexpected fields: ${extra.join(', ')}` }, 400);

  // Honeypot — bots fill the off-screen "website" field. Pretend success, store nothing.
  if (data.website && String(data.website).trim() !== '') return json({ ok: true });

  const email = String(data.email || '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return json({ error: 'valid email required' }, 400);

  const tag = data.tag ? String(data.tag).slice(0, 64) : '';
  const source = data.source ? String(data.source).slice(0, 256) : '';
  const consent = data.consent === true;

  // --- CRM write (source of truth). On failure: log the lead + still 200. ---
  let isNewSubscribe = false;
  try {
    const person = await findOrCreatePerson(email);
    const bc = await upsertBusinessContact({ personId: person.id, email, tag, source, consent });
    isNewSubscribe = bc.created;
  } catch (err: any) {
    // Don't lose the lead: it's recoverable from this log line.
    console.error('[capture] TWENTY_WRITE_FAILED', JSON.stringify({ email, tag, source, consent }),
      err.status || '', err.message, err.body ? JSON.stringify(err.body) : '');
    return json({ ok: true });
  }

  // --- welcome email — only on a genuinely new subscribe, never blocks the response.
  // Transactional: sent regardless of the consent box (they joined this waitlist explicitly). ---
  if (isNewSubscribe && RESEND_API_KEY) {
    try {
      const sent = await sendWelcome(email, tag);
      if (!sent) console.warn('[capture] no email template for tag', JSON.stringify(tag), '- recorded in CRM, no welcome sent');
    } catch (err: any) { console.error('[capture] RESEND_FAILED', email, err.message); }
  }

  // --- Listmonk — non-fatal, off until configured ---
  if (isNewSubscribe) {
    try { await addToListmonk(email); }
    catch (err: any) { console.error('[capture] LISTMONK_FAILED', email, err.message); }
  }

  return json({ ok: true });
};

// The form only POSTs. Any other method gets a clean 405 (not a 500).
export const ALL = () =>
  new Response(JSON.stringify({ error: 'method not allowed' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'POST' },
  });
