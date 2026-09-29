// Edge functions against a scratch Postgres + real PostgREST (row cap 1,000).
// Run via supabase/tests/run.sh; fixture in fixture.sql; clock fixed at
// 2026-03-12T15:00Z by harness.ts. Synthetic ids only.
import { call, eq, ok, sql, test } from "./harness.ts";

// The CLI's pure limit rule, for the gauge parity tests (QA-0928-61). Only that
// function is called; WTCLAUDE_DIR is set first and points nowhere, so importing
// the module never resolves or reads a real ~/.wtclaude.
Deno.env.set("WTCLAUDE_DIR", "/nonexistent/wtc-edge-test/.wtclaude");
const { latestRateLimit } = await import("../../../src/utils/sessions.js");

const P = "aaaaaaaa-0000-4000-8000-000000000001";
const Q = "aaaaaaaa-0000-4000-8000-000000000002";
const BIG_CLI_ID = "cccccccc-1111-4111-8111-000000000001";
const asP = { "x-anonymous-id": P };

const internalId = (anon: string, sid: string) =>
  sql(`select s.id from sessions s join users u on u.id = s.user_id where u.anonymous_id = '${anon}' and s.session_id = '${sid}'`);

// ── get-dashboard (contract B) ──────────────────────────────────────────────
test("QA-0928-202 get-dashboard: days that are not an integer 1..365 get a 400 JSON error, never 500", async () => {
  for (const days of ["abc", "0", "366", "1.5", "", "-3", "30x"]) {
    const r = await call("get-dashboard", { query: { days }, headers: asP });
    eq(r.status, 400, `days=${JSON.stringify(days)} status`);
    ok(typeof r.json?.error === "string", `days=${JSON.stringify(days)} error message`);
  }
  const r = await call("get-dashboard", { headers: asP });
  eq(r.status, 200, "missing days defaults");
  eq(r.json.meta.days, 30, "default days");
});

test("contract B get-dashboard: tz echo, invalid tz -> UTC, window_start, old fields kept", async () => {
  const ny = await call("get-dashboard", { query: { days: "30", tz: "America/New_York" }, headers: asP });
  eq(ny.status, 200, "status");
  eq(ny.json.meta.tz, "America/New_York", "meta.tz");
  eq(ny.json.meta.window_start, "2026-02-11", "meta.window_start (local today 03-12 minus 29 days)");
  eq(ny.json.meta.source, "live", "meta.source kept");
  for (const k of ["daily_summaries", "sessions", "badges", "devices", "daily_local", "hourly_local"]) {
    ok(Array.isArray(ny.json[k]), `${k} is an array`);
  }
  ok("rate_limits" in ny.json, "rate_limits kept");
  const bad = await call("get-dashboard", { query: { days: "30", tz: "Not/AZone" }, headers: asP });
  eq(bad.status, 200, "invalid tz status");
  eq(bad.json.meta.tz, "UTC", "invalid tz -> UTC");
  const none = await call("get-dashboard", { query: { days: "30" }, headers: asP });
  eq(none.json.meta.tz, "UTC", "missing tz -> UTC");
});

test("QA-0928-127 get-dashboard: meta.last_activity_at is the newest stored turn", async () => {
  const r = await call("get-dashboard", { query: { days: "1", tz: "UTC" }, headers: asP });
  eq(r.status, 200, "status");
  eq(Date.parse(r.json.meta.last_activity_at), Date.parse("2026-03-12T04:20:00Z"), "last_activity_at");
});

test("QA-0928-26 get-dashboard: meta.first_activity_at is the oldest stored turn, any window", async () => {
  for (const days of ["1", "30"]) {
    const r = await call("get-dashboard", { query: { days, tz: "America/New_York" }, headers: asP });
    eq(r.status, 200, `days=${days} status`);
    eq(Date.parse(r.json.meta.first_activity_at), Date.parse("2026-03-05T00:00:00Z"), `days=${days} first_activity_at`);
  }
});

test("QA-0928-31 get-dashboard: sparks for every session past 1,000 turns (last <=60 points each)", async () => {
  const r = await call("get-dashboard", { query: { days: "30", tz: "America/New_York" }, headers: asP });
  eq(r.status, 200, "status");
  eq(r.json.sessions.length, 5, "sessions in window");
  for (const s of r.json.sessions) {
    eq(s.cost_spark.length, Math.min(s.turn_count, 60), `${s.session_id} cost_spark length`);
    eq(s.token_spark.length, Math.min(s.turn_count, 60), `${s.session_id} token_spark length`);
  }
});

test("QA-0928-31 get-dashboard: rate_limits from the truly latest snapshot, not a truncated set", async () => {
  const r = await call("get-dashboard", { query: { days: "30", tz: "America/New_York" }, headers: asP });
  eq(Date.parse(r.json.rate_limits.captured_at), Date.parse("2026-03-12T04:19:00Z"), "captured_at");
  eq(Number(r.json.rate_limits.five_hour.used_percentage), 3, "5h reading");
  eq(Number(r.json.rate_limits.seven_day.used_percentage), 7, "7d reading");
});

// QA-0928-61 (RC 0.3.2): the Overview limit gauge reads exactly like `wtclaude
// limit`. Each case syncs rows through sync-data as the CLI sends them (resets_at
// in epoch seconds) and compares get-dashboard's rate_limits with the CLI's own
// latestRateLimit (src/utils/sessions.js) over the same rows.
const sec = (iso: string) => Date.parse(iso) / 1000;
const rl = (p5: unknown, r5: unknown, p7: unknown, r7: unknown) =>
  ({ rate_limit_5h_pct: p5, rate_limit_5h_resets_at: r5, rate_limit_7d_pct: p7, rate_limit_7d_resets_at: r7 });
const rlTurn = (turn: number, ts: string, reading: Record<string, unknown> = {}) => ({
  turn, ts, model: "claude-sonnet-4-6", input_tokens: 100, output_tokens: 50, cache_read_tokens: 0,
  cache_write_tokens: 0, cost_usd: 0.01, cumulative_cost_usd: 0.01 * turn, device_id: "dev-limit-1", ...reading,
});
async function gaugeVsCli(id: string, sessions: Record<string, Record<string, unknown>[]>) {
  const body = { sessions: Object.entries(sessions).map(([session_id, turns]) => ({ session_id, summary: {}, turns })) };
  eq((await post(id, JSON.stringify(body))).status, 200, `${id} sync`);
  const r = await call("get-dashboard", { query: { days: "1", tz: "UTC" }, headers: { "x-anonymous-id": id } });
  eq(r.status, 200, `${id} get-dashboard`);
  const got = r.json.rate_limits;
  const cli = latestRateLimit(Object.values(sessions).flat());
  const pct = (v: unknown) => (v == null ? null : Number(v));
  const at = (v: string | null) => (v == null ? null : sec(v));
  eq([pct(got.five_hour.used_percentage), at(got.five_hour.resets_at)],
     [cli.rate_limit_5h_pct, cli.rate_limit_5h_resets_at], `${id} 5-hour = wtclaude limit`);
  eq([pct(got.seven_day.used_percentage), at(got.seven_day.resets_at)],
     [cli.rate_limit_7d_pct, cli.rate_limit_7d_resets_at], `${id} 7-day = wtclaude limit`);
  eq(Date.parse(got.captured_at), Date.parse(cli.ts), `${id} captured_at = wtclaude limit`);
  return got;
}

test("QA-0928-61 get-dashboard: the limit gauge = `wtclaude limit` where newest-by-time is not (33%/48%, not 32%/9%)", async () => {
  // The web stream's fixture (web/src/lib/rateLimits.test.js), on the test clock's day.
  const id = "eeeeeeee-0000-4000-8000-000000000061";
  const R5 = sec("2026-03-12T15:10:00Z"), R7 = sec("2026-03-18T23:00:00Z");
  const got = await gaugeVsCli(id, {
    "limit-lead": [
      rlTurn(1, "2026-03-12T13:40:00.000Z", rl(33, R5, 12, R7)),
      rlTurn(2, "2026-03-12T13:42:25.000Z", rl(33, R5, 48, R7)),
    ],
    // A concurrent session lagging behind: its newer row carries an older, lower reading.
    "limit-lag": [
      rlTurn(1, "2026-03-12T13:42:27.000Z", rl(32, sec("2026-03-12T15:10:30Z"), 9, sec("2026-03-12T01:00:00Z"))),
      rlTurn(2, "2026-03-12T13:43:00.000Z"),
    ],
  });
  eq([Number(got.five_hour.used_percentage), Number(got.seven_day.used_percentage)], [33, 48], "the CLI's reading");
  eq(Date.parse(got.captured_at), Date.parse("2026-03-12T13:42:27Z"), "as of the newest reading");
  eq(await sql(`select rate_limit_5h_pct::int || '/' || rate_limit_7d_pct::int from turns t join users u on u.id = t.user_id
                 where u.anonymous_id = '${id}' and rate_limit_5h_pct is not null order by t."timestamp" desc limit 1`),
     "32/9", "the newest row by time reads lower (the fixture separates the two rules)");
});

test("QA-0928-61 get-dashboard: the limit gauge's edge cases match `wtclaude limit`", async () => {
  const R5 = sec("2026-03-12T15:10:00Z");
  // No reset time on any row: the newest row's reading, reset unknown.
  let got = await gaugeVsCli("eeeeeeee-0000-4000-8000-000000000062", { "k1": [
    rlTurn(1, "2026-03-12T10:00:00.000Z", rl(40, null, 70, null)),
    rlTurn(2, "2026-03-12T10:05:00.000Z", rl(20, null, 65, null)),
  ] });
  eq([Number(got.five_hour.used_percentage), got.five_hour.resets_at], [20, null], "no reset times");
  // 5-hour only; the newer row has no reset time. The 7-day reading stays null.
  got = await gaugeVsCli("eeeeeeee-0000-4000-8000-000000000063", { "k2": [
    rlTurn(1, "2026-03-12T09:00:00.000Z", rl(50, R5, null, null)),
    rlTurn(2, "2026-03-12T09:10:00.000Z", rl(70, null, null, null)),
  ] });
  eq([Number(got.five_hour.used_percentage), got.seven_day.used_percentage], [50, null], "5-hour only");
  // The 5-minute edge: 300 s before the newest reset is the same window, 301 s is
  // not. 7-day: all in the newest window, and the top reading is not the newest row.
  const R7 = sec("2026-03-18T23:00:00Z");
  got = await gaugeVsCli("eeeeeeee-0000-4000-8000-000000000064", { "k3": [
    rlTurn(1, "2026-03-12T11:00:00.000Z", rl(90, R5 - 301, 40, R7)),
    rlTurn(2, "2026-03-12T11:01:00.000Z", rl(60, R5 - 300, 45, R7 - 60)),
    rlTurn(3, "2026-03-12T11:02:00.000Z", rl(60, R5 - 120, 44, R7)),
    rlTurn(4, "2026-03-12T11:03:00.000Z", rl(10, R5, 41, R7 + 30)),
  ] });
  eq([Number(got.five_hour.used_percentage), Number(got.seven_day.used_percentage)], [60, 45], "5-minute edge; 7-day top, not newest");
  // resets_at 0 is no reset time, as the CLI reads it.
  got = await gaugeVsCli("eeeeeeee-0000-4000-8000-000000000065", { "k4": [
    rlTurn(1, "2026-03-12T10:00:00.000Z", rl(80, 0, 80, 0)),
    rlTurn(2, "2026-03-12T10:05:00.000Z", rl(30, 0, 30, 0)),
  ] });
  eq([Number(got.five_hour.used_percentage), got.five_hour.resets_at], [30, null], "resets_at 0");
});

test("QA-0928-33/32 get-dashboard: a session that started before the window is listed with its in-window spend", async () => {
  const r = await call("get-dashboard", { query: { days: "2", tz: "America/New_York" }, headers: asP });
  eq(r.status, 200, "status");
  eq(r.json.meta.window_start, "2026-03-11", "window_start");
  const st = r.json.sessions.find((s: any) => s.session_id === "p-straddle");
  ok(st, "straddling session present");
  eq(Number(st.window_total_usd), 0.25, "window_total_usd");
  eq(st.started_before_window, true, "started_before_window");
  const sessionsTotal = r.json.sessions.reduce((a: number, s: any) => a + Number(s.window_total_usd), 0);
  const dailyTotal = r.json.daily_local.reduce((a: number, d: any) => a + Number(d.total_usd), 0);
  const devicesTotal = r.json.devices.reduce((a: number, d: any) => a + Number(d.cost_usd), 0);
  eq(Math.round(sessionsTotal * 1e6), Math.round(2.502 * 1e6), "sessions window total");
  eq(Math.round(dailyTotal * 1e6), Math.round(sessionsTotal * 1e6), "daily_local total = sessions total");
  eq(Math.round(devicesTotal * 1e6), Math.round(sessionsTotal * 1e6), "devices total = sessions total");
  for (const d of r.json.daily_local) ok(["2026-03-11", "2026-03-12"].includes(d.date), `local date ${d.date}`);
  const hourlyTotal = r.json.hourly_local.reduce((a: number, h: any) => a + Number(h.total_usd), 0);
  eq(Math.round(hourlyTotal * 1e6), Math.round(sessionsTotal * 1e6), "hourly_local total = sessions total");
});

// Web-stream handoff: the local days carry the fast-mode split and active time
// (no fallback to UTC daily_summaries needed), and Devices counts only in-window
// turns, so its combined cost is the headline even for a session that started
// before the window.
test("get-dashboard: daily_local has fast_usd + api_duration_ms; devices total = daily_local total", async () => {
  const id = "eeeeeeee-0000-4000-8000-000000000001";
  const t = (turn: number, ts: string, extra: Record<string, unknown>) => ({
    turn, ts, model: "claude-sonnet-4-6", input_tokens: 100, output_tokens: 50, cache_read_tokens: 0,
    cache_write_tokens: 0, usage_pool: "interactive", device_id: "dev-fast-1", ...extra,
  });
  const body = { sessions: [
    { session_id: "fast-1", summary: {}, turns: [
      t(1, "2026-03-12T09:00:00Z", { cost_usd: 0.10, speed_tier: "fast", duration_ms: 900, api_duration_ms: 700 }),
      t(2, "2026-03-12T09:01:00Z", { cost_usd: 0.05, speed_tier: "standard", duration_ms: 400, api_duration_ms: 300 }),
      t(3, "2026-03-12T09:02:00Z", { cost_usd: null, cost_estimate_usd: 0.02, duration_ms: 200, api_duration_ms: 100 }),
    ] },
    { session_id: "fast-2", summary: {}, turns: [
      t(1, "2026-03-11T23:00:00Z", { cost_usd: 0.50, device_id: "dev-fast-2", api_duration_ms: 5000 }),
      t(2, "2026-03-12T10:00:00Z", { cost_usd: 0.03, device_id: "dev-fast-2", api_duration_ms: 50 }),
    ] },
  ] };
  eq((await post(id, JSON.stringify(body))).status, 200, "sync status");
  const r = await call("get-dashboard", { query: { days: "1", tz: "UTC" }, headers: { "x-anonymous-id": id } });
  eq(r.status, 200, "status");
  eq(r.json.daily_local.length, 1, "one local day");
  const d = r.json.daily_local[0];
  ok("fast_usd" in d && "api_duration_ms" in d, "daily_local row has fast_usd and api_duration_ms");
  eq(Number(d.fast_usd), 0.1, "fast_usd = billing-grade fast-mode spend (as daily_summaries.fast_cost_usd)");
  eq(Number(d.api_duration_ms), 1150, "api_duration_ms = in-window turns only");
  const headline = r.json.daily_local.reduce((a: number, x: any) => a + Number(x.total_usd), 0);
  const dev = (k: string) => r.json.devices.reduce((a: number, x: any) => a + Number(x[k]), 0);
  eq(Math.round(headline * 1e6), 200000, "headline = in-window turns ($0.20)");
  eq(Math.round(dev("cost_usd") * 1e6), Math.round(headline * 1e6), "devices combined cost = headline");
  eq(Math.round(dev("anchored_usd") * 1e6), 180000, "devices anchored_usd");
  eq(Math.round(dev("estimate_usd") * 1e6), 20000, "devices estimate_usd");
  eq(dev("turn_count"), 4, "devices turn_count = in-window turns");
});

test("QA-0928-123 get-dashboard: sessions with no device roll up as one unattributed row", async () => {
  const r = await call("get-dashboard", { query: { days: "30", tz: "UTC" }, headers: asP });
  const un = r.json.devices.filter((d: any) => d.unattributed);
  eq(un.length, 1, "one unattributed row");
  eq(un[0].session_count, 1, "its sessions");
  eq(r.json.devices.filter((d: any) => !d.unattributed).length, 1, "one real device");
});

test("get-dashboard: auth errors unchanged", async () => {
  eq((await call("get-dashboard", {})).status, 400, "missing id");
  eq((await call("get-dashboard", { headers: { "x-anonymous-id": "aaaaaaaa-0000-4000-8000-00000000ffff" } })).status, 404, "unknown id");
});

// ── get-session (contract C) ────────────────────────────────────────────────
test("QA-0928-201 get-session: a UUID-shaped CLI session id resolves", async () => {
  const r = await call("get-session", { query: { session_id: BIG_CLI_ID }, headers: asP });
  eq(r.status, 200, "status");
  eq(r.json.session_id, BIG_CLI_ID, "session");
});

test("QA-0928-122 get-session: every turn past 1,000, plus total_turns", async () => {
  const big = await call("get-session", { query: { session_id: BIG_CLI_ID }, headers: asP });
  eq(big.json.turns.length, 1733, "turns returned");
  eq(big.json.total_turns, 1733, "total_turns");
  eq(big.json.turns[1732].turn, 1733, "last turn number");
  const late = await call("get-session", { query: { session_id: await internalId(P, "p-late") }, headers: asP });
  eq(late.status, 200, "internal id status");
  eq(late.json.turns.length, 1101, "internal id: all turns");
  eq(late.json.total_turns, 1101, "internal id: total_turns");
});

test("contract C get-session: non-UUID CLI id works; other users' sessions are not found", async () => {
  const s = await call("get-session", { query: { session_id: "abc123def4567" }, headers: asP });
  eq(s.status, 200, "13-char CLI id");
  eq(s.json.turns.length, 3, "its turns");
  eq((await call("get-session", { query: { session_id: await internalId(Q, "q-1") }, headers: asP })).status, 404, "Q's internal id");
  eq((await call("get-session", { query: { session_id: "q-1" }, headers: asP })).status, 404, "Q's CLI id");
  eq((await call("get-session", { query: { session_id: "no-such" }, headers: asP })).status, 404, "unknown");
  eq((await call("get-session", { headers: asP })).status, 400, "missing session_id");
});

// ── sync-data (contract A) ──────────────────────────────────────────────────
const NEW_USER = "dddddddd-0000-4000-8000-000000000001";
function contractA(n: number) {
  const turns = Array.from({ length: n }, (_, i) => ({
    turn: i + 1, ts: new Date(Date.parse("2026-03-12T09:00:00Z") + i * 60_000).toISOString(),
    model: "claude-sonnet-4-6", input_tokens: 100, output_tokens: 50, cache_read_tokens: 1000, cache_write_tokens: 10,
    cost_usd: i === 0 ? null : 0.01, cost_estimate_usd: i === 0 ? 0.03 : null,
    git_branch: "#0123456789ab", usage_pool: "interactive", device_id: "dev-sync-1",
  }));
  return {
    sessions: [{ session_id: "sync-1", summary: { started_at: turns[0].ts, ended_at: turns[n - 1].ts, cost: 0.07, anchored_cost: 0.04, estimated_cost: 0.03, turn_count: n, models: { "claude-sonnet-4-6": n } }, turns }],
    badges: [{ badge_type: "first_session", earned_at: "2026-03-12T09:00:00Z" }],
    profile: { sharing_enabled: true },
  };
}
const post = (id: string, body: BodyInit, extra: Record<string, string> = {}) =>
  call("sync-data", { method: "POST", headers: { "x-anonymous-id": id, "content-type": "application/json", ...extra }, body });

test("QA-0928-124 sync-data: a non-UUID anonymous id gets 400 and creates nothing", async () => {
  const r = await post("not-a-uuid", JSON.stringify({ sessions: [] }));
  eq(r.status, 400, "status");
  eq(await sql(`select count(*) from users where anonymous_id = 'not-a-uuid'`), "0", "no user row");
});

test("QA-0928-124 sync-data: a body over 8 MB gets 413 (with or without content-length)", async () => {
  const big = JSON.stringify({ sessions: [], pad: "x".repeat(8 * 1024 * 1024 + 10) });
  const r1 = await post(NEW_USER, big, { "content-length": String(big.length) });
  eq(r1.status, 413, "declared length");
  const stream = new ReadableStream({
    start(c) { const b = new TextEncoder().encode(big); for (let i = 0; i < b.length; i += 65536) c.enqueue(b.slice(i, i + 65536)); c.close(); },
  });
  const r2 = await post(NEW_USER, stream);
  eq(r2.status, 413, "streamed body");
  eq(await sql(`select count(*) from users where anonymous_id = '${NEW_USER}'`), "0", "nothing written");
});

test("QA-0928-124 sync-data: malformed JSON gets 400", async () => {
  eq((await post(NEW_USER, "{not json")).status, 400, "status");
});

test("QA-0928-204/39/34 sync-data: contract-A body stores estimate + profile and reports new vs already-stored", async () => {
  const first = await post(NEW_USER, JSON.stringify(contractA(5)));
  eq(first.status, 200, "first status");
  eq(first.json.turns_inserted, 5, "turns_inserted");
  eq(first.json.turns_skipped, 0, "turns_skipped");
  eq(first.json.badges_inserted, 1, "badges_inserted");
  eq(await sql(`select sharing_enabled from users where anonymous_id = '${NEW_USER}'`), "t", "sharing_enabled from profile");
  eq(await sql(`select sum(cost_estimate_usd) from turns t join users u on u.id = t.user_id where u.anonymous_id = '${NEW_USER}'`), "0.030000", "estimate stored");
  const again = await post(NEW_USER, JSON.stringify(contractA(5)));
  eq(again.status, 200, "re-send status");
  eq(again.json.turns_inserted, 0, "re-send turns_inserted");
  eq(again.json.turns_skipped, 5, "re-send turns_skipped");
  eq(again.json.badges_inserted, 0, "re-send badges_inserted");
  ok(/0 new turn/.test(again.json.message) && /5 already/.test(again.json.message), `message: ${again.json.message}`);
});

test("QA-0928-34 sync-data: the reply says which missing fields a re-send fills (the CLI's re-send gate)", async () => {
  const r = await post(NEW_USER, JSON.stringify(contractA(5)));
  eq(r.status, 200, "status");
  eq(r.json.fills_missing, ["cost_estimate_usd", "git_branch"], "fills_missing");
});

test("QA-0928-124 sync-data: a forged summary cannot rewrite a stored session", async () => {
  const forged = { sessions: [{ session_id: "sync-1", turns: [],
    summary: { cost: 999, anchored_cost: 999, turn_count: 1, input_tokens: 0, models: { forged: 1 } } }] };
  eq((await post(NEW_USER, JSON.stringify(forged))).status, 200, "status");
  eq(await sql(`select round(s.estimated_cost_usd, 6) || ' ' || s.turn_count || ' ' || s.total_input_tokens || ' ' || s.models_used::text
                  from sessions s join users u on u.id = s.user_id
                 where u.anonymous_id = '${NEW_USER}' and s.session_id = 'sync-1'`),
     '0.070000 5 500 {"claude-sonnet-4-6": 5}', "session row = its 5 stored turns");
});

test("RC legacy $0 anchor: a 0.3.1 'no cost block' row is stored unanchored and the 0.3.2 re-send prices it", async () => {
  const id = "dddddddd-0000-4000-8000-000000000003";
  const as = { "x-anonymous-id": id };
  const ts = (m: number) => new Date(Date.parse("2026-03-12T10:00:00Z") + m * 60_000).toISOString();
  const base = { model: "claude-opus-5-5", input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0 };
  // What 0.3.1 sends: the stored record as is, the legacy row with cost_usd 0 and cumulative_cost_usd null.
  const v031 = [
    { turn: 1, ts: ts(0), ...base, cost_usd: 0.5, cumulative_cost_usd: 0.5 },
    { turn: 2, ts: ts(1), ...base, input_tokens: 90000, output_tokens: 20000, cost_usd: 0, cumulative_cost_usd: null },
    { turn: 3, ts: ts(2), ...base, cost_usd: 0.25, cumulative_cost_usd: 0.75 },
  ];
  const summary = { started_at: ts(0), ended_at: ts(2), cost: 0.75, anchored_cost: 0.75, estimated_cost: 0, turn_count: 3 };
  eq((await post(id, JSON.stringify({ sessions: [{ session_id: "legacy-0", summary, turns: v031 }] }))).status, 200, "0.3.1 sync");
  let s = await call("get-session", { query: { session_id: "legacy-0" }, headers: as });
  eq(s.json.turns[1].cost_usd, null, "after 0.3.1: the legacy row has no $0 anchor");
  eq(s.json.cost_basis, "mixed", "after 0.3.1: the session is not billing-grade");
  // What 0.3.2 sends on its one-time re-send: that turn unanchored, with its list-rate estimate.
  const v032 = v031.map((t) => (t.turn === 2 ? { ...t, cost_usd: null, cost_estimate_usd: 0.76 } : t));
  const r = await post(id, JSON.stringify({ sessions: [{ session_id: "legacy-0",
    summary: { ...summary, cost: 1.51, estimated_cost: 0.76 }, turns: v032 }] }));
  eq(r.status, 200, "0.3.2 re-send");
  eq(r.json.turns_updated, 1, "the re-send fills the legacy turn");
  s = await call("get-session", { query: { session_id: "legacy-0" }, headers: as });
  eq(s.json.turns[1].cost_usd, null, "turn 2 cost_usd");
  eq(Number(s.json.turns[1].cost_estimate_usd), 0.76, "turn 2 estimate");
  eq(Number(s.json.estimated_cost_usd), 1.51, "session total = the CLI's");
  eq(s.json.cost_basis, "mixed", "session basis");
  const d = await call("get-dashboard", { query: { days: "1", tz: "UTC" }, headers: as });
  const day = d.json.daily_local.find((x: any) => x.date === "2026-03-12");
  eq(Number(day.total_usd), 1.51, "daily_local total");
  eq(Number(day.estimate_usd), 0.76, "daily_local estimate");
});

test("RC session precision: get-session and get-dashboard carry the exact 6-decimal session total", async () => {
  const id = "dddddddd-0000-4000-8000-000000000004";
  const as = { "x-anonymous-id": id };
  const turns = [5.000001, 5.000001, 2.344995].map((c, i) => ({
    turn: i + 1, ts: new Date(Date.parse("2026-03-12T11:00:00Z") + i * 60_000).toISOString(),
    model: "claude-opus-5-5", input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0,
    cost_usd: c, cumulative_cost_usd: null,
  }));
  eq((await post(id, JSON.stringify({ sessions: [{ session_id: "exact-1", summary: {}, turns }] }))).status, 200, "sync");
  const s = await call("get-session", { query: { session_id: "exact-1" }, headers: as });
  eq(Number(s.json.estimated_cost_usd), 12.344997, "get-session total");
  const d = await call("get-dashboard", { query: { days: "1", tz: "UTC" }, headers: as });
  eq(Number(d.json.sessions.find((x: any) => x.session_id === "exact-1").estimated_cost_usd), 12.344997, "get-dashboard session total");
  eq(Number(d.json.daily_summaries.find((x: any) => x.date === "2026-03-12").estimated_cost_usd), 12.344997, "UTC daily total");
});

test("QA-0928-124 sync-data: a body that is not a JSON object gets 400; an empty object stores nothing", async () => {
  const id = "dddddddd-0000-4000-8000-000000000002";
  for (const body of ["null", "[]", '"x"', "42", ""]) {
    eq((await post(id, body)).status, 400, `body ${JSON.stringify(body)}`);
  }
  const empty = await post(id, "{}");
  eq(empty.status, 200, "{} status");
  eq(await sql(`select count(*) from users where anonymous_id = '${id}'`), "0", "no user row");
  // The re-send gate's marker is in every 009 reply, so an empty request (which
  // writes nothing and creates no user) is enough to learn the server can use it.
  eq(empty.json.fills_missing, ["cost_estimate_usd", "git_branch"], "{} reply carries fills_missing");
});

// ── report-daily / report-monthly (QA-0928-125) ─────────────────────────────
for (const fn of ["report-daily", "report-monthly"]) {
  test(`QA-0928-125 ${fn}: batch mode refuses callers without the cron secret`, async () => {
    Deno.env.set("CRON_SECRET", "test-cron-secret-0123456789");
    const none = await call(fn, { method: "POST" });
    eq(none.status, 401, "no secret");
    ok(none.json?.ran === undefined, "no user count leaked");
    eq((await call(fn, { method: "POST", headers: { "x-cron-secret": "wrong" } })).status, 401, "wrong secret");
    const good = await call(fn, { method: "POST", headers: { "x-cron-secret": "test-cron-secret-0123456789" } });
    eq(good.status, 200, "right secret");
    eq(good.json.mode, "batch", "batch ran");
    Deno.env.delete("CRON_SECRET");
    eq((await call(fn, { method: "POST", headers: { "x-cron-secret": "" } })).status, 401, "secret unset on the server");
  });
  test(`QA-0928-125 ${fn}: per-user mode still answers for the caller's own id`, async () => {
    const r = await call(fn, { query: { date: "2026-03-11" }, headers: asP });
    eq(r.status, 200, "status");
    ok(r.json.report, "report");
  });
}

test("QA-0928-125 report-monthly: the billing-grade figure is the anchored sum; estimates are separate", async () => {
  const r = await call("report-monthly", { headers: asP });
  eq(r.json.report.month, "2026-02", "previous month");
  ok("estimated_only_usd" in r.json.report, "estimate reported separately");
  eq(r.json.email.emailed, false, "per-user call never emails");
});

// ── get-leaderboard (QA-0928-128) ───────────────────────────────────────────
test("QA-0928-128 get-leaderboard: unknown period is a 400", async () => {
  eq((await call("get-leaderboard", { query: { period: "all" } })).status, 400, "period=all");
});

test("QA-0928-128 get-leaderboard: totals over >1,000 in-period rows are complete", async () => {
  const top = await sql(`select id from users where anonymous_id = 'bbbbbbbb-0000-4000-8000-000000000100'`);
  const m = await call("get-leaderboard", { query: { period: "monthly" } });
  eq(m.status, 200, "monthly status");
  eq(m.json.leaderboard.length, 50, "default limit 50");
  eq(m.json.leaderboard[0].user_id, top, "rank 1");
  eq(Number(m.json.leaderboard[0].total_tokens), 12 * 1260, "rank 1: 12 days x 1,260 tokens");
  eq(Number(m.json.leaderboard[49].total_tokens), 12 * 1211, "rank 50: 12 days x 1,211 tokens");
  const w = await call("get-leaderboard", { query: { period: "weekly" } });
  const wTop = w.json.leaderboard.find((e: any) => e.user_id === top);
  eq(Number(wTop?.total_tokens), 4 * 1260, "weekly (Mon 03-09..Thu 03-12)");
  eq((await call("get-leaderboard", { query: { period: "monthly", limit: "1000" } })).json.leaderboard.length, 100, "limit clamped to 100");
  eq((await call("get-leaderboard", { query: { period: "monthly", limit: "abc" } })).json.leaderboard.length, 50, "bad limit -> 50");
  eq((await call("get-leaderboard", { query: { period: "monthly", limit: "3" } })).json.leaderboard.length, 3, "limit 3");
});

// QA-0928-39 ship-gate check, locally: the opt-in rides the sync (profile), and
// the leaderboard shows the user after that one sync; the next sync's opt-out
// removes them. (NEW_USER synced 5 turns on 03-12 with sharing_enabled true.)
test("QA-0928-39 get-leaderboard: a user who opted in through sync-data is ranked after one sync", async () => {
  const uid = await sql(`select id from users where anonymous_id = '${NEW_USER}'`);
  const onBoard = async () =>
    (await call("get-leaderboard", { query: { period: "weekly", limit: "100" } })).json.leaderboard
      .some((e: any) => e.user_id === uid);
  ok(await onBoard(), "opted-in user on the weekly board");
  eq((await post(NEW_USER, JSON.stringify({ profile: { sharing_enabled: false } }))).status, 200, "opt-out status");
  ok(!(await onBoard()), "opted-out user off the board");
  eq((await post(NEW_USER, JSON.stringify({ profile: { sharing_enabled: true } }))).status, 200, "opt back in");
  ok(await onBoard(), "back on the board");
});
