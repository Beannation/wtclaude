import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// report-monthly (M10) — Monthly Lite report. Intended to run as a scheduled
// cron on the 1st (Supabase scheduled function / pg_cron → invoke), reporting
// the PREVIOUS calendar month. Also callable per-user with x-anonymous-id.
//
// Content: totals, month-over-month trend, top model, busiest day. Optional
// email via Resend if RESEND_API_KEY is set and the user opted in
// (users.preferences.report_email). All cost is billing-grade (anchored on
// cost.total_cost_usd); the figure is the bill, not an estimate.
//
// DEPLOYMENT: code-complete. Goes live only once SEC Phase C is deployed (it
// needs the service secret + the schema). Set the cron after deploy:
//   select cron.schedule('wtclaude-monthly','0 8 1 * *',
//     $$ select net.http_post(url:='…/functions/v1/report-monthly',
//        headers:='{"Authorization":"Bearer <service>"}'::jsonb) $$);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-anonymous-id, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function monthRange(offset = -1) {
  // offset -1 = previous month relative to today.
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset + 1, 1));
  return { startStr: start.toISOString().slice(0, 10), endStr: end.toISOString().slice(0, 10), label: start.toISOString().slice(0, 7) };
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

async function buildReport(supabase: any, userId: string) {
  const cur = monthRange(-1);
  const prev = monthRange(-2);

  const { data: rows } = await supabase
    .from("daily_summaries").select("*").eq("user_id", userId)
    .gte("date", prev.startStr).lt("date", cur.endStr);

  const curRows = (rows || []).filter((r: any) => r.date >= cur.startStr && r.date < cur.endStr);
  const prevRows = (rows || []).filter((r: any) => r.date >= prev.startStr && r.date < prev.endStr);

  const sum = (rs: any[], k: string) => rs.reduce((a, r) => a + Number(r[k] || 0), 0);
  const curCost = sum(curRows, "estimated_cost_usd");
  const prevCost = sum(prevRows, "estimated_cost_usd");
  const trendPct = prevCost > 0 ? ((curCost - prevCost) / prevCost) * 100 : null;

  const models: Record<string, number> = {};
  for (const r of curRows) for (const [m, c] of Object.entries(r.models_used || {})) models[m] = (models[m] || 0) + (c as number);
  const topModel = Object.entries(models).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  const byDow: number[] = Array(7).fill(0);
  for (const r of curRows) byDow[new Date(r.date + "T12:00:00Z").getUTCDay()] += Number(r.estimated_cost_usd || 0);
  const busiestDow = byDow.reduce((best, v, i) => (v > byDow[best] ? i : best), 0);

  return {
    type: "monthly-lite",
    month: cur.label,
    cost_usd: Math.round(curCost * 100) / 100,
    cost_basis: "billing-grade",
    tokens: sum(curRows, "total_input_tokens") + sum(curRows, "total_output_tokens"),
    sessions: sum(curRows, "session_count"),
    turns: sum(curRows, "turn_count"),
    trend_vs_prev_pct: trendPct == null ? null : Math.round(trendPct),
    prev_month_cost_usd: Math.round(prevCost * 100) / 100,
    top_model: topModel,
    busiest_day: DOW[busiestDow],
    lines_added: sum(curRows, "lines_added"),
  };
}

async function maybeEmail(supabase: any, userId: string, report: any) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return { emailed: false, reason: "no RESEND_API_KEY" };
  const { data: user } = await supabase.from("users").select("preferences").eq("id", userId).single();
  const to = user?.preferences?.report_email;
  if (!to) return { emailed: false, reason: "no opt-in email" };
  const html = `<h2>WTClaude — ${report.month} Monthly Lite</h2>
    <p><strong>$${report.cost_usd}</strong> billing-grade · ${report.sessions} sessions · ${report.turns} turns</p>
    <p>Trend vs prior month: ${report.trend_vs_prev_pct == null ? "n/a" : report.trend_vs_prev_pct + "%"}</p>
    <p>Top model: ${report.top_model ?? "—"} · Busiest day: ${report.busiest_day}</p>
    <p style="color:#888;font-size:12px">Independent project, not affiliated with Anthropic.</p>`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "WTClaude <reports@wtclaude.dev>", to, subject: `WTClaude — ${report.month} report`, html }),
  });
  return { emailed: res.ok };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anonymousId = req.headers.get("x-anonymous-id");

    if (anonymousId) {
      const { data: user } = await supabase.from("users").select("id").eq("anonymous_id", anonymousId).single();
      if (!user) return json({ error: "User not found" }, 404);
      const report = await buildReport(supabase, user.id);
      const email = await maybeEmail(supabase, user.id, report);
      return json({ report, email });
    }

    // Cron/batch mode: every user.
    const { data: users } = await supabase.from("users").select("id");
    let count = 0;
    for (const u of users || []) {
      const report = await buildReport(supabase, u.id);
      await maybeEmail(supabase, u.id, report);
      count++;
    }
    return json({ ran: count, mode: "batch" });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
