import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
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

    const url = new URL(req.url);
    const period = url.searchParams.get("period") || "weekly";
    const limit = parseInt(url.searchParams.get("limit") || "50", 10);

    // Calculate period start
    const now = new Date();
    let periodStart: string;

    if (period === "weekly") {
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
      periodStart = monday.toISOString().slice(0, 10);
    } else {
      periodStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    }

    // Get opted-in users' daily summaries for this period
    const { data: summaries, error } = await supabase
      .from("daily_summaries")
      .select(`
        user_id,
        total_input_tokens,
        total_output_tokens,
        total_cache_read,
        total_cache_write,
        session_count,
        turn_count
      `)
      .gte("date", periodStart)
      .order("date", { ascending: false });

    if (error) throw error;

    // Aggregate by user
    const byUser: Record<string, any> = {};
    for (const s of summaries || []) {
      if (!byUser[s.user_id]) {
        byUser[s.user_id] = {
          user_id: s.user_id,
          total_tokens: 0,
          session_count: 0,
          turn_count: 0,
        };
      }
      const u = byUser[s.user_id];
      const tokens = s.total_input_tokens + s.total_output_tokens +
                     s.total_cache_read + s.total_cache_write;
      u.total_tokens += tokens;
      u.session_count += s.session_count;
      u.turn_count += s.turn_count;
    }

    // Filter to sharing-enabled users only
    const userIds = Object.keys(byUser);
    if (userIds.length === 0) {
      return new Response(JSON.stringify({ leaderboard: [], period, periodStart }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: sharedUsers } = await supabase
      .from("users")
      .select("id")
      .in("id", userIds)
      .eq("sharing_enabled", true);

    const sharedSet = new Set((sharedUsers || []).map((u: any) => u.id));

    const leaderboard = Object.values(byUser)
      .filter((u: any) => sharedSet.has(u.user_id))
      .sort((a: any, b: any) => b.total_tokens - a.total_tokens)
      .slice(0, limit)
      .map((u: any, i: number) => ({ rank: i + 1, ...u }));

    return new Response(
      JSON.stringify({ leaderboard, period, periodStart }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
