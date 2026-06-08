import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// get-session — one session + its turns for the detail view. Replaces the
// dashboard's old direct supabase.from('turns') read (which only worked under
// the leaked service_role key). Service-role only; publishable key + anon id at
// the edge.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-anonymous-id, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const anonymousId = req.headers.get("x-anonymous-id");
    if (!anonymousId) return json({ error: "Missing anonymous ID" }, 400);

    const url = new URL(req.url);
    const sessionId = url.searchParams.get("session_id");
    if (!sessionId) return json({ error: "Missing session_id" }, 400);

    const { data: user } = await supabase
      .from("users").select("id").eq("anonymous_id", anonymousId).single();
    if (!user) return json({ error: "User not found" }, 404);

    // Accept either the internal uuid (id) or the CLI session_id; scope to the user.
    let q = supabase.from("sessions").select("*").eq("user_id", user.id);
    q = sessionId.includes("-") && sessionId.length === 36
      ? q.eq("id", sessionId)
      : q.eq("session_id", sessionId);
    const { data: session } = await q.maybeSingle();
    if (!session) {
      // fall back: maybe the caller passed the internal id that doesn't match the uuid heuristic
      const { data: byId } = await supabase.from("sessions").select("*")
        .eq("user_id", user.id).eq("id", sessionId).maybeSingle();
      if (!byId) return json({ error: "Session not found" }, 404);
      return withTurns(supabase, byId);
    }
    return withTurns(supabase, session);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

async function withTurns(supabase: any, session: any) {
  const { data: turns } = await supabase
    .from("turns").select("*").eq("session_id", session.id)
    .order("turn_number", { ascending: true });

  // Normalize turn shape to what the dashboard expects (turn vs turn_number, ts).
  const out = (turns || []).map((t: any) => ({ ...t, turn: t.turn_number, ts: t.timestamp }));
  return json({ ...session, device_label: session.device_id, turns: out });
}
