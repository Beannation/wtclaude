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
// (idempotent) → recompute daily summaries split by (date, usage_pool). Any error
// rolls the whole batch back, so a partial write is impossible and the CLI can
// safely retry the same backlog (every write is idempotent).

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const anonymousId = req.headers.get("x-anonymous-id");
    if (!anonymousId) {
      return new Response(JSON.stringify({ error: "Missing anonymous ID" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const sessions = Array.isArray(body?.sessions) ? body.sessions : [];

    // One atomic call — all-or-nothing.
    const { data, error } = await supabase.rpc("sync_user_batch", {
      p_anonymous_id: anonymousId,
      p_sessions: sessions,
    });
    if (error) throw error;

    const synced = (data?.synced ?? sessions.length) as number;
    const turnsSynced = (data?.turns_synced ?? 0) as number;

    return new Response(
      JSON.stringify({
        synced,
        turns_synced: turnsSynced,
        message: `Synced ${synced} session(s), ${turnsSynced} turn(s)`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
