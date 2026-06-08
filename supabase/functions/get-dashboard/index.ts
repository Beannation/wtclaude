import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// get-dashboard — the single read the M9 dashboard makes. Runs as service_role
// (the service secret lives only as a Supabase function secret); the browser
// reaches it with the PUBLISHABLE key + x-anonymous-id. No direct table access
// is granted to the publishable-key roles (migration 002).
//
// Returns the same shape as src/lib/fixtures.mockDashboard():
//   { meta, daily_summaries, sessions[ +cost_spark/token_spark ], badges,
//     devices, rate_limits }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-anonymous-id, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

    const { data: user } = await supabase
      .from("users").select("id").eq("anonymous_id", anonymousId).single();
    if (!user) return json({ error: "User not found" }, 404);

    const url = new URL(req.url);
    const days = Math.min(365, parseInt(url.searchParams.get("days") || "30", 10));
    const start = new Date();
    start.setDate(start.getDate() - (days - 1));
    const startStr = start.toISOString().slice(0, 10);
    const startTs = startStr + "T00:00:00Z";

    const [dailyRes, sessionsRes, badgesRes] = await Promise.all([
      supabase.from("daily_summaries").select("*").eq("user_id", user.id)
        .gte("date", startStr).order("date", { ascending: true }),
      supabase.from("sessions").select("*").eq("user_id", user.id)
        .gte("started_at", startTs).order("started_at", { ascending: false }),
      supabase.from("badges").select("*").eq("user_id", user.id),
    ]);

    const daily = dailyRes.data || [];
    const sessions = sessionsRes.data || [];
    const badges = badgesRes.data || [];

    // Per-session cost / token "route" sparks — one bounded query over the window.
    const sessionIds = sessions.map((s: any) => s.id);
    const sparks: Record<string, { cost: number[]; tok: number[] }> = {};
    let latestRateTurn: any = null;
    if (sessionIds.length) {
      const { data: turns } = await supabase
        .from("turns")
        .select("session_id, turn_number, cost_usd, input_tokens, output_tokens, timestamp, rate_limit_5h_pct, rate_limit_5h_resets_at, rate_limit_7d_pct, rate_limit_7d_resets_at")
        .in("session_id", sessionIds)
        .order("turn_number", { ascending: true });
      for (const t of turns || []) {
        (sparks[t.session_id] ||= { cost: [], tok: [] });
        sparks[t.session_id].cost.push(Math.round(Number(t.cost_usd || 0) * 1e4) / 1e4);
        sparks[t.session_id].tok.push((t.input_tokens || 0) + (t.output_tokens || 0));
        if (t.rate_limit_5h_pct != null && (!latestRateTurn || t.timestamp > latestRateTurn.timestamp)) {
          latestRateTurn = t;
        }
      }
    }

    const sessionsOut = sessions.map((s: any) => ({
      ...s,
      device_label: s.device_id, // CLI does not send a friendly label
      cost_spark: sparks[s.id]?.cost || [],
      token_spark: sparks[s.id]?.tok || [],
    }));

    // Devices rollup.
    const devMap: Record<string, any> = {};
    for (const s of sessions as any[]) {
      const id = s.device_id || "unknown";
      (devMap[id] ||= { device_id: id, label: id, session_count: 0, turn_count: 0, cost_usd: 0, last_seen: s.ended_at });
      const d = devMap[id];
      d.session_count += 1;
      d.turn_count += s.turn_count || 0;
      d.cost_usd += Number(s.estimated_cost_usd || 0);
      if (s.ended_at > d.last_seen) d.last_seen = s.ended_at;
    }

    // rate_limits — latest turn carrying a snapshot (the shared overall plan limit).
    let rateLimits = null;
    if (latestRateTurn) {
      rateLimits = {
        source: "payload",
        captured_at: latestRateTurn.timestamp,
        five_hour: { used_percentage: latestRateTurn.rate_limit_5h_pct, resets_at: latestRateTurn.rate_limit_5h_resets_at },
        seven_day: { used_percentage: latestRateTurn.rate_limit_7d_pct, resets_at: latestRateTurn.rate_limit_7d_resets_at },
      };
    }

    return json({
      meta: { source: "live", days },
      daily_summaries: daily,
      sessions: sessionsOut,
      badges,
      devices: Object.values(devMap),
      rate_limits: rateLimits,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
