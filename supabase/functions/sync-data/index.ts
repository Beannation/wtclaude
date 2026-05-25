import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-anonymous-id, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const anonymousId = req.headers.get("x-anonymous-id");
    if (!anonymousId) {
      return new Response(JSON.stringify({ error: "Missing anonymous ID" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get or create user
    let { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("anonymous_id", anonymousId)
      .single();

    if (!user) {
      const { data: newUser, error } = await supabase
        .from("users")
        .insert({ anonymous_id: anonymousId })
        .select("id")
        .single();
      if (error) throw error;
      user = newUser;
    }

    const body = await req.json();
    const { sessions } = body;
    let turnsSynced = 0;

    for (const sessionData of sessions) {
      // Upsert session
      const { data: session, error: sessionErr } = await supabase
        .from("sessions")
        .upsert(
          {
            user_id: user.id,
            session_id: sessionData.session_id,
            started_at: sessionData.summary.started_at,
            ended_at: sessionData.summary.ended_at,
            total_input_tokens: sessionData.summary.input_tokens,
            total_output_tokens: sessionData.summary.output_tokens,
            total_cache_read: sessionData.summary.cache_read_tokens,
            total_cache_write: sessionData.summary.cache_write_tokens,
            models_used: sessionData.summary.models,
            turn_count: sessionData.summary.turn_count,
            estimated_cost_usd: sessionData.summary.cost,
          },
          { onConflict: "user_id,session_id" }
        )
        .select("id")
        .single();

      if (sessionErr) throw sessionErr;

      // Insert turns (skip duplicates via turn_number)
      const turnRows = sessionData.turns.map((t: any) => ({
        session_id: session.id,
        user_id: user.id,
        turn_number: t.turn,
        timestamp: t.ts,
        model: t.model,
        input_tokens: t.input_tokens,
        output_tokens: t.output_tokens,
        cache_read_tokens: t.cache_read_tokens,
        cache_write_tokens: t.cache_write_tokens,
        cumulative_input: t.cumulative_input,
        cumulative_output: t.cumulative_output,
        cumulative_cache_read: t.cumulative_cache_read,
        cumulative_cache_write: t.cumulative_cache_write,
        used_percentage: t.used_percentage,
      }));

      const { error: turnsErr } = await supabase
        .from("turns")
        .upsert(turnRows, { onConflict: "session_id,turn_number", ignoreDuplicates: true });

      if (turnsErr) throw turnsErr;
      turnsSynced += turnRows.length;
    }

    // Update daily summaries
    await updateDailySummaries(supabase, user.id);

    return new Response(
      JSON.stringify({
        synced: sessions.length,
        turns_synced: turnsSynced,
        message: `Synced ${sessions.length} session(s), ${turnsSynced} turn(s)`,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

async function updateDailySummaries(supabase: any, userId: string) {
  // Aggregate turns into daily summaries
  const { data: turns } = await supabase
    .from("turns")
    .select("*")
    .eq("user_id", userId)
    .order("timestamp", { ascending: true });

  if (!turns || turns.length === 0) return;

  const byDate: Record<string, any[]> = {};
  for (const t of turns) {
    const date = t.timestamp.slice(0, 10);
    if (!byDate[date]) byDate[date] = [];
    byDate[date].push(t);
  }

  for (const [date, dayTurns] of Object.entries(byDate)) {
    const models: Record<string, number> = {};
    let input = 0, output = 0, cacheRead = 0, cacheWrite = 0;

    for (const t of dayTurns) {
      input += t.input_tokens;
      output += t.output_tokens;
      cacheRead += t.cache_read_tokens;
      cacheWrite += t.cache_write_tokens;
      models[t.model] = (models[t.model] || 0) + 1;
    }

    const sessionIds = new Set(dayTurns.map((t: any) => t.session_id));

    await supabase
      .from("daily_summaries")
      .upsert(
        {
          user_id: userId,
          date,
          total_input_tokens: input,
          total_output_tokens: output,
          total_cache_read: cacheRead,
          total_cache_write: cacheWrite,
          session_count: sessionIds.size,
          turn_count: dayTurns.length,
          models_used: models,
        },
        { onConflict: "user_id,date" }
      );
  }
}
