import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// report-daily (M10) — End-of-day debrief: sessions, tokens, cost, costliest
// turn, and one tip. Scheduled cron (end of day) or callable per-user with
// x-anonymous-id. Cost is billing-grade (cost.total_cost_usd anchor).
//
// DEPLOYMENT: code-complete; live after SEC Phase C. Cron after deploy, e.g.:
//   select cron.schedule('wtclaude-daily','0 23 * * *', $$ … report-daily … $$);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-anonymous-id, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function pickTip(d: any): string {
  if (d.cost_usd === 0) return "No spend today — your limits reset clean.";
  if (d.cache_ratio >= 0.6) return "Strong cache reuse today — that's keeping per-turn cost down.";
  if (d.fast_share >= 0.25) return "A quarter of today's spend was fast-mode (usage credits, not your 5h/weekly limit).";
  if (d.costliest_turn && d.costliest_turn.share >= 0.3) return "One turn drove a third of today's cost — tighter context on big turns helps.";
  return "Steady day. Watch the run-rate tile to stay ahead of the monthly projection.";
}

async function buildDebrief(supabase: any, userId: string, dateStr: string) {
  const dayStart = dateStr + "T00:00:00Z";
  const dayEnd = dateStr + "T23:59:59.999Z";

  const [{ data: summaryRows }, { data: turns }] = await Promise.all([
    // Post-June-15 a date can have one daily row per usage_pool (migration 005),
    // so select all matching rows and aggregate rather than .maybeSingle()
    // (which errors on >1 row). Pre-flip this is a single 'interactive' row.
    supabase.from("daily_summaries").select("session_count, total_cache_read")
      .eq("user_id", userId).eq("date", dateStr),
    supabase.from("turns").select("cost_usd, model, input_tokens, output_tokens, cache_read_tokens, speed_tier, timestamp")
      .eq("user_id", userId).gte("timestamp", dayStart).lte("timestamp", dayEnd),
  ]);
  const summary = (summaryRows || []).reduce(
    (a: any, r: any) => ({
      session_count: a.session_count + (r.session_count || 0),
      total_cache_read: a.total_cache_read + (r.total_cache_read || 0),
    }),
    { session_count: 0, total_cache_read: 0 },
  );

  const tl = turns || [];
  const cost = tl.reduce((a: number, t: any) => a + Number(t.cost_usd || 0), 0);
  const fastCost = tl.filter((t: any) => t.speed_tier === "fast").reduce((a: number, t: any) => a + Number(t.cost_usd || 0), 0);
  const cacheRead = tl.reduce((a: number, t: any) => a + (t.cache_read_tokens || 0), 0);
  const inOut = tl.reduce((a: number, t: any) => a + (t.input_tokens || 0) + (t.output_tokens || 0), 0);
  const costliest = tl.reduce((best: any, t: any) => (Number(t.cost_usd || 0) > Number(best?.cost_usd || 0) ? t : best), null);

  const d = {
    type: "daily-debrief",
    date: dateStr,
    sessions: summary?.session_count || 0,
    turns: tl.length,
    tokens: inOut + (summary?.total_cache_read || cacheRead),
    cost_usd: Math.round(cost * 1e4) / 1e4,
    cost_basis: "billing-grade",
    fast_share: cost > 0 ? fastCost / cost : 0,
    cache_ratio: inOut > 0 ? cacheRead / (cacheRead + inOut) : 0,
    costliest_turn: costliest ? {
      model: costliest.model,
      cost_usd: Math.round(Number(costliest.cost_usd || 0) * 1e4) / 1e4,
      share: cost > 0 ? Number(costliest.cost_usd || 0) / cost : 0,
    } : null,
  };
  return { ...d, tip: pickTip(d) };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anonymousId = req.headers.get("x-anonymous-id");
    const url = new URL(req.url);
    const dateStr = url.searchParams.get("date") || new Date().toISOString().slice(0, 10);

    if (anonymousId) {
      const { data: user } = await supabase.from("users").select("id").eq("anonymous_id", anonymousId).single();
      if (!user) return json({ error: "User not found" }, 404);
      return json({ report: await buildDebrief(supabase, user.id, dateStr) });
    }

    const { data: users } = await supabase.from("users").select("id");
    const reports = [];
    for (const u of users || []) reports.push(await buildDebrief(supabase, u.id, dateStr));
    return json({ ran: reports.length, mode: "batch" });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
