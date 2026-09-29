import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// BUILD-018 (QA-0928-128): the ranking is computed in SQL (leaderboard_totals,
// migration 009) over opted-in users only, grouped per user, ordered and
// limited there — no row-capped read of every user's daily rows. `period` must
// be weekly or monthly (400 otherwise); `limit` is clamped to 1..100 (default 50).
// Periods start on the current UTC week's Monday / the month's 1st.
const PERIODS = new Set(["weekly", "monthly"]);

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
    if (!PERIODS.has(period)) return json({ error: "period must be weekly or monthly" }, 400);
    const n = parseInt(url.searchParams.get("limit") || "", 10);
    const limit = Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : 50;

    // Calculate period start
    const now = new Date();
    let periodStart: string;

    if (period === "weekly") {
      const monday = new Date(now);
      monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
      periodStart = monday.toISOString().slice(0, 10);
    } else {
      periodStart = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
    }

    // [{ rank, user_id, total_tokens, session_count, turn_count }]
    const { data, error } = await supabase.rpc("leaderboard_totals", {
      p_period_start: periodStart,
      p_limit: limit,
    });
    if (error) throw error;

    return json({ leaderboard: data || [], period, periodStart });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
