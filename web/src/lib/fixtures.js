// ─────────────────────────────────────────────────────────────────────────────
// Local demo fixtures — used in DATA_MODE='mock' (default until SEC Phase C is
// deployed). Shapes mirror EXACTLY what the get-dashboard / get-session edge
// functions return in live mode, so flipping VITE_DATA_MODE='live' is a drop-in.
//
// Everything here is synthetic. The dashboard renders a small "Demo data" notice
// in mock mode so it is never mistaken for billing-grade numbers.
//
// Field shapes trace to the CLI per-turn record (src/collector) + summarizeTurns
// (src/utils/sessions.js): cost is anchored on cost.total_cost_usd; speed_tier /
// speed_tier_source carry the BUILD-022 billing-grade fast-mode label; the
// BUILD-023 v2 fields (lines, durations, effort, rate_limits) ride along.
// ─────────────────────────────────────────────────────────────────────────────

// Tiny seeded PRNG (mulberry32) so the demo data is stable across reloads.
function seeded(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = seeded(424242);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const between = (lo, hi) => lo + rnd() * (hi - lo);
const intBetween = (lo, hi) => Math.floor(between(lo, hi + 1));

const MODELS = [
  { id: 'claude-opus-4-8', in: 5, out: 25, share: 0.45 },
  { id: 'claude-sonnet-4-6', in: 3, out: 15, share: 0.4 },
  { id: 'claude-haiku-4-5', in: 1, out: 5, share: 0.15 },
];

const PROJECTS = [
  { hash: 'a1b2c3d4e5f6', branch: 'main', cost_center: 'platform' },
  { hash: 'f6e5d4c3b2a1', branch: 'feat/dashboard', cost_center: 'product' },
  { hash: '9a8b7c6d5e4f', branch: 'fix/collector', cost_center: 'platform' },
];

const DEVICES = [
  { device_id: 'dev_macbookpro', label: 'MacBook Pro (M3)' },
  { device_id: 'dev_macstudio', label: 'Mac Studio' },
];

function weightedModel() {
  const r = rnd();
  let acc = 0;
  for (const m of MODELS) { acc += m.share; if (r <= acc) return m; }
  return MODELS[0];
}

function turnCost(model, inTok, outTok, cacheRead, cacheWrite, fast) {
  const c = (inTok / 1e6) * model.in
    + (outTok / 1e6) * model.out
    + (cacheRead / 1e6) * model.in * 0.1
    + (cacheWrite / 1e6) * model.in * 0.25;
  return c * (fast ? 2 : 1);
}

const NOW = new Date();
const DAY_MS = 86_400_000;

// Per-session turn detail, keyed by session id (served by get-session / fetchSession).
const TURNS_BY_ID = {};

// Build sessions across the last 30 days, then aggregate into daily summaries.
function buildSessions() {
  const sessions = [];
  let sid = 1000;

  for (let dayOffset = 29; dayOffset >= 0; dayOffset--) {
    const dayBase = new Date(NOW.getTime() - dayOffset * DAY_MS);
    // Weekends lighter; some days idle.
    const dow = dayBase.getDay();
    const isWeekend = dow === 0 || dow === 6;
    if (rnd() < (isWeekend ? 0.5 : 0.12)) continue; // idle day
    const sessionCount = isWeekend ? intBetween(1, 2) : intBetween(1, 4);

    for (let s = 0; s < sessionCount; s++) {
      const project = pick(PROJECTS);
      const device = rnd() < 0.78 ? DEVICES[0] : DEVICES[1];
      // Peak hours weighted to 9–18.
      const hour = rnd() < 0.7 ? intBetween(9, 18) : intBetween(7, 23);
      const start = new Date(dayBase);
      start.setHours(hour, intBetween(0, 59), 0, 0);

      const turnCount = intBetween(4, 28);
      const legacyEstimate = rnd() < 0.12; // a few pre-anchor (estimate-only) sessions
      const turns = [];
      let cumIn = 0, cumOut = 0, cumCR = 0, cumCW = 0, cumCost = 0;
      let cumLines = 0, cumLinesRem = 0, cumDur = 0, cumApi = 0;
      const models = {};
      let anchoredCost = 0, estimatedCost = 0, fastCost = 0;
      let fastTurns = 0;

      for (let t = 1; t <= turnCount; t++) {
        const model = weightedModel();
        const inTok = intBetween(200, 4000);
        const outTok = intBetween(300, 6000);
        const cacheRead = intBetween(0, 90000);
        const cacheWrite = intBetween(0, 25000);
        const fast = rnd() < 0.08;
        const c = turnCost(model, inTok, outTok, cacheRead, cacheWrite, fast);
        const apiMs = intBetween(1500, 40000);
        const wallMs = apiMs + intBetween(2000, 120000); // idle time between API calls
        const linesAdd = intBetween(0, 120);
        const linesRem = intBetween(0, 60);

        cumIn += inTok; cumOut += outTok; cumCR += cacheRead; cumCW += cacheWrite;
        cumCost += c; cumLines += linesAdd; cumLinesRem += linesRem;
        cumDur += wallMs; cumApi += apiMs;
        models[model.id] = (models[model.id] || 0) + 1;
        if (fast) { fastCost += c; fastTurns++; }
        if (legacyEstimate) estimatedCost += c; else anchoredCost += c;

        const ts = new Date(start.getTime() + Math.round((wallMs) * t * 0.0)); // ts set below
        turns.push({
          turn: t,
          ts: new Date(start.getTime() + cumDur).toISOString(),
          model: model.id,
          input_tokens: inTok,
          output_tokens: outTok,
          cache_read_tokens: cacheRead,
          cache_write_tokens: cacheWrite,
          cumulative_input: cumIn,
          cumulative_output: cumOut,
          cumulative_cache_read: cumCR,
          cumulative_cache_write: cumCW,
          // Anchor: billing-grade cost from cost.total_cost_usd (null on legacy turns).
          cost_usd: legacyEstimate ? null : Math.round(c * 1e6) / 1e6,
          cumulative_cost_usd: legacyEstimate ? null : Math.round(cumCost * 1e6) / 1e6,
          speed_tier: fast ? 'fast' : 'standard',
          speed_tier_source: legacyEstimate ? 'inferred' : 'payload',
          usage_pool: 'interactive',
          billing_basis: fast ? 'fast_mode_usage_credits' : 'subscription_limits',
          used_percentage: Math.min(99, Math.round((cumIn + cumOut) / 2000)),
          git_branch: project.branch,
          project_hash: project.hash,
          cost_center: project.cost_center,
          device_id: device.device_id,
          task_category: null, // tool_names absent on live payloads → null (honest)
          lines_added: linesAdd,
          lines_removed: linesRem,
          duration_ms: wallMs,
          api_duration_ms: apiMs,
          effort_level: pick(['low', 'medium', 'high', 'xhigh']),
          thinking_enabled: rnd() < 0.6,
          exceeds_200k_tokens: cumIn + cumOut > 200000,
          cc_version: '2.1.168',
        });
        void ts;
      }

      const ended = new Date(start.getTime() + cumDur);
      // Strava-style "route" sparks — per-turn cost & token shape for the timeline.
      const costSpark = turns.map((t) => Math.round((t.cost_usd || 0) * 1e4) / 1e4);
      const tokenSpark = turns.map((t) => t.input_tokens + t.output_tokens);
      sessions.push({
        id: `sess_${sid}`,
        session_id: `${project.hash}-${sid}`,
        cost_spark: costSpark,
        token_spark: tokenSpark,
        started_at: start.toISOString(),
        ended_at: ended.toISOString(),
        total_input_tokens: cumIn,
        total_output_tokens: cumOut,
        total_cache_read: cumCR,
        total_cache_write: cumCW,
        models_used: models,
        turn_count: turnCount,
        estimated_cost_usd: Math.round(cumCost * 1e6) / 1e6,
        anchored_cost_usd: Math.round(anchoredCost * 1e6) / 1e6,
        estimated_only_cost_usd: Math.round(estimatedCost * 1e6) / 1e6,
        fast_cost_usd: Math.round(fastCost * 1e6) / 1e6,
        fast_turns: fastTurns,
        cost_basis: legacyEstimate ? 'estimate' : (fastTurns ? 'mixed' : 'billing-grade'),
        git_branch: project.branch,
        project_hash: project.hash,
        cost_center: project.cost_center,
        device_id: device.device_id,
        device_label: device.label,
        lines_added: cumLines,
        lines_removed: cumLinesRem,
        duration_ms: cumDur,
        api_duration_ms: cumApi,
      });
      TURNS_BY_ID[`sess_${sid}`] = turns; // detail payload (get-session)
      sid++;
    }
  }
  return sessions;
}

const SESSIONS = buildSessions();

function buildDailySummaries(sessions) {
  const byDate = {};
  for (const s of sessions) {
    const date = s.started_at.slice(0, 10);
    if (!byDate[date]) {
      byDate[date] = {
        date,
        total_input_tokens: 0, total_output_tokens: 0,
        total_cache_read: 0, total_cache_write: 0,
        session_count: 0, turn_count: 0,
        models_used: {},
        estimated_cost_usd: 0, anchored_cost_usd: 0,
        estimated_only_cost_usd: 0, fast_cost_usd: 0,
        lines_added: 0, lines_removed: 0,
        duration_ms: 0, api_duration_ms: 0,
      };
    }
    const d = byDate[date];
    d.total_input_tokens += s.total_input_tokens;
    d.total_output_tokens += s.total_output_tokens;
    d.total_cache_read += s.total_cache_read;
    d.total_cache_write += s.total_cache_write;
    d.session_count += 1;
    d.turn_count += s.turn_count;
    d.estimated_cost_usd += s.estimated_cost_usd;
    d.anchored_cost_usd += s.anchored_cost_usd;
    d.estimated_only_cost_usd += s.estimated_only_cost_usd;
    d.fast_cost_usd += s.fast_cost_usd;
    d.lines_added += s.lines_added;
    d.lines_removed += s.lines_removed;
    d.duration_ms += s.duration_ms;
    d.api_duration_ms += s.api_duration_ms;
    for (const [m, c] of Object.entries(s.models_used)) d.models_used[m] = (d.models_used[m] || 0) + c;
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({
    ...d,
    estimated_cost_usd: Math.round(d.estimated_cost_usd * 1e4) / 1e4,
    anchored_cost_usd: Math.round(d.anchored_cost_usd * 1e4) / 1e4,
    estimated_only_cost_usd: Math.round(d.estimated_only_cost_usd * 1e4) / 1e4,
    fast_cost_usd: Math.round(d.fast_cost_usd * 1e4) / 1e4,
  }));
}

const DAILY = buildDailySummaries(SESSIONS);

// Per-device rollup.
function buildDevices(sessions) {
  const map = {};
  for (const s of sessions) {
    if (!map[s.device_id]) {
      map[s.device_id] = {
        device_id: s.device_id, label: s.device_label,
        session_count: 0, cost_usd: 0, turn_count: 0, last_seen: s.ended_at,
      };
    }
    const d = map[s.device_id];
    d.session_count += 1;
    d.turn_count += s.turn_count;
    d.cost_usd += s.estimated_cost_usd;
    if (s.ended_at > d.last_seen) d.last_seen = s.ended_at;
  }
  return Object.values(map).map((d) => ({ ...d, cost_usd: Math.round(d.cost_usd * 1e4) / 1e4 }));
}

const DEVICE_ROLLUP = buildDevices(SESSIONS);

// rate_limits snapshot — the shared OVERALL plan limit (per GTM-005 framing).
const RATE_LIMITS = {
  source: 'payload', // billing-grade rate_limits from the statusline payload
  captured_at: new Date(NOW.getTime() - 6 * 60 * 1000).toISOString(),
  five_hour: { used_percentage: 62, resets_at: new Date(NOW.getTime() + 2.4 * 3600 * 1000).toISOString() },
  seven_day: { used_percentage: 41, resets_at: new Date(NOW.getTime() + 3.1 * DAY_MS).toISOString() },
};

const BADGES = [
  { badge_type: 'first_session', earned_at: new Date(NOW.getTime() - 29 * DAY_MS).toISOString() },
  { badge_type: '100k_club', earned_at: new Date(NOW.getTime() - 28 * DAY_MS).toISOString() },
  { badge_type: 'million_club', earned_at: new Date(NOW.getTime() - 20 * DAY_MS).toISOString() },
  { badge_type: '10m_club', earned_at: new Date(NOW.getTime() - 8 * DAY_MS).toISOString() },
  { badge_type: 'week_streak', earned_at: new Date(NOW.getTime() - 14 * DAY_MS).toISOString() },
  { badge_type: 'model_mixer', earned_at: new Date(NOW.getTime() - 12 * DAY_MS).toISOString() },
];

const LEADERBOARD = [
  { rank: 1, user_id: 'anon_7f3a9c21', total_tokens: 184_200_000, session_count: 142, turn_count: 2310 },
  { rank: 2, user_id: 'anon_2b8e4d10', total_tokens: 151_800_000, session_count: 119, turn_count: 1980 },
  { rank: 3, user_id: 'anon_9d1c6a44', total_tokens: 132_400_000, session_count: 98, turn_count: 1640 },
  { rank: 4, user_id: 'anon_c4f2e8b7', total_tokens: 98_100_000, session_count: 71, turn_count: 1120 },
  { rank: 5, user_id: 'anon_5a0b3f9e', total_tokens: 76_500_000, session_count: 60, turn_count: 940 },
];

export function mockDashboard() {
  return {
    meta: { source: 'mock', generated_at: NOW.toISOString() },
    daily_summaries: DAILY,
    sessions: SESSIONS, // list view (turn detail lives in get-session)
    badges: BADGES,
    devices: DEVICE_ROLLUP,
    rate_limits: RATE_LIMITS,
  };
}

export function mockSession(sessionId) {
  const s = SESSIONS.find((x) => x.id === sessionId || x.session_id === sessionId);
  if (!s) return null;
  return { ...s, turns: TURNS_BY_ID[s.id] || [] };
}

export function mockLeaderboard() {
  return { leaderboard: LEADERBOARD, period: 'weekly' };
}
