// ─────────────────────────────────────────────────────────────────────────────
// The current plan-limit reading from synced turns — a port of the CLI's
// latestRateLimit (src/utils/sessions.js, QA-0928-61), pinned to it by
// rateLimits.test.js.
//
// The newest row by time is NOT the current reading: concurrent sessions report
// the same window, and a lagging session's newer row can carry an older, lower
// percentage (a real reading shown a point low). So per limit (5-hour, 7-day,
// independently): take the newest window — the latest resets_at — and the
// highest percentage any row reported for it. captured_at is the newest
// snapshot time. A limit with no reading stays null (the gauge shows "—").
//
// get-dashboard's dashboard_rate_limits (migration 009) applies this same rule in
// SQL, so the Overview gauge and `wtclaude limit` agree on the same data (the
// edge suite compares the two directly). The demo payload (fixtures.js) is built
// with this rule, and rateLimits.test.js pins it to the CLI on a fixture where
// the old newest-row-by-time rule reads lower.
// ─────────────────────────────────────────────────────────────────────────────

// Readings from the same window can differ by a few seconds of resets_at.
const SAME_WINDOW_MS = 5 * 60 * 1000;

// resets_at as epoch seconds, milliseconds or an ISO string → ms, or null
// (mirror of src/utils/time.js normalizeResetsAt).
export function normalizeResetsAt(v) {
  if (v == null || v === '') return null;
  let ms;
  if (typeof v === 'number' || (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v.trim()))) {
    const n = Number(v);
    ms = n > 1e12 ? n : n * 1000;
  } else if (typeof v === 'string') {
    ms = Date.parse(v);
  } else {
    return null;
  }
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

const when = (t) => {
  const ms = Date.parse(t.ts ?? t.timestamp);
  return Number.isFinite(ms) ? ms : -Infinity;
};
const tsOf = (t) => t.ts ?? t.timestamp;

function pick(turns, pctKey, resetKey) {
  let newest = null, newestRow = null;
  for (const t of turns) {
    if (t[pctKey] == null) continue;
    const r = normalizeResetsAt(t[resetKey]);
    if (r != null && (newest == null || r > newest)) newest = r;
    if (!newestRow || when(t) > when(newestRow)) newestRow = t;
  }
  if (!newestRow) return { used_percentage: null, resets_at: null };
  if (newest == null) return { used_percentage: Number(newestRow[pctKey]), resets_at: null };
  let pct = null, resetsAt = null;
  for (const t of turns) {
    if (t[pctKey] == null) continue;
    const r = normalizeResetsAt(t[resetKey]);
    if (r == null || Math.abs(r - newest) > SAME_WINDOW_MS) continue;
    const p = Number(t[pctKey]);
    if (Number.isFinite(p) && (pct == null || p > pct)) { pct = p; resetsAt = t[resetKey]; }
  }
  return { used_percentage: pct, resets_at: resetsAt };
}

const hasReading = (t) => t && (t.rate_limit_5h_pct != null || t.rate_limit_7d_pct != null);

// Turns (ts or timestamp, rate_limit_5h_pct / _resets_at, rate_limit_7d_pct /
// _resets_at) → get-dashboard's rate_limits shape, or null with no reading.
export function latestRateLimitReading(turns) {
  const list = (turns || []).filter(hasReading);
  if (!list.length) return null;
  const newest = list.reduce((a, t) => (when(t) > when(a) ? t : a));
  return {
    source: 'payload',
    captured_at: tsOf(newest),
    five_hour: pick(list, 'rate_limit_5h_pct', 'rate_limit_5h_resets_at'),
    seven_day: pick(list, 'rate_limit_7d_pct', 'rate_limit_7d_resets_at'),
  };
}
