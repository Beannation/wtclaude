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
//
// BUILD-018 (contract B, migration 009): ?days is an integer 1..365 (default 30;
// anything else is a 400, QA-0928-202) and ?tz an IANA zone (invalid or missing
// → UTC). On top of every existing field it adds meta.tz / meta.window_start /
// meta.last_activity_at (QA-0928-127), meta.first_activity_at (the oldest stored
// turn, any window, QA-0928-26), daily_local and hourly_local (turns
// bucketed in the viewer's zone, QA-0928-32/29), and per-session window totals
// for every session with a turn in the window (QA-0928-33). Those, the sparks
// and the rate-limit reading come from one SQL call (dashboard_local) returning
// a single jsonb value, so PostgREST's 1,000-row cap can't truncate them
// (QA-0928-31). daily_summaries is unchanged: UTC days.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-anonymous-id, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SPARK_POINTS = 60; // dashboard_sparks keeps each session's last 60 turns

// A zone name the runtime knows, canonicalised; anything else → UTC.
function effectiveTz(tz: string | null): string {
  if (!tz || tz.length > 64 || !/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/.test(tz)) return "UTC";
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: tz }).resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

// YYYY-MM-DD of an instant in a zone, and plain calendar-day arithmetic.
function localDate(tz: string, at: Date): string {
  const p: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(at)) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
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

    const url = new URL(req.url);
    const daysParam = url.searchParams.get("days");
    let days = 30;
    if (daysParam !== null) {
      if (!/^\d{1,3}$/.test(daysParam) || Number(daysParam) < 1 || Number(daysParam) > 365) {
        return json({ error: "days must be a whole number from 1 to 365" }, 400);
      }
      days = Number(daysParam);
    }
    let tz = effectiveTz(url.searchParams.get("tz"));

    const { data: user } = await supabase
      .from("users").select("id").eq("anonymous_id", anonymousId).single();
    if (!user) return json({ error: "User not found" }, 404);

    const now = new Date();
    // daily_summaries rows are UTC days, selected exactly as before.
    const startStr = addDays(localDate("UTC", now), -(days - 1));
    let windowStart = addDays(localDate(tz, now), -(days - 1));
    const dashboardLocal = (start: string, zone: string) =>
      supabase.rpc("dashboard_local", { p_user_id: user.id, p_start: start, p_tz: zone });

    const [dailyRes, localRes, badgesRes] = await Promise.all([
      supabase.from("daily_summaries").select("*").eq("user_id", user.id)
        .gte("date", startStr).order("date", { ascending: true }),
      dashboardLocal(windowStart, tz),
      supabase.from("badges").select("*").eq("user_id", user.id),
    ]);
    if (localRes.error) throw localRes.error;
    let local = localRes.data;
    if (local.tz !== tz) {
      // Postgres doesn't know a zone the runtime accepted: redo the window in
      // UTC so window_start and the buckets agree with meta.tz.
      tz = local.tz;
      windowStart = addDays(localDate(tz, now), -(days - 1));
      const again = await dashboardLocal(windowStart, tz);
      if (again.error) throw again.error;
      local = again.data;
    }

    const daily = dailyRes.data || [];
    const badges = badgesRes.data || [];
    const sparks: Record<string, { cost: number[]; tok: number[] }> = local.sparks || {};

    const sessionsOut = (local.sessions || []).map((s: any) => ({
      ...s,
      device_label: s.device_id, // CLI does not send a friendly label
      cost_spark: sparks[s.id]?.cost || [],
      token_spark: sparks[s.id]?.tok || [],
    }));

    // Devices rollup over the window's sessions, counting what each spent INSIDE
    // the window so the combined figure matches the daily totals (QA-0928-33).
    // Sessions without a device id (older CLIs) share one row flagged
    // `unattributed` — not a second machine (QA-0928-123).
    const devMap: Record<string, any> = {};
    for (const s of sessionsOut as any[]) {
      const id = s.device_id || "unknown";
      (devMap[id] ||= {
        device_id: id, label: id, unattributed: !s.device_id,
        session_count: 0, turn_count: 0, cost_usd: 0, anchored_usd: 0, estimate_usd: 0, last_seen: s.ended_at,
      });
      const d = devMap[id];
      d.session_count += 1;
      d.turn_count += s.window_turn_count || 0;
      d.cost_usd += Number(s.window_total_usd || 0);
      d.anchored_usd += Number(s.window_anchored_usd || 0);
      d.estimate_usd += Number(s.window_estimate_usd || 0);
      if (s.ended_at > d.last_seen) d.last_seen = s.ended_at;
    }

    return json({
      meta: {
        source: "live", days,
        tz, window_start: windowStart,
        last_activity_at: local.last_activity_at ?? null,
        first_activity_at: local.first_activity_at ?? null,
        total_sessions: local.total_sessions ?? null,
        spark_points: SPARK_POINTS,
      },
      daily_summaries: daily,
      daily_local: local.daily_local || [],
      hourly_local: local.hourly_local || [],
      sessions: sessionsOut,
      badges,
      devices: Object.values(devMap),
      // The shared overall plan limit, from any window, read by `wtclaude
      // limit`'s rule (dashboard_rate_limits, QA-0928-61); null when no turn
      // has a snapshot.
      rate_limits: local.rate_limits ?? null,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
