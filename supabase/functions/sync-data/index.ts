import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-anonymous-id, content-type",
};

// sync-data (SEC Phase C) — the CLI POSTs a batch (publishable key + x-anonymous-id);
// this function holds the service-role key (Supabase function secret) and performs
// every privileged write.
//
// QA-BUG-01/02/05 fix: instead of 3 sequential, non-atomic upserts (which could
// leave the cloud half-written on a mid-batch failure, and 500'd outright because
// turns had no UNIQUE(session_id, turn_number)), it now delegates ALL writes to a
// single transactional Postgres RPC, sync_user_batch (migration 005). The function
// body runs in one transaction: get-or-create user → upsert sessions → upsert turns
// (idempotent) → upsert earned badges (idempotent, migration 008) → recompute daily
// summaries split by (date, usage_pool). Any error rolls the whole batch back, so a
// partial write is impossible and the CLI can safely retry the same backlog (every
// write is idempotent).
//
// `badges` (optional): [{ badge_type, earned_at }] earned locally by the user. The
// RPC upserts them ON CONFLICT (user_id, badge_type) DO NOTHING — earned_at is set
// once and never rewritten. Older CLIs that omit `badges` resolve to the same RPC
// via the p_badges default ('[]'), so the deploy order is independent.
//
// BUILD-018 (contract A, migration 009):
//   • `profile` (optional): { sharing_enabled: boolean } — the `share` opt-in,
//     passed as p_profile; the RPC sets users.sharing_enabled (QA-0928-39).
//   • Turns may carry cost_estimate_usd (the CLI's list-rate estimate, only for a
//     turn without a cost_usd anchor) and git_branch only as a salted hash; the
//     RPC reads a fixed set of keys and stores nothing else.
//   • The anonymous id must be a UUID (400) and the body at most 8 MB (413),
//     checked before anything is parsed or written, and the body a JSON object
//     (400) (QA-0928-124). The RPC derives session totals from stored turns, so
//     a request can add turns but not rewrite a session. There is no per-id rate
//     limit or write secret yet (Peter's decisions): a limit needs shared state
//     (a table or the platform's limiter), not something one instance can hold.
//   • The reply says what was stored: new turns vs turns already in the cloud,
//     and new badges (QA-0928-204), plus the RPC's fills_missing marker, which
//     the CLI can wait for before its one-time full re-send (QA-0928-34).

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// The body as text, or null when it is larger than MAX_BODY_BYTES — judged by
// the declared length when there is one, and by counting as it streams in (a
// chunked body has none), so an oversized body is never buffered whole.
async function readBody(req: Request): Promise<string | null> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { buf.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(buf);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const anonymousId = req.headers.get("x-anonymous-id");
    if (!anonymousId) return json({ error: "Missing anonymous ID" }, 400);
    if (!UUID_RE.test(anonymousId)) return json({ error: "Invalid anonymous ID" }, 400);

    const text = await readBody(req);
    if (text === null) {
      return json({ error: `Request body too large (limit ${MAX_BODY_BYTES / 1048576} MB)` }, 413);
    }
    let body: any;
    try {
      body = JSON.parse(text);
    } catch {
      return json({ error: "Body is not valid JSON" }, 400);
    }
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return json({ error: "Body must be a JSON object" }, 400);
    }
    const sessions = Array.isArray(body?.sessions) ? body.sessions : [];
    const badges = Array.isArray(body?.badges) ? body.badges : [];
    const profile = typeof body?.profile?.sharing_enabled === "boolean"
      ? { sharing_enabled: body.profile.sharing_enabled }
      : {};

    // One atomic call — all-or-nothing.
    const { data, error } = await supabase.rpc("sync_user_batch", {
      p_anonymous_id: anonymousId,
      p_sessions: sessions,
      p_badges: badges,
      p_profile: profile,
    });
    if (error) throw error;

    const synced = (data?.synced ?? sessions.length) as number;
    const inserted = (data?.turns_inserted ?? 0) as number;
    const skipped = (data?.turns_skipped ?? 0) as number;
    const badgesNew = (data?.badges_inserted ?? 0) as number;

    return json({
      ...data,
      synced,
      turns_synced: inserted,
      message: `Synced ${synced} session(s): ${inserted} new turn(s), ${skipped} already in the cloud; ${badgesNew} new badge(s)`,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
