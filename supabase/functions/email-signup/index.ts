// email-signup — public, first-party email capture for the marketing site.
//
// Reusable for ANY list (Guardian waitlist, SMB tease, Complete-user notify, and
// future lists): the form's `tag` maps to a `list`. Writes via service_role into
// the deny-all `email_signups` table (Phase-C posture — no direct client writes).
//
// Hardened (self-guarded public endpoint): CORS allowlist + honeypot + email
// validation + a basic per-IP rate limit. Deploy with --no-verify-jwt, like the
// other public fns.
//
// Contract (what the site's CaptureForm already sends / expects):
//   POST { email, tag, source }  ->  2xx { ok: true, ... } on success,
//                                     4xx { ok: false, error } on rejection.
//   (The form keys on res.ok / HTTP status; the JSON body is future-proofing.)
//
// Resend-ready (future-proof, skips if unset): if RESEND_API_KEY *and* a per-list
// audience id are configured, the contact is also upserted into a Resend audience;
// otherwise it is skipped silently — capture works fully without Resend.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// CORS allowlist — prod apex + www, the Vercel preview alias, and localhost (tests).
const ALLOWED_ORIGINS = new Set([
  "https://wtclaude.com",
  "https://www.wtclaude.com",
  "https://wtclaude-site.vercel.app",
  "http://localhost:4321", // astro dev default
  "http://localhost:3000",
]);

// tag (from the form) -> canonical list. Unknown tags fall back to a sanitized
// slug (keeps the endpoint reusable for future lists with no code change);
// absent/empty -> 'general'.
const TAG_TO_LIST: Record<string, string> = {
  guardian: "guardian_waitlist",
  guardian_waitlist: "guardian_waitlist",
  complete: "complete_user_notify",
  complete_user: "complete_user_notify",
  smb: "smb_tease",
  smb_finance: "smb_finance_tease",
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HONEYPOT_FIELDS = ["hp", "website", "url", "_gotcha", "company"];

// Basic per-IP rate limit (per-isolate, in-memory — intentionally simple; the
// real protection is the deny-all table + validation + CORS).
const RL_MAX = 8;
const RL_WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RL_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > RL_MAX;
}

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, accept",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "Content-Type": "application/json" },
  });
}

function listFromTag(tag: unknown): string {
  if (typeof tag !== "string" || !tag.trim()) return "general";
  const t = tag.trim().toLowerCase();
  if (TAG_TO_LIST[t]) return TAG_TO_LIST[t];
  const slug = t.replace(/[^a-z0-9_]/g, "_").slice(0, 64);
  return slug || "general";
}

serve(async (req) => {
  const origin = req.headers.get("origin");

  // Preflight — only allowlisted origins get a usable ACAO.
  if (req.method === "OPTIONS") {
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return new Response("origin not allowed", { status: 403 });
    }
    return new Response("ok", { headers: corsHeaders(origin) });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "method not allowed" }, 405, origin);
  }

  // CORS allowlist: browser requests carry an Origin — reject foreign ones.
  // No Origin (server-to-server / curl) falls through to validation + rate limit.
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ ok: false, error: "origin not allowed" }, 403, origin);
  }

  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
  if (rateLimited(ip)) {
    return json({ ok: false, error: "rate limited" }, 429, origin);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "invalid JSON" }, 400, origin);
  }

  // Honeypot: any trap field with a value => pretend success (200) but store
  // nothing, so bots don't learn they were filtered.
  for (const f of HONEYPOT_FIELDS) {
    if (body && typeof body[f] === "string" && body[f].trim()) {
      return json({ ok: true, skipped: "hp" }, 200, origin);
    }
  }

  const email =
    typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) {
    return json({ ok: false, error: "invalid email" }, 400, origin);
  }

  const list = listFromTag(body?.tag);
  const source = typeof body?.source === "string" ? body.source.slice(0, 200) : null;
  const consent = body?.consent === true;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // De-dupe on (email, list): look first so a re-submit never errors and we can
  // report insert vs. dedupe.
  const { data: existing, error: selErr } = await supabase
    .from("email_signups")
    .select("id")
    .eq("email", email)
    .eq("list", list)
    .maybeSingle();

  if (selErr) {
    return json({ ok: false, error: "store error" }, 500, origin);
  }

  let deduped = false;
  if (existing) {
    deduped = true;
  } else {
    const { error: insErr } = await supabase
      .from("email_signups")
      .insert({ email, list, source, consent });
    if (insErr) {
      if ((insErr as any).code === "23505") {
        deduped = true; // unique race — treat as dedupe, not an error
      } else {
        return json({ ok: false, error: "store error" }, 500, origin);
      }
    }
  }

  // Future-proof Resend hook — no-op unless configured.
  await maybeResend(email, list);

  return json({ ok: true, list, deduped }, 200, origin);
});

// Add the contact to a per-list Resend audience if both the API key and an
// audience id for this list are set. Audience id resolves from
// RESEND_AUDIENCE_<LIST_UPPER>, else RESEND_AUDIENCE_DEFAULT. Skips silently
// otherwise and never blocks/fails a capture.
async function maybeResend(email: string, list: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return;
  const audience =
    Deno.env.get(`RESEND_AUDIENCE_${list.toUpperCase()}`) ||
    Deno.env.get("RESEND_AUDIENCE_DEFAULT");
  if (!audience) return;
  try {
    await fetch(`https://api.resend.com/audiences/${audience}/contacts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, unsubscribed: false }),
    });
  } catch {
    /* never let Resend block or fail a capture */
  }
}
