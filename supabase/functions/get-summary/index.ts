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

    const { data: user } = await supabase
      .from("users")
      .select("id")
      .eq("anonymous_id", anonymousId)
      .single();

    if (!user) {
      return new Response(JSON.stringify({ error: "User not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get("days") || "7", 10);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (days - 1));
    const startStr = startDate.toISOString().slice(0, 10);

    // Get daily summaries
    const { data: dailySummaries } = await supabase
      .from("daily_summaries")
      .select("*")
      .eq("user_id", user.id)
      .gte("date", startStr)
      .order("date", { ascending: true });

    // Get sessions
    const { data: sessions } = await supabase
      .from("sessions")
      .select("*")
      .eq("user_id", user.id)
      .gte("started_at", startStr + "T00:00:00Z")
      .order("started_at", { ascending: false });

    // Get badges
    const { data: badges } = await supabase
      .from("badges")
      .select("*")
      .eq("user_id", user.id);

    return new Response(
      JSON.stringify({
        daily_summaries: dailySummaries || [],
        sessions: sessions || [],
        badges: badges || [],
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
