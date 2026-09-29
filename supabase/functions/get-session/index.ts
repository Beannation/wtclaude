import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// get-session — one session + its turns for the detail view. Replaces the
// dashboard's old direct supabase.from('turns') read (which only worked under
// the leaked service_role key). Service-role only; publishable key + anon id at
// the edge.
//
// BUILD-018 (contract C): ?session_id is the internal row id OR the CLI session
// id, always scoped to the caller's user (a CLI id can itself be UUID-shaped,
// QA-0928-201). Every turn is returned — read in pages past PostgREST's row cap
// (QA-0928-122) — with total_turns, the stored count.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-anonymous-id, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE = 1000;         // the hosted project's PostgREST max-rows
const MAX_TURNS = 50_000; // one response's upper bound, far past a realistic session (beyond it: truncated)

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

    // The internal id first (only for a UUID — sessions.id is uuid-typed and a
    // non-UUID would raise), then the CLI session id; both scoped to the user.
    let session = null;
    if (UUID_RE.test(sessionId)) {
      const { data, error } = await supabase.from("sessions").select("*")
        .eq("user_id", user.id).eq("id", sessionId).maybeSingle();
      if (error) throw error;
      session = data;
    }
    if (!session) {
      const { data, error } = await supabase.from("sessions").select("*")
        .eq("user_id", user.id).eq("session_id", sessionId).maybeSingle();
      if (error) throw error;
      session = data;
    }
    if (!session) return json({ error: "Session not found" }, 404);
    return withTurns(supabase, session);
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});

async function withTurns(supabase: any, session: any) {
  const page = (from: number, count = false) =>
    supabase.from("turns").select("*", count ? { count: "exact" } : undefined)
      .eq("session_id", session.id).order("turn_number", { ascending: true })
      .range(from, from + PAGE - 1);

  // Read pages until the stored count is reached (or a page comes back empty),
  // so a smaller server row cap still can't cut the list short.
  const first = await page(0, true);
  if (first.error) throw first.error;
  const total: number = first.count ?? (first.data || []).length;
  const turns: any[] = [...(first.data || [])];
  while (turns.length < Math.min(total, MAX_TURNS)) {
    const { data, error } = await page(turns.length);
    if (error) throw error;
    if (!data || data.length === 0) break;
    turns.push(...data);
  }
  if (turns.length > MAX_TURNS) turns.length = MAX_TURNS;

  // Normalize turn shape to what the dashboard expects (turn vs turn_number, ts).
  const out = turns.map((t: any) => ({ ...t, turn: t.turn_number, ts: t.timestamp }));
  return json({
    ...session, device_label: session.device_id, turns: out,
    total_turns: total, truncated: out.length < total,
  });
}
