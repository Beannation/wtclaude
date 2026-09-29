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
//
// REFRESHED 2026-09-28 (QA-0928-177): current models (Opus 5.5 / Sonnet 5 /
// Fable 5.1) priced with the shared priceTurn mirror (2x cache writes, per-model
// cache reads — no rate typed in here), a current Claude Code version, no
// session in the future, a small context_inventory so the populated
// /context-waste state can be demoed, and the 0.3.2 get-dashboard additions
// (meta.tz / last_activity_at / window_start, daily_local, hourly_local,
// window_total_usd — contract B), built from the same turns.
// ─────────────────────────────────────────────────────────────────────────────

import { priceTurn, PRICING } from './compareModels.js';
import { dateInZone, addDays } from './dates.js';
import { latestRateLimitReading } from './rateLimits.js';

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

// Model ids as Claude Code records them; the keys are rate-sheet keys, so the
// prices come from the mirror (web-parity.test.js pins it to the sheet).
const MODELS = [
  { id: 'claude-opus-5-5', key: 'opus-5-5', share: 0.5 },
  { id: 'claude-sonnet-5', key: 'sonnet-5', share: 0.35 },
  { id: 'claude-fable-5-1', key: 'fable-5-1', share: 0.15 },
];
const CC_VERSION = '2.1.280';

// Branches as a 0.3.2 sync uploads them: '#' + a 12-hex salted hash, or null
// (no branch, e.g. a detached HEAD). Raw branch names never reach the cloud
// (QA-0928-05), so the demo doesn't show any either.
const PROJECTS = [
  { hash: 'a1b2c3d4e5f6', branch: '#3f9c2a71b0d4', cost_center: 'platform' },
  { hash: 'f6e5d4c3b2a1', branch: '#b84f3e61c0a2', cost_center: 'product' },
  { hash: '9a8b7c6d5e4f', branch: '#0d7a92e4f5b1', cost_center: 'platform' },
  { hash: '5c4b3a2f1e0d', branch: null, cost_center: null },
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

// Fast mode bills at the model's fast_mode rates; the sheet gives them as a
// multiple of the standard rates (2x on Opus 5.5).
function turnCost(model, tokens, fast) {
  const std = priceTurn(model.id, tokens).usd;
  const entry = PRICING.models[model.key];
  const factor = fast && entry.fast_mode ? entry.fast_mode.input / entry.input : 1;
  return std * factor;
}

const NOW = new Date();
const DAY_MS = 86_400_000;

// Per-session turn detail, keyed by session id (served by get-session / fetchSession).
const TURNS_BY_ID = {};

// Build sessions across the last 30 days. Every session ends before NOW.
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
    // Today: only hours that have already finished (QA-0928-177).
    const lastHour = dayOffset === 0 ? NOW.getHours() - 2 : 23;
    if (lastHour < 7) continue;

    for (let s = 0; s < sessionCount; s++) {
      const project = pick(PROJECTS);
      const device = rnd() < 0.78 ? DEVICES[0] : DEVICES[1];
      // Peak hours weighted to 9–18.
      const hour = Math.min(lastHour, rnd() < 0.7 ? intBetween(9, 18) : intBetween(7, 23));
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
        const tokens = {
          input_tokens: intBetween(200, 4000),
          output_tokens: intBetween(300, 6000),
          cache_read_tokens: intBetween(0, 90000),
          cache_write_tokens: intBetween(0, 25000),
        };
        const fast = model.key === 'opus-5-5' && rnd() < 0.08;
        const c = turnCost(model, tokens, fast);
        const apiMs = intBetween(1500, 40000);
        const wallMs = apiMs + intBetween(2000, 120000); // idle time between API calls
        const linesAdd = intBetween(0, 120);
        const linesRem = intBetween(0, 60);

        cumIn += tokens.input_tokens; cumOut += tokens.output_tokens;
        cumCR += tokens.cache_read_tokens; cumCW += tokens.cache_write_tokens;
        cumCost += c; cumLines += linesAdd; cumLinesRem += linesRem;
        cumDur += wallMs; cumApi += apiMs;
        models[model.id] = (models[model.id] || 0) + 1;
        if (fast) { fastCost += c; fastTurns++; }
        if (legacyEstimate) estimatedCost += c; else anchoredCost += c;

        turns.push({
          turn: t,
          ts: new Date(Math.min(start.getTime() + cumDur, NOW.getTime() - 60_000)).toISOString(),
          model: model.id,
          ...tokens,
          cumulative_input: cumIn,
          cumulative_output: cumOut,
          cumulative_cache_read: cumCR,
          cumulative_cache_write: cumCW,
          // Anchor: billing-grade cost from cost.total_cost_usd (null on legacy turns).
          cost_usd: legacyEstimate ? null : Math.round(c * 1e6) / 1e6,
          cumulative_cost_usd: legacyEstimate ? null : Math.round(cumCost * 1e6) / 1e6,
          // List-rate estimate for a turn without the anchor (contract A).
          cost_estimate_usd: legacyEstimate ? Math.round(c * 1e6) / 1e6 : null,
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
          cc_version: CC_VERSION,
        });
      }

      const ended = new Date(turns[turns.length - 1].ts);
      // Strava-style "route" sparks — per-turn cost & token shape for the timeline.
      const costSpark = turns.map((t) => Math.round((t.cost_usd ?? t.cost_estimate_usd ?? 0) * 1e4) / 1e4);
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
const turnCostOf = (t) => Number(t.cost_usd ?? t.cost_estimate_usd ?? 0);

// daily_summaries — one row per (UTC date, pool), as migration 008 builds them.
function buildDailySummaries(sessions, startUtc) {
  const byDate = {};
  for (const s of sessions) {
    for (const t of TURNS_BY_ID[s.id]) {
      const date = t.ts.slice(0, 10);
      if (date < startUtc) continue;
      const d = (byDate[date] ||= {
        date, usage_pool: 'interactive',
        total_input_tokens: 0, total_output_tokens: 0, total_cache_read: 0, total_cache_write: 0,
        session_count: 0, turn_count: 0, models_used: {},
        estimated_cost_usd: 0, anchored_cost_usd: 0, estimated_only_cost_usd: 0, fast_cost_usd: 0,
        lines_added: 0, lines_removed: 0, duration_ms: 0, api_duration_ms: 0, _s: new Set(),
      });
      d.total_input_tokens += t.input_tokens; d.total_output_tokens += t.output_tokens;
      d.total_cache_read += t.cache_read_tokens; d.total_cache_write += t.cache_write_tokens;
      d._s.add(s.id); d.turn_count += 1;
      d.estimated_cost_usd += turnCostOf(t);
      if (t.cost_usd != null) d.anchored_cost_usd += t.cost_usd; else d.estimated_only_cost_usd += turnCostOf(t);
      if (t.speed_tier === 'fast') d.fast_cost_usd += turnCostOf(t);
      d.lines_added += t.lines_added; d.lines_removed += t.lines_removed;
      d.duration_ms += t.duration_ms; d.api_duration_ms += t.api_duration_ms;
      d.models_used[t.model] = (d.models_used[t.model] || 0) + 1;
    }
  }
  const r4 = (n) => Math.round(n * 1e4) / 1e4;
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)).map(({ _s, ...d }) => ({
    ...d, session_count: _s.size,
    estimated_cost_usd: r4(d.estimated_cost_usd), anchored_cost_usd: r4(d.anchored_cost_usd),
    estimated_only_cost_usd: r4(d.estimated_only_cost_usd), fast_cost_usd: r4(d.fast_cost_usd),
  }));
}

// daily_local + hourly_local — turn spend on the viewer's calendar (contract B).
function buildLocal(sessions, tz, windowStart) {
  const days = {};
  const hours = {};
  const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23', weekday: 'short' });
  const DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  for (const s of sessions) {
    for (const t of TURNS_BY_ID[s.id]) {
      const at = new Date(t.ts);
      const date = dateInZone(at, tz);
      if (date < windowStart) continue;
      const d = (days[date] ||= {
        date, usage_pool: 'interactive', turn_count: 0, _s: new Set(), anchored_usd: 0, estimate_usd: 0,
        total_usd: 0, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, models_used: {},
      });
      d.turn_count += 1; d._s.add(s.id);
      if (t.cost_usd != null) d.anchored_usd += t.cost_usd; else d.estimate_usd += turnCostOf(t);
      d.total_usd += turnCostOf(t);
      d.input_tokens += t.input_tokens; d.output_tokens += t.output_tokens;
      d.cache_read_tokens += t.cache_read_tokens; d.cache_write_tokens += t.cache_write_tokens;
      d.models_used[t.model] = (d.models_used[t.model] || 0) + 1;
      const parts = Object.fromEntries(hourFmt.formatToParts(at).map((p) => [p.type, p.value]));
      const key = `${DOW[parts.weekday]}-${Number(parts.hour)}`;
      const h = (hours[key] ||= { dow: DOW[parts.weekday], hour: Number(parts.hour), total_usd: 0, turn_count: 0 });
      h.total_usd += turnCostOf(t); h.turn_count += 1;
    }
  }
  const daily_local = Object.values(days).sort((a, b) => a.date.localeCompare(b.date))
    .map(({ _s, ...d }) => ({ ...d, session_count: _s.size }));
  return { daily_local, hourly_local: Object.values(hours) };
}

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
    d.cost_usd += s.window_total_usd ?? s.estimated_cost_usd;
    if (s.ended_at > d.last_seen) d.last_seen = s.ended_at;
  }
  return Object.values(map).map((d) => ({ ...d, cost_usd: Math.round(d.cost_usd * 1e4) / 1e4 }));
}

// rate_limits — the shared OVERALL plan limit (per GTM-005 framing), from the
// statusline payload's readings as the turns table stores them, reduced by the
// `wtclaude limit` rule (lib/rateLimits.js, RC 0.3.2). The last reading is a
// concurrent session lagging behind (newer row, older and lower figure), so the
// demo shows the CLI's 62%, not the newest row's 61%.
const LAST_TS = SESSIONS.reduce((a, s) => (s.ended_at > a ? s.ended_at : a), '') || NOW.toISOString();
const iso = (ms) => new Date(ms).toISOString();
const R5 = NOW.getTime() + 2.4 * 3600 * 1000;
const R7 = NOW.getTime() + 3.1 * DAY_MS;
const RATE_LIMIT_READINGS = [
  { ts: iso(Date.parse(LAST_TS) - 14 * 60_000), rate_limit_5h_pct: 58, rate_limit_5h_resets_at: iso(R5), rate_limit_7d_pct: 40, rate_limit_7d_resets_at: iso(R7) },
  { ts: iso(Date.parse(LAST_TS) - 3 * 60_000), rate_limit_5h_pct: 62, rate_limit_5h_resets_at: iso(R5), rate_limit_7d_pct: 41, rate_limit_7d_resets_at: iso(R7) },
  { ts: LAST_TS, rate_limit_5h_pct: 61, rate_limit_5h_resets_at: iso(R5 + 20_000), rate_limit_7d_pct: 41, rate_limit_7d_resets_at: iso(R7) },
];
const RATE_LIMITS = latestRateLimitReading(RATE_LIMIT_READINGS);

const BADGES = [
  { badge_type: 'first_session', earned_at: new Date(NOW.getTime() - 29 * DAY_MS).toISOString() },
  { badge_type: '100k_club', earned_at: new Date(NOW.getTime() - 28 * DAY_MS).toISOString() },
  { badge_type: 'million_club', earned_at: new Date(NOW.getTime() - 20 * DAY_MS).toISOString() },
  { badge_type: '10m_club', earned_at: new Date(NOW.getTime() - 8 * DAY_MS).toISOString() },
  { badge_type: 'week_streak', earned_at: new Date(NOW.getTime() - 14 * DAY_MS).toISOString() },
  { badge_type: 'model_mixer', earned_at: new Date(NOW.getTime() - 12 * DAY_MS).toISOString() },
];

const LEADERBOARD = {
  weekly: [
    { rank: 1, user_id: 'anon_7f3a9c21', total_tokens: 184_200_000, session_count: 142, turn_count: 2310 },
    { rank: 2, user_id: 'anon_2b8e4d10', total_tokens: 151_800_000, session_count: 119, turn_count: 1980 },
    { rank: 3, user_id: 'anon_9d1c6a44', total_tokens: 132_400_000, session_count: 98, turn_count: 1640 },
    { rank: 4, user_id: 'anon_c4f2e8b7', total_tokens: 98_100_000, session_count: 71, turn_count: 1120 },
    { rank: 5, user_id: 'anon_5a0b3f9e', total_tokens: 76_500_000, session_count: 60, turn_count: 940 },
  ],
  monthly: [
    { rank: 1, user_id: 'anon_2b8e4d10', total_tokens: 612_000_000, session_count: 488, turn_count: 8012 },
    { rank: 2, user_id: 'anon_7f3a9c21', total_tokens: 598_400_000, session_count: 510, turn_count: 8340 },
    { rank: 3, user_id: 'anon_c4f2e8b7', total_tokens: 401_900_000, session_count: 301, turn_count: 4870 },
  ],
};

// A small always-loaded inventory so the populated /context-waste state can be
// demoed (the browser can't scan ~/.claude; `wtclaude waste` does that). Item
// types are the ones `wtclaude waste` judges: skills and subagents (CLAUDE.md
// files are listed there but never judged, QA-0928-71).
const CONTEXT_INVENTORY = {
  model: 'claude-opus-5-5',
  days: 30,
  turns: 1840,
  used_ids: ['skill:deploy', 'agent:reviewer'],
  items: [
    { id: 'agent:reviewer', type: 'agent', name: 'reviewer', tokens: 2400 },
    { id: 'skill:deploy', type: 'skill', name: 'deploy', tokens: 1100 },
    { id: 'skill:pdf', type: 'skill', name: 'pdf', tokens: 1900 },
    { id: 'agent:db-migrator', type: 'agent', name: 'db-migrator', tokens: 5200 },
    { id: 'skill:slides', type: 'skill', name: 'slides', tokens: 1600 },
  ],
};

export function mockDashboard({ days = 30, tz = 'UTC' } = {}) {
  const today = dateInZone(NOW, tz);
  const windowStart = addDays(today, -(days - 1));
  const startUtc = addDays(NOW.toISOString().slice(0, 10), -(days - 1));
  // Sessions with any turn in the window, each with its in-window spend.
  const sessions = [];
  for (const s of SESSIONS) {
    const inWindow = TURNS_BY_ID[s.id].filter((t) => dateInZone(new Date(t.ts), tz) >= windowStart);
    if (!inWindow.length) continue;
    sessions.push({ ...s, window_total_usd: Math.round(inWindow.reduce((a, t) => a + turnCostOf(t), 0) * 1e6) / 1e6 });
  }
  const last = SESSIONS.reduce((a, s) => (s.ended_at > a ? s.ended_at : a), '');
  return {
    meta: {
      source: 'mock', generated_at: NOW.toISOString(), days, tz,
      window_start: windowStart, last_activity_at: last || null,
    },
    daily_summaries: buildDailySummaries(sessions, startUtc),
    ...buildLocal(sessions, tz, windowStart),
    sessions, // list view (turn detail lives in get-session)
    badges: BADGES,
    devices: buildDevices(sessions),
    rate_limits: RATE_LIMITS,
    context_inventory: CONTEXT_INVENTORY,
  };
}

export function mockSession(sessionId) {
  const s = SESSIONS.find((x) => x.id === sessionId || x.session_id === sessionId);
  if (!s) return null;
  const turns = TURNS_BY_ID[s.id] || [];
  return { ...s, turns, total_turns: turns.length };
}

export function mockLeaderboard(period = 'weekly') {
  return { leaderboard: LEADERBOARD[period] || LEADERBOARD.weekly, period };
}

