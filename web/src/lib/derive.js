// ─────────────────────────────────────────────────────────────────────────────
// Pure derivations for the A5 parity-floor views. No network, no LLM — just
// deterministic compute over the dashboard payload (daily rows + sessions).
// Cost is always the USD billing-grade source; currency conversion happens at
// the format layer, never here.
//
// REWORKED 2026-09-28 (BUILD-018, QA-0928-24/25/27/28/29/88/89/104): every
// date-keyed figure now reads ONE normalised daily view — rows collapsed per
// date (two usage pools used to make two "days"), keyed on the local day when
// get-dashboard sends daily_local, else on the UTC day it always used (and the
// pages say "UTC"). Every function that needs "now" takes it as an argument.
// ─────────────────────────────────────────────────────────────────────────────

import { addDays, dateInZone, dateRange, localDateOf } from './dates.js';
import { AGENT_SDK_POOL } from './config.js';
import { formatDate, modelLabel } from './format.js';
import { priceTurn, resolveModel, PRICING } from './compareModels.js';

const num = (v) => Number(v || 0);

// Legacy window totals over raw daily_summaries rows (WhatIf reads this).
export function totals(daily) {
  return daily.reduce((acc, d) => {
    acc.cost += num(d.estimated_cost_usd);
    acc.anchored += num(d.anchored_cost_usd);
    acc.estimateOnly += num(d.estimated_only_cost_usd);
    acc.fast += num(d.fast_cost_usd);
    acc.tokens += num(d.total_input_tokens) + num(d.total_output_tokens)
      + num(d.total_cache_read) + num(d.total_cache_write);
    acc.sessions += num(d.session_count);
    acc.turns += num(d.turn_count);
    return acc;
  }, { cost: 0, anchored: 0, estimateOnly: 0, fast: 0, tokens: 0, sessions: 0, turns: 0 });
}

// ── The normalised daily view ────────────────────────────────────────────────

// daily_summaries row (UTC date, pre-0.3.2 server) → common row shape.
function fromSummary(d) {
  return {
    date: d.date, usage_pool: d.usage_pool || 'interactive',
    cost: num(d.estimated_cost_usd), anchored: num(d.anchored_cost_usd),
    estimateOnly: num(d.estimated_only_cost_usd), fast: num(d.fast_cost_usd),
    input: num(d.total_input_tokens), output: num(d.total_output_tokens),
    cacheRead: num(d.total_cache_read), cacheWrite: num(d.total_cache_write),
    sessions: num(d.session_count), turns: num(d.turn_count),
    apiMs: num(d.api_duration_ms), models_used: d.models_used || {},
  };
}

// daily_local row (contract B: local date in meta.tz) → common row shape.
function fromLocal(d) {
  return {
    date: d.date, usage_pool: d.usage_pool || 'interactive',
    cost: num(d.total_usd), anchored: num(d.anchored_usd),
    estimateOnly: num(d.estimate_usd), fast: num(d.fast_usd),
    input: num(d.input_tokens), output: num(d.output_tokens),
    cacheRead: num(d.cache_read_tokens), cacheWrite: num(d.cache_write_tokens),
    sessions: num(d.session_count), turns: num(d.turn_count),
    apiMs: num(d.api_duration_ms), models_used: d.models_used || {},
  };
}

const SUM_FIELDS = ['cost', 'anchored', 'estimateOnly', 'fast', 'input', 'output', 'cacheRead', 'cacheWrite', 'sessions', 'turns', 'apiMs'];

// daily rows are one per (date, usage_pool) — QA-0928-104. Sum them per date.
export function collapseByDate(rows) {
  const map = new Map();
  for (const r of rows) {
    let d = map.get(r.date);
    if (!d) { d = { date: r.date, models_used: {} }; for (const f of SUM_FIELDS) d[f] = 0; map.set(r.date, d); }
    for (const f of SUM_FIELDS) d[f] += num(r[f]);
    for (const [m, c] of Object.entries(r.models_used || {})) d.models_used[m] = (d.models_used[m] || 0) + num(c);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// { rows (one per date), poolRows (per pool), local, tz, today, days,
//   windowStart, fastFallback, apiFallback, firstDate }
export function dailyView(data, now = new Date()) {
  const meta = data.meta || {};
  const local = Array.isArray(data.daily_local);
  const tz = local ? (meta.tz || 'UTC') : 'UTC';
  const poolRows = local ? data.daily_local.map(fromLocal) : (data.daily_summaries || []).map(fromSummary);
  // daily_local may carry fast_usd and api_duration_ms (optional fields a later
  // get-dashboard can add). When the rows carry a field it is used as sent — a
  // 0 is a real 0. When they don't, the window's fast-mode spend and active time
  // come from the UTC rows instead (viewTotals caps fast spend at the anchored
  // total — fast-mode spend is part of the anchored figure, not on top of it).
  const localHas = (k) => local && data.daily_local.some((d) => d && d[k] != null);
  const utcSum = (k) => (data.daily_summaries || []).reduce((a, d) => a + num(d[k]), 0);
  const fastFallback = local && !localHas('fast_usd') ? utcSum('fast_cost_usd') : 0;
  const apiFallback = local && !localHas('api_duration_ms') ? utcSum('api_duration_ms') : null;
  const rows = collapseByDate(poolRows);
  const today = dateInZone(now, tz);
  const days = Math.max(1, parseInt(meta.days, 10) || 30);
  const windowStart = meta.window_start || addDays(today, -(days - 1));
  // meta.first_activity_at (optional): the user's first stored turn, any window,
  // as a date on this view's calendar. null when absent or unreadable.
  const firstAt = meta.first_activity_at ? new Date(meta.first_activity_at) : null;
  const firstDate = firstAt && !Number.isNaN(firstAt.getTime()) ? dateInZone(firstAt, tz) : null;
  return { rows, poolRows, local, tz, today, days, windowStart, fastFallback, apiFallback, firstDate };
}

const TOTAL_FIELDS = ['cost', 'anchored', 'estimateOnly', 'fast', 'input', 'output', 'cacheRead', 'cacheWrite', 'turns', 'apiMs'];
export function sumRows(rows) {
  const t = Object.fromEntries(TOTAL_FIELDS.map((f) => [f, 0]));
  for (const r of rows) for (const f of TOTAL_FIELDS) t[f] += num(r[f]);
  t.tokens = t.input + t.output + t.cacheRead + t.cacheWrite;
  return t;
}

// Window totals from the view (fast share and active time from the UTC rows
// when daily_local doesn't carry them).
export function viewTotals(view) {
  const t = sumRows(view.rows);
  if (!t.fast && view.fastFallback) t.fast = Math.min(view.fastFallback, t.anchored);
  if (view.apiFallback != null) t.apiMs = view.apiFallback;
  return t;
}

// Billing-grade vs estimate for a set of figures → the honesty badge.
// Billing-grade means the WHOLE figure is anchored (QA-0928-89): a single
// estimated turn makes it a mix, however small.
export function costBasis(t) {
  const anchored = num(t.anchored);
  const est = t.estimateOnly != null ? num(t.estimateOnly) : Math.max(0, num(t.cost) - anchored);
  if (num(t.cost) <= 0 && anchored <= 0 && est <= 0) return { tier: 'billing-grade', pct: 100 };
  if (est < 0.005) return { tier: 'billing-grade', pct: 100 };
  if (anchored < 0.005) return { tier: 'estimate', pct: 0 };
  const pct = Math.min(99, Math.max(1, Math.round((anchored / (anchored + est)) * 100)));
  return { tier: 'mixed', pct };
}

// StatCard badge props for a basis: a mixed figure names its real share.
export function basisBadgeProps(basis) {
  if (basis.tier !== 'mixed') return { badge: basis.tier };
  return {
    badge: 'mixed',
    badgeLabel: basis.pct >= 50 ? 'mostly billing-grade' : 'mostly estimated',
    badgeTitle: `${basis.pct}% of this figure is billing-grade; the rest is estimated from list rates for turns without the cost anchor.`,
  };
}

const BASIS_RANK = { 'billing-grade': 2, mixed: 1, estimate: 0 };
// The weaker of two bases — a delta is only as good as its worse side.
export function weakerBasis(a, b) {
  return BASIS_RANK[a.tier] <= BASIS_RANK[b.tier] ? a : b;
}

// Today vs yesterday (A5 "Yesterday Delta"), each with its own basis.
export function yesterdayDelta(view) {
  const yest = addDays(view.today, -1);
  const t = view.rows.find((d) => d.date === view.today) || { cost: 0, anchored: 0, estimateOnly: 0 };
  const y = view.rows.find((d) => d.date === yest) || { cost: 0, anchored: 0, estimateOnly: 0 };
  const diff = t.cost - y.cost;
  const pct = y.cost > 0 ? (diff / y.cost) * 100 : null;
  const todayBasis = costBasis(t);
  const yesterdayBasis = costBasis(y);
  return {
    todayCost: t.cost, yesterdayCost: y.cost, diff, pct,
    todayBasis, yesterdayBasis, basis: weakerBasis(todayBasis, yesterdayBasis),
  };
}

// Monthly run-rate (QA-0928-25): spend over the last N CALENDAR days (today
// included, idle days zero) ÷ N × 30. N is 14, or the fetched window if shorter.
// It used to average the last 14 ROWS — days with spend only — which overstated
// a gappy month ~2.4x and kept projecting July as "current" on stale data.
// When tracking began inside those N days, N is the days since it began (the
// CLI's coveredDays, QA-0928-73): days before the first turn weren't idle, they
// weren't tracked. See trackingStart for where that date comes from.
function daysInclusive(from, to) {
  const utc = (s) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((utc(to) - utc(from)) / 86_400_000) + 1;
}

// When tracking began, as a date on this view's calendar → { date, exact } or
// null. get-dashboard 0.3.2 sends meta.first_activity_at (the user's first
// stored turn, any window): exact. Today's server doesn't (RC 0.3.2, dash-prod),
// and dividing by the whole window then read up to window ÷ days-tracked low —
// several times under `wtclaude whatif --days 365`. The first synced day in the
// fetched window is the best the payload can say, so it stands in, flagged
// inexact: the pages say it is the window's first synced day, and that the
// figure is lower if tracking began before it.
export function trackingStart(view) {
  if (view.firstDate) return { date: view.firstDate, exact: true };
  const first = view.rows.find((r) => num(r.turns) > 0 || num(r.cost) > 0);
  return first ? { date: first.date, exact: false } : null;
}

// The days a projection over the last `lookback` days divides by (the CLI's
// coveredDays): the look-back (capped at the fetched window), or the days since
// tracking began when that is inside it.
export function coveredDays(view, lookback = view.days) {
  const full = Math.max(1, Math.min(lookback, view.days));
  const start = trackingStart(view);
  const began = start && start.date <= view.today ? daysInclusive(start.date, view.today) : Infinity;
  const days = Math.max(1, Math.min(full, began));
  return { days, full, sinceStart: days < full, exact: start ? start.exact : true, firstDate: start ? start.date : null };
}

function trailing(rows, view, lookback) {
  const c = coveredDays(view, lookback);
  const start = addDays(view.today, -(c.days - 1));
  const inWindow = rows.filter((r) => r.date >= start && r.date <= view.today);
  const sum = inWindow.reduce((a, r) => a + num(r.cost), 0);
  return {
    days: c.days, sinceStart: c.sinceStart, exact: c.exact, firstDate: c.firstDate,
    sum, dailyAvg: sum / c.days, monthly: (sum / c.days) * 30, empty: sum <= 0,
  };
}

// What If's /mo basis over the whole fetched window (mirror of the CLI's
// coveredDays + projectionNote), on this view's calendar → { covered, exact,
// firstDate, note } or null when the window has no synced day. `note` has no
// closing period (the page continues the sentence).
export function monthlyProjectionBasis(view) {
  if (!trackingStart(view)) return null;
  const c = coveredDays(view, view.days);
  const n = view.days;
  const plural = c.days === 1 ? '' : 's';
  let note;
  if (!c.sinceStart) note = `Projected from the full ${n}-day window`;
  else if (c.exact) note = `Projected from ${c.days} day${plural} of data — tracking began inside the ${n}-day window`;
  else {
    note = `Projected from ${c.days} day${plural} of synced data, from ${c.firstDate}${view.local ? '' : ' UTC'}, `
      + `your first synced day in the ${n}-day window (this server doesn't say when tracking began; `
      + 'if it began earlier, the monthly figure is lower)';
  }
  return { covered: c.days, exact: c.exact, firstDate: c.firstDate, note };
}

export function runRate(view, lookback = 14) {
  return trailing(view.rows, view, lookback);
}

// The run-rate card's line. The idle-day zero is a word, not "$0", so it reads
// right in any display currency (RC 0.3.2). `fc` formats a USD figure.
export function runRateNote(rr, { utc = false, fc = String } = {}) {
  const u = utc ? 'UTC ' : '';
  const dayWord = rr.days === 1 ? 'day' : 'days';
  if (rr.empty) return `No synced spend in the last ${rr.days} ${u}${dayWord}.`;
  const per = `${fc(rr.dailyAvg)}/day: the`;
  const idle = `÷ ${rr.days}, idle days counted as zero.`;
  if (!rr.sinceStart) return `${per} last ${rr.days} ${u}${dayWord} ${idle}`;
  if (rr.exact) return `${per} ${rr.days} ${u}${dayWord} since tracking began ${idle}`;
  return `${per} ${rr.days} ${u}${dayWord} since your first synced day in this window (${rr.firstDate}) ${idle}`
    + " This server doesn't say when tracking began; if it began earlier, the rate is lower.";
}

// Agent-SDK pool (QA-0928-24): only agent_sdk rows, never all spend. While the
// split is paused the tile says so; with no agent rows there is nothing to
// forecast (the CLI's `wtclaude forecast` says the same).
export function agentPool(view, lookback = 14) {
  const agentRows = collapseByDate(view.poolRows.filter((r) => r.usage_pool === 'agent_sdk'));
  const rr = trailing(agentRows, view, lookback);
  return { activated: AGENT_SDK_POOL.activated === true, hasData: !rr.empty, ...rr };
}

// Daily cost chart: one bar per calendar day of the window, zero-filled. A
// window that crosses a year boundary (every 365-day one) puts the year on its
// labels — 'Sep 29 … Sep 28' read as one day (RC 0.3.2); `fullLabel` (for the
// tooltip) always has it.
export function dailyChart(view) {
  const byDate = new Map(view.rows.map((r) => [r.date, r.cost]));
  const start = view.windowStart <= view.today ? view.windowStart : view.today;
  const year = start.slice(0, 4) !== view.today.slice(0, 4);
  return dateRange(start, view.today).map((date) => ({
    date, label: formatDate(date, { year }), fullLabel: formatDate(date, { year: true }), cost: byDate.get(date) || 0,
  }));
}

// ── Sessions ─────────────────────────────────────────────────────────────────

// A synced turn's cost and how much we can say about it — the CLI's
// turnCostBasis (src/utils/cost.js) on a get-session turn row (RC 0.3.2),
// pinned to it by turnCostBasis.test.js:
//  • the cost anchor (cost_usd; a legacy 0 with no cumulative figure is not
//    one) is billing-grade;
//  • an unanchored turn with the list-rate estimate a 0.3.2 CLI sent
//    (cost_estimate_usd, contract A) is 'estimated' at that figure;
//  • an unanchored turn with NO estimate is priced here as the CLI prices it:
//    a model the rate sheet can price gets its list-rate estimate from its
//    tokens; a model it can't (unresolved, partner-platform, family fallback)
//    on a turn with tokens is 'not-priced' — no figure, as the CLI excludes it;
//  • a turn with no tokens costs zero on any rate — an estimated 0.
// The no-estimate case is not rare: it is every unanchored turn a 0.3.1 sync
// stored (today's get-session has no estimate column) and every one an older
// CLI syncs after the deploy. Reading it as 'not priced' (RC 0.3.2 regression)
// called a priceable model unpriceable and said it counted zero in a total
// that includes its estimate.
// → { usd (null when not priced), basis }.
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
export function hasCostAnchor(t) {
  const c = numOrNull(t && t.cost_usd);
  return c != null && !(c === 0 && numOrNull(t.cumulative_cost_usd) == null);
}
const turnTokens = (t) => ({
  input_tokens: num(t && t.input_tokens), output_tokens: num(t && t.output_tokens),
  cache_read_tokens: num(t && t.cache_read_tokens), cache_write_tokens: num(t && t.cache_write_tokens),
});
// The CLI's priceTurn on a stored turn. compareModels.priceTurn is its
// standard-tier mirror; a turn stamped 'fast' on a model with fast-mode rates
// is priced at those, with the cache multipliers on top of the fast input rate
// (cost.js / pricing.getRates). Rates come from the shared table only.
function listRatePrice(t) {
  const tok = turnTokens(t);
  const p = priceTurn(t && t.model, tok);
  const fast = t && t.speed_tier === 'fast' ? resolveModel(t.model)?.entry?.fast_mode : null;
  if (!fast) return p;
  const entry = resolveModel(t.model).entry;
  const readMult = entry.cache?.read_multiplier ?? PRICING.cache.read_multiplier;
  const usd = (tok.input_tokens / 1_000_000) * fast.input + (tok.output_tokens / 1_000_000) * fast.output
    + (tok.cache_read_tokens / 1_000_000) * fast.input * readMult
    + (tok.cache_write_tokens / 1_000_000) * fast.input * PRICING.cache.write_multiplier;
  return { ...p, usd };
}
export function turnCostBasis(t) {
  if (hasCostAnchor(t)) return { usd: Number(t.cost_usd), basis: 'billing-grade' };
  const est = numOrNull(t && t.cost_estimate_usd);
  if (est != null) return { usd: est, basis: 'estimated' };
  const tok = turnTokens(t);
  const hasTokens = tok.input_tokens + tok.output_tokens + tok.cache_read_tokens + tok.cache_write_tokens > 0;
  const p = listRatePrice(t);
  if (!p.priceable && hasTokens) return { usd: null, basis: 'not-priced' };
  return { usd: p.usd, basis: 'estimated' };
}

// Session detail (RC 0.3.2): each turn's basis, and whether the turn list adds
// up to the session total in the header. Only then may the page say where an
// estimated or not-priced turn sits in that total: the header is the session's
// stored total, and one synced by an older wtclaude carries the total that
// version worked out (0.3.1 counted a legacy $0 row as $0 and priced a
// family-fallback model by its guess). `reconciles` needs the whole list.
export function sessionTurnSummary(session, turns) {
  const bases = turns.map(turnCostBasis);
  const notPriced = turns.filter((t, i) => bases[i].basis === 'not-priced');
  const listUsd = bases.reduce((a, b) => a + (b.usd ?? 0), 0);
  const total = numOrNull(session && session.estimated_cost_usd);
  const totalTurns = Number(session?.total_turns ?? session?.turn_count ?? turns.length);
  const complete = turns.length >= totalTurns;
  return {
    bases,
    estimatedTurns: bases.filter((b) => b.basis === 'estimated').length,
    notPricedTurns: notPriced.length,
    notPricedModels: [...new Set(notPriced.map((t) => t.model).filter(Boolean))],
    listUsd, total, complete,
    reconciles: complete && total != null && Math.abs(listUsd - total) <= Math.max(0.005, Math.abs(total) * 1e-4),
  };
}

// The line above the turn list, or null. `fc` formats a USD figure.
export function turnListNote(sum, fc = String) {
  const n = sum.estimatedTurns;
  const m = sum.notPricedTurns;
  const parts = [];
  if (n) parts.push(`${n} turn${n === 1 ? '' : 's'} without Claude Code's cost figure ${n === 1 ? 'is' : 'are'} estimated from list rates.`);
  if (m) {
    const models = sum.notPricedModels.length ? ` (${sum.notPricedModels.join(', ')})` : '';
    const where = sum.reconciles
      ? `${m === 1 ? 'it counts' : 'they count'} zero in the total above`
      : `wtclaude session counts ${m === 1 ? 'it' : 'them'} as zero`;
    parts.push(`${m} turn${m === 1 ? '' : 's'} ${m === 1 ? 'is' : 'are'} not priced${models}: no cost figure and no rate we can stand behind, so ${where}.`);
  }
  if ((n || m) && sum.complete && sum.total != null && !sum.reconciles && fc(sum.listUsd) !== fc(sum.total)) {
    parts.push(`These turns add up to ${fc(sum.listUsd)}, not the ${fc(sum.total)} above: that total was worked out when the session was synced, and turns without Claude Code's cost figure were priced differently then.`);
  }
  return parts.length ? parts.join(' ') : null;
}

// The session's spend inside the dashboard window when the server sends it
// (contract B), else its whole cost.
export function sessionWindowCost(s) {
  return s.window_total_usd != null ? num(s.window_total_usd) : num(s.estimated_cost_usd);
}

// Distinct sessions (QA-0928-27): a session that ran over two days is one
// session. The old card summed per-day session counts.
export function distinctSessionCount(sessions) {
  return new Set(sessions.map((s) => s.id || s.session_id)).size;
}

export function mostExpensiveSession(sessions) {
  if (!sessions.length) return null;
  return [...sessions].sort((a, b) => num(b.estimated_cost_usd) - num(a.estimated_cost_usd))[0];
}

// Peak hour / weekday buckets (QA-0928-29). With hourly_local the buckets are
// turn spend by local hour and weekday — when the money was spent. Without it
// they fall back to each session's whole cost at its START hour, and the page
// labels them "by session start" with no $ peak.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function peakBuckets(data) {
  const hours = Array.from({ length: 24 }, (_, h) => ({ label: String(h).padStart(2, '0'), value: 0, count: 0 }));
  const days = DOW.map((label) => ({ label, value: 0, count: 0 }));
  if (Array.isArray(data.hourly_local)) {
    for (const b of data.hourly_local) {
      const h = num(b.hour), d = num(b.dow);
      if (hours[h]) { hours[h].value += num(b.total_usd); hours[h].count += num(b.turn_count); }
      if (days[d]) { days[d].value += num(b.total_usd); days[d].count += num(b.turn_count); }
    }
    return { basis: 'turn-time', hours, days };
  }
  for (const s of data.sessions || []) {
    const t = new Date(s.started_at);
    if (Number.isNaN(t.getTime())) continue;
    hours[t.getHours()].value += sessionWindowCost(s); hours[t.getHours()].count += 1;
    days[t.getDay()].value += sessionWindowCost(s); days[t.getDay()].count += 1;
  }
  return { basis: 'session-start', hours, days };
}

// Per-model figures (Cost by model, Group by Model; QA-0928-28, RC 0.3.2).
//
// get-dashboard sends each session's in-window cost but no per-model cost, so a
// session's cost is split across its models by turn share — approximate, and
// the pages say so. When a session carries window_models (per-model in-window
// sums; a server field handed to the server stream) its figures are exact.
//
// A model the rate sheet can't price is the hard case. An unanchored turn on it
// is excluded by the CLI (counts zero, 'Not priced'); an anchored one carries
// Claude Code's own cost. The payload says only whether a session's turns are
// all anchored (cost_basis 'billing-grade'), none are ('estimate'), or some are
// ('mixed'), never which model's. So, by session:
//  • billing-grade: every model gets its turn share (it is Claude Code's cost);
//  • estimate: an unpriceable model's turns are all excluded — it gets nothing
//    and is 'not priced'; the estimate is split across the priceable models;
//  • mixed (or unknown): its turns may be either. Its turn share is neither its
//    own nor the other models' — it is kept apart as 'not split by model', and
//    the model shows no figure from that session and no claim about its cost.
//    (RC 0.3.2: first it got a priced turn's share, a dollar figure for a real
//    zero; then $0, 'not priced' and its share handed to the other models,
//    which is false for a new model whose turns carry Claude Code's cost.)
export const NOT_SPLIT_KEY = '(not split by model)';
export const MODEL_SPLIT_TITLES = {
  notPriced: 'No figure: these turns carry no Claude Code cost and the model has no rate we can stand behind, so they count zero, as the CLI shows them.',
  notSplit: 'No figure of its own: the rate sheet can’t price this model, and in sessions that mix turns with and without Claude Code’s cost figure the payload can’t say whether its turns carry one. Its turn share there is under “not split by model”.',
  partlyUnsplit: 'Its share in sessions where every turn carries Claude Code’s cost. In sessions that mix turns with and without that figure, its turn share is under “not split by model”.',
  bucket: 'The turn share of models the rate sheet can’t price, in sessions that mix turns with and without Claude Code’s cost figure. If those turns carry Claude Code’s cost it is theirs; if not, the CLI counts them zero and it belongs to the session’s other models.',
};

function modelPriceable(model) {
  return priceTurn(model, {}).priceable;
}

// One session's per-model rows → [{ model, usd, turns, tokens (in+out),
// excluded, unsplit }]. `unsplit` is the turn share kept apart (a number) or null.
function sessionModelRows(s) {
  if (s.window_models && typeof s.window_models === 'object') {
    return Object.entries(s.window_models).map(([model, m]) => ({
      model, usd: num(m && m.usd), turns: num(m && m.turns),
      tokens: num(m && m.input_tokens) + num(m && m.output_tokens),
      excluded: num(m && m.usd) === 0 && num(m && m.excluded_turns) > 0,
      unsplit: null,
    }));
  }
  const cost = sessionWindowCost(s);
  const tokens = num(s.total_input_tokens) + num(s.total_output_tokens);
  const entries = Object.entries(s.models_used || {}).filter(([, c]) => num(c) > 0);
  const totalTurns = entries.reduce((a, [, c]) => a + num(c), 0);
  if (!totalTurns) return [{ model: '—', usd: cost, turns: num(s.turn_count), tokens, excluded: false, unsplit: null }];
  const row = (model, c, usd, extra = {}) => ({
    model, usd, turns: num(c), tokens: (tokens * num(c)) / totalTurns, excluded: false, unsplit: null, ...extra,
  });
  const priceable = new Set(entries.filter(([m]) => modelPriceable(m)).map(([m]) => m));
  if (s.cost_basis === 'billing-grade' || priceable.size === entries.length) {
    return entries.map(([m, c]) => row(m, c, (cost * num(c)) / totalTurns));
  }
  const pricedTurns = entries.reduce((a, [m, c]) => a + (priceable.has(m) ? num(c) : 0), 0);
  if (s.cost_basis === 'estimate' && (pricedTurns > 0 || cost === 0)) {
    return entries.map(([m, c]) => (priceable.has(m)
      ? row(m, c, (cost * num(c)) / pricedTurns)
      : row(m, c, 0, { excluded: true })));
  }
  return entries.map(([m, c]) => (priceable.has(m)
    ? row(m, c, (cost * num(c)) / totalTurns)
    : row(m, c, 0, { unsplit: (cost * num(c)) / totalTurns })));
}

// True when every session carries per-model sums (the figures are exact).
export function modelSplitIsExact(sessions) {
  return sessions.length > 0 && sessions.every((s) => s.window_models && typeof s.window_models === 'object');
}

// A model's state over every session's rows: a figure it can stand behind
// (priced), a share kept apart (unsplit), or neither (every row excluded).
function modelFlags(m) {
  return {
    notPriced: !m.priced && !m.unsplit,
    notSplit: !m.priced && m.unsplit,
    partlyUnsplit: m.priced && m.unsplit,
  };
}
const flagRank = (d) => (d.bucket ? 1 : d.notSplit ? 2 : d.notPriced ? 3 : 0);

// Cost-by-model donut → { slices: [{ name, label, value, notPriced, notSplit,
// partlyUnsplit, bucket }], exact, notPriced: [model ids], unsplitModels:
// [model ids], unsplit }. The share kept apart is one 'not split by model'
// slice, so the slices still sum to the window's cost; a not-split or
// not-priced model is a zero row, listed last.
export function costByModel(sessions) {
  const map = new Map();
  let unsplit = 0;
  for (const s of sessions) {
    for (const r of sessionModelRows(s)) {
      if (r.model === '—') continue;
      const m = map.get(r.model) || { value: 0, priced: false, unsplit: false };
      m.value += r.usd;
      if (r.unsplit != null) { m.unsplit = true; unsplit += r.unsplit; } else if (!r.excluded) m.priced = true;
      map.set(r.model, m);
    }
  }
  const slices = [...map.entries()]
    .map(([name, m]) => ({ name, label: modelLabel(name), value: round(m.value), ...modelFlags(m) }));
  if (unsplit > 0) slices.push({ name: NOT_SPLIT_KEY, label: 'not split by model', value: round(unsplit), bucket: true });
  slices.sort((a, b) => (flagRank(a) - flagRank(b)) || (b.value - a.value));
  return {
    slices,
    exact: modelSplitIsExact(sessions),
    notPriced: slices.filter((d) => d.notPriced).map((d) => d.name),
    unsplitModels: [...map.entries()].filter(([, m]) => m.unsplit).map(([name]) => name),
    unsplit: round(unsplit),
  };
}

// The line under Cost by model / Group by Model saying what the figures are.
export function modelSplitNote({ exact, unsplitModels = [] }) {
  const base = exact
    ? 'Per-model sums of the turns in this window.'
    : 'Approximate: each session’s cost in this window is split across its models by turn count.';
  if (!unsplitModels.length) return base;
  const names = unsplitModels.map((m) => modelLabel(m));
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  const one = names.length === 1;
  return `${base} ${list} ${one ? 'has' : 'have'} no rate we can stand behind, and in sessions that mix turns with and without Claude Code’s cost figure the payload can’t say whether ${one ? 'its' : 'their'} turns carry one, so ${one ? 'its' : 'their'} share there is shown as not split by model.`;
}

// Cost-by-source donut — the HONESTY split: billing-grade anchor vs estimate vs
// fast-mode usage credits. This is load-bearing, not decoration.
export function costBySource(t) {
  const out = [];
  const standardAnchored = Math.max(0, t.anchored - t.fast);
  if (standardAnchored > 0) out.push({ name: 'Billing-grade', value: round(standardAnchored), basis: 'billing-grade' });
  if (t.fast > 0) out.push({ name: 'Fast-mode credits', value: round(t.fast), basis: 'inferred' });
  if (t.estimateOnly > 0) out.push({ name: 'Estimated', value: round(t.estimateOnly), basis: 'estimate' });
  return out;
}

// Task-category breakdown. On current live payloads tool_names is absent →
// task_category is null, so this is honestly empty. We surface that state rather
// than fabricate a breakdown.
export function taskBreakdown(sessions) {
  const map = {};
  let withCategory = 0;
  for (const s of sessions) {
    const cat = s.task_category;
    if (cat) { map[cat] = (map[cat] || 0) + sessionWindowCost(s); withCategory++; }
  }
  return {
    available: withCategory > 0,
    slices: Object.entries(map).map(([name, value]) => ({ name, value: round(value) })),
  };
}

// ── Branches (QA-0928-05, 0.3.2) ─────────────────────────────────────────────
// The 0.3.2 CLI uploads git_branch as '#' + a 12-hex salted hash, and migration
// 009 nulls any raw name already stored, so a synced branch is a hash or null.
// A hash is shown as what it is — a hashed branch — never as if it were the
// branch's name; a session with no branch is headed by its short id.
export const HASHED_BRANCH_NOTE = 'Branch names are hashed before upload';

export function isHashedBranch(b) {
  return typeof b === 'string' && /^#[0-9a-f]{12}$/i.test(b);
}

// → { kind: 'Branch (hashed)' | 'Branch' | 'Session', text, title }. 'Branch'
// is a legacy raw name (a row stored before migration 009).
export function sessionHeading(s, idChars = 12) {
  const b = s ? s.git_branch : null;
  if (isHashedBranch(b)) return { kind: 'Branch (hashed)', text: b, title: HASHED_BRANCH_NOTE };
  if (b) return { kind: 'Branch', text: String(b), title: null };
  return { kind: 'Session', text: String((s && s.session_id) || '').slice(0, idChars), title: null };
}

// The label for the branch filter / Group by: 'Branch (hashed)' when every
// branch in view is a hash (always, once migration 009 has run), plain
// 'Branch' while legacy raw names are still stored.
export function branchDimLabel(branches) {
  const list = (branches || []).filter(Boolean);
  return list.length > 0 && list.every(isHashedBranch) ? 'Branch (hashed)' : 'Branch';
}

// A Group-by-branch key for display: groupSessions keys a missing branch '—'.
export function branchGroupLabel(key) {
  return key === '—' ? 'No branch recorded' : key;
}

// Group sessions by a dimension (project / branch / cost_center / device / model).
// By model, each session is split as Cost by model splits it (see
// sessionModelRows), so the groups sum to the sessions' cost: the share kept
// apart is one NOT_SPLIT_KEY group (`bucket`, with the sessions it came from;
// its turns and tokens stay with their models). `sessions` counts the sessions
// that USED the model; `notPriced` / `notSplit` / `partlyUnsplit` as costByModel.
export function groupSessions(sessions, dim) {
  const map = {};
  let bucket = null;
  for (const s of sessions) {
    const rows = dim === 'model'
      ? sessionModelRows(s)
      : [{
        model: dim === 'device_id' ? deviceKey(s.device_id) : (s[dim] || '—'), usd: sessionWindowCost(s),
        turns: num(s.turn_count), tokens: num(s.total_input_tokens) + num(s.total_output_tokens), excluded: false, unsplit: null,
      }];
    for (const r of rows) {
      if (!map[r.model]) map[r.model] = { key: r.model, cost: 0, sessions: 0, turns: 0, tokens: 0, priced: false, unsplit: false };
      const g = map[r.model];
      g.cost += r.usd;
      g.sessions += 1;
      g.turns += r.turns;
      g.tokens += r.tokens;
      if (r.unsplit != null) {
        g.unsplit = true;
        bucket = bucket || { key: NOT_SPLIT_KEY, cost: 0, sessionIds: new Set(), turns: 0, tokens: 0, bucket: true };
        bucket.cost += r.unsplit;
        bucket.sessionIds.add(s.id || s.session_id);
      } else if (!r.excluded) g.priced = true;
    }
  }
  const out = Object.values(map)
    .map(({ priced, unsplit, ...g }) => (dim === 'model' ? { ...g, ...modelFlags({ priced, unsplit }) } : g));
  if (bucket && bucket.cost > 0) {
    const { sessionIds, ...b } = bucket;
    out.push({ ...b, sessions: sessionIds.size });
  }
  return out.sort((a, b) => (flagRank(a) - flagRank(b)) || (b.cost - a.cost));
}

// Multi-criteria filter for the filter chips.
export function filterSessions(sessions, filters) {
  return sessions.filter((s) => {
    if (filters.branch && s.git_branch !== filters.branch) return false;
    if (filters.cost_center && s.cost_center !== filters.cost_center) return false;
    if (filters.device_id && deviceKey(s.device_id) !== filters.device_id) return false;
    if (filters.model && !(s.models_used || {})[filters.model]) return false;
    if (filters.basis && s.cost_basis !== filters.basis) return false;
    return true;
  });
}

// Distinct values for building filter chips.
export function facets(sessions) {
  const f = { branch: new Set(), cost_center: new Set(), device_id: new Set(), model: new Set() };
  const deviceLabels = {};
  for (const s of sessions) {
    if (s.git_branch) f.branch.add(s.git_branch);
    if (s.cost_center) f.cost_center.add(s.cost_center);
    const dk = deviceKey(s.device_id);
    f.device_id.add(dk);
    deviceLabels[dk] = deviceLabel(s.device_id, s.device_label);
    for (const m of Object.keys(s.models_used || {})) f.model.add(m);
  }
  return {
    branch: [...f.branch], cost_center: [...f.cost_center],
    device_id: [...f.device_id], model: [...f.model], deviceLabels,
  };
}

// ── Devices (QA-0928-123) ────────────────────────────────────────────────────
// No friendly device name is synced (a hostname often carries a person's name),
// and get-dashboard labels a device with its raw id. Show a short label; a
// session with no device id predates device tracking and is not a machine.
const UNATTRIBUTED = '__unattributed__';
export function isUnattributedDevice(id) {
  return !id || id === 'unknown' || id === UNATTRIBUTED;
}
function deviceKey(id) { return isUnattributedDevice(id) ? UNATTRIBUTED : id; }

export function deviceLabel(id, label) {
  if (isUnattributedDevice(id)) return 'Unattributed (older sessions)';
  if (label && label !== id) return label;
  return `Device ${String(id).slice(0, 4)}…`;
}

// Devices page rollup: attributed devices, the unattributed bucket (not counted
// as a device), the combined figures and their honesty basis (QA-0928-89).
export function deviceSummary(devices, sessions) {
  const attributed = [];
  let unattributed = null;
  for (const d of devices || []) {
    const row = { ...d, display: deviceLabel(d.device_id, d.label) };
    if (isUnattributedDevice(d.device_id)) {
      unattributed = unattributed
        ? { ...unattributed, session_count: unattributed.session_count + num(d.session_count), turn_count: unattributed.turn_count + num(d.turn_count), cost_usd: unattributed.cost_usd + num(d.cost_usd) }
        : { ...row, session_count: num(d.session_count), turn_count: num(d.turn_count), cost_usd: num(d.cost_usd) };
    } else attributed.push(row);
  }
  attributed.sort((a, b) => num(b.cost_usd) - num(a.cost_usd));
  const all = unattributed ? [...attributed, unattributed] : attributed;
  const combined = all.reduce((acc, d) => {
    acc.cost += num(d.cost_usd); acc.sessions += num(d.session_count); acc.turns += num(d.turn_count); return acc;
  }, { cost: 0, sessions: 0, turns: 0 });
  // The badge describes the Combined figure: the in-window mix the server sends
  // per device (devices[].anchored_usd / estimate_usd, contract B) when every
  // row carries it, else the sessions' own mix as before.
  const windowMix = all.length > 0 && all.every((d) => d.anchored_usd != null && d.estimate_usd != null);
  const mix = windowMix
    ? all.reduce((acc, d) => { acc.anchored += num(d.anchored_usd); acc.estimateOnly += num(d.estimate_usd); return acc; }, { anchored: 0, estimateOnly: 0 })
    : (sessions || []).reduce((acc, s) => {
      const est = num(s.estimated_only_cost_usd) || (s.cost_basis === 'estimate' ? num(s.estimated_cost_usd) : 0);
      acc.estimateOnly += est;
      acc.anchored += s.anchored_cost_usd != null ? num(s.anchored_cost_usd) : Math.max(0, num(s.estimated_cost_usd) - est);
      return acc;
    }, { anchored: 0, estimateOnly: 0 });
  return { attributed, unattributed, combined, basis: costBasis({ ...mix, cost: mix.anchored + mix.estimateOnly }) };
}

// ── Timeline (QA-0928-88) ────────────────────────────────────────────────────
// Sessions grouped by the LOCAL calendar day they started, newest first; the
// "Today" / "Yesterday" headings compare local dates.
export function timelineDays(sessions, now = new Date()) {
  const today = dateInZone(now);
  const yest = addDays(today, -1);
  const byDay = {};
  for (const s of [...sessions].sort((a, b) => b.started_at.localeCompare(a.started_at))) {
    (byDay[localDateOf(s.started_at)] ||= []).push(s);
  }
  return Object.keys(byDay).sort((a, b) => b.localeCompare(a)).map((date) => ({
    date,
    heading: date === today ? 'Today' : date === yest ? 'Yesterday'
      : new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
    sessions: byDay[date],
  }));
}

// ── Freshness (QA-0928-92 / 127) ─────────────────────────────────────────────
// meta.last_activity_at is the newest synced turn, any window. Older than 24 h
// → the page says the cloud copy is stale instead of looking like "no usage".
export function dataFreshness(meta, now = new Date()) {
  const at = meta && meta.last_activity_at;
  const t = at ? new Date(at).getTime() : NaN;
  if (Number.isNaN(t)) return { known: false, stale: false, lastActivityAt: null };
  return { known: true, stale: now.getTime() - t > 24 * 3600_000, lastActivityAt: at };
}

// ── Plan-limit reading (QA-0928-31) ──────────────────────────────────────────
// Only the 0.3.2 get-dashboard returns the user's newest rate-limit snapshot by
// time; it is recognisable by meta.tz / meta.last_activity_at, which it always
// sends. The older function picks the newest reading among its first 1,000
// turns, so that reading is a synced one but may not be the newest. (Newest by
// time is not yet `wtclaude limit`'s rule, QA-0928-61 — see LimitGauge.jsx.)
export function limitReadingIsLatest(meta) {
  return !!meta && (typeof meta.tz === 'string' || 'last_activity_at' in meta);
}

// CSV export for the current (possibly filtered) session set.
// QA-0928-162: a cell starting with = + - @ tab or CR opens as a formula in a
// spreadsheet (a git branch can be named '=HYPERLINK(…)'), so it is prefixed
// with ' — OWASP's CSV-injection guidance. Numbers are written as numbers.
export function sessionsToCSV(sessions) {
  const cols = ['session_id', 'started_at', 'ended_at', 'turn_count',
    'total_input_tokens', 'total_output_tokens', 'estimated_cost_usd',
    'cost_basis', 'git_branch', 'cost_center', 'device_label'];
  const head = cols.join(',');
  const rows = sessions.map((s) => cols.map((c) => {
    const v = s[c] ?? '';
    let str = String(v);
    if (typeof v !== 'number' && /^[=+\-@\t\r]/.test(str)) str = `'${str}`;
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }).join(','));
  return [head, ...rows].join('\n');
}

function round(n) { return Math.round(n * 1e4) / 1e4; }
