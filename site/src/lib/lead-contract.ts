/**
 * The ONE lead-capture contract — imported by the endpoint (/api/capture-lead) and by the
 * spend audit's client (lib/audit/app.ts), so the two can never drift apart again.
 *
 * QA-0928-30: the audit started sending `monthly_rerun` on 2026-06-23; the endpoint's strict
 * allow-list (landed 2026-06-28) did not know it, so every audit lead was rejected with a 400
 * the client never checked. One list, one validator, one unit test that every key the audit
 * sends is allowed.
 *
 * PURE — no imports, no network, no env — so it runs under `node --test` as-is.
 */

/** The only keys a lead POST may carry. Anything else is rejected (400) — keeps the surface tight. */
export const LEAD_KEYS = ['email', 'tag', 'source', 'website', 'consent', 'monthly_rerun'] as const;
export type LeadKey = (typeof LEAD_KEYS)[number];

/** RFC 5321 caps a forward/reverse path at 256 octets incl. the angle brackets → 254 for the address. */
export const EMAIL_MAX = 254;
export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The monthly-reminder opt-in rides the EXISTING tag mechanism (the tag becomes the Business
 * Contact's `source` in Twenty) — no new CRM field. `spend_audit` + opt-in → `spend_audit_monthly_rerun`.
 * Once stored, the suffix is sticky: a later submit changes the base tag but keeps the suffix
 * (see repeatSubmitPatch). Only a tick adds it; nothing on the site removes it (no opt-out control
 * yet — an unticked box means "not asked"), so an opt-out is a manual CRM edit on request.
 */
export const MONTHLY_RERUN_TAG_SUFFIX = '_monthly_rerun';
/** Longest tag stored — the suffix included (it is kept whole; the base tag is clipped instead). */
export const TAG_MAX = 64;
/** Longest page path stored as `source` when a submit has no tag. */
export const SOURCE_MAX = 256;

/** Tags the spend audit sends. The audit asks no marketing question, so it never has a consent answer. */
const isAuditTag = (tag: string) => tag.startsWith('spend_audit');

export interface LeadBody {
  email: string;
  tag: string;
  source: string;
  website: string; // honeypot — empty for humans
  /**
   * The marketing opt-in ANSWER. Only CaptureForm asks the question, so only it sends this.
   * Absent = "not asked": the endpoint then leaves an existing opt-in untouched.
   */
  consent?: boolean;
  monthly_rerun?: boolean;
}

/**
 * The spend audit's POST body. No `consent` key: the gate asks no marketing question, and a
 * `consent: false` here would opt a CaptureForm subscriber out on the repeat-submit PATCH.
 */
export function auditLeadBody(o: {
  email: string;
  tag: string;
  source: string;
  honeypot: string;
  rerun: boolean;
}): LeadBody {
  return {
    email: o.email,
    tag: o.tag,
    source: o.source,
    website: o.honeypot || '',
    monthly_rerun: o.rerun,
  };
}

export type LeadCheck =
  | { kind: 'ok'; email: string; tag: string; source: string; consent: boolean | undefined }
  /** Honeypot filled — the endpoint pretends success and stores nothing. */
  | { kind: 'bot' }
  | { kind: 'reject'; status: 400; error: string };

/** Validate + normalize a parsed request body. Same order and limits the endpoint always used. */
export function checkLead(data: unknown): LeadCheck {
  const reject = (error: string): LeadCheck => ({ kind: 'reject', status: 400, error });
  if (!data || typeof data !== 'object' || Array.isArray(data)) return reject('invalid body');
  const d = data as Record<string, unknown>;

  // Strict surface — reject any unexpected key rather than silently ignoring it.
  const extra = Object.keys(d).filter((k) => !(LEAD_KEYS as readonly string[]).includes(k));
  if (extra.length) return reject(`unexpected fields: ${extra.join(', ')}`);

  // Honeypot — bots fill the off-screen "website" field.
  if (d.website && String(d.website).trim() !== '') return { kind: 'bot' };

  const email = String(d.email || '').trim().toLowerCase();
  if (email.length > EMAIL_MAX) return reject('email too long');
  if (!email || !EMAIL_RE.test(email)) return reject('valid email required');

  if (d.monthly_rerun !== undefined && typeof d.monthly_rerun !== 'boolean')
    return reject('monthly_rerun must be a boolean');
  if (d.consent !== undefined && typeof d.consent !== 'boolean') return reject('consent must be a boolean');

  // Clip the base tag so the suffix always fits whole inside TAG_MAX.
  const rerun = d.monthly_rerun === true;
  let tag = d.tag ? String(d.tag).slice(0, rerun ? TAG_MAX - MONTHLY_RERUN_TAG_SUFFIX.length : TAG_MAX) : '';
  if (rerun) tag += MONTHLY_RERUN_TAG_SUFFIX;
  const source = d.source ? String(d.source).slice(0, SOURCE_MAX) : '';
  // An audit tag's consent is never an answer (RC check BUILD-018): audit tabs loaded before
  // 0.3.2 still send `consent: false`, which would opt a CaptureForm subscriber out.
  const consent = isAuditTag(tag) ? undefined : (d.consent as boolean | undefined);
  return { kind: 'ok', email, tag, source, consent };
}

/**
 * What a repeat submit changes on an existing Business Contact (the endpoint PATCHes exactly
 * this). optInMarketing moves ONLY on an explicit consent answer (CaptureForm's checkbox): the
 * audit sends none, so unlocking it can never opt a subscriber out. `source` tracks the latest
 * tag, but a stored monthly re-run opt-in (the suffix) is carried onto it (RC check BUILD-018:
 * any later submit used to erase it): `spend_audit_monthly_rerun` + a Guardian signup →
 * `guardian_monthly_rerun`.
 */
export function repeatSubmitPatch(
  existing: { optInMarketing?: unknown; source?: unknown },
  lead: { tag: string; source: string; consent?: boolean },
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (typeof lead.consent === 'boolean' && existing.optInMarketing !== lead.consent)
    patch.optInMarketing = lead.consent;
  let newSource = lead.tag || lead.source || '';
  const optedIn = typeof existing.source === 'string' && existing.source.endsWith(MONTHLY_RERUN_TAG_SUFFIX);
  if (newSource && optedIn && !newSource.endsWith(MONTHLY_RERUN_TAG_SUFFIX)) {
    const max = lead.tag ? TAG_MAX : SOURCE_MAX;
    newSource = newSource.slice(0, max - MONTHLY_RERUN_TAG_SUFFIX.length) + MONTHLY_RERUN_TAG_SUFFIX;
  }
  if (newSource && existing.source !== newSource) patch.source = newSource;
  return patch;
}
