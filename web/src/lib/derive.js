// ─────────────────────────────────────────────────────────────────────────────
// Pure derivations for the A5 parity-floor views. No network, no LLM — just
// deterministic compute over the dashboard payload (daily_summaries + sessions).
// Cost is always the USD billing-grade source; currency conversion happens at
// the format layer, never here.
// ─────────────────────────────────────────────────────────────────────────────

const todayStr = () => new Date().toISOString().slice(0, 10);
const num = (v) => Number(v || 0);

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

// Billing-grade vs estimate-only ratio → drives the headline honesty badge.
export function costBasis(t) {
  const total = t.cost || 0;
  if (total <= 0) return { tier: 'billing-grade', pct: 100 };
  const pct = Math.round((t.anchored / total) * 100);
  if (pct >= 99) return { tier: 'billing-grade', pct: 100 };
  if (pct <= 1) return { tier: 'estimate', pct };
  return { tier: 'mixed', pct };
}

// Today vs yesterday (A5 "Yesterday Delta").
export function yesterdayDelta(daily) {
  const today = todayStr();
  const yest = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const t = daily.find((d) => d.date === today);
  const y = daily.find((d) => d.date === yest);
  const tCost = num(t?.estimated_cost_usd);
  const yCost = num(y?.estimated_cost_usd);
  const diff = tCost - yCost;
  const pct = yCost > 0 ? (diff / yCost) * 100 : null;
  return { todayCost: tCost, yesterdayCost: yCost, diff, pct };
}

export function mostExpensiveSession(sessions) {
  if (!sessions.length) return null;
  return [...sessions].sort((a, b) => num(b.estimated_cost_usd) - num(a.estimated_cost_usd))[0];
}

// 24-hour heatmap weighted by cost (uses session started_at).
export function peakHours(sessions) {
  const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, cost: 0, sessions: 0 }));
  for (const s of sessions) {
    const h = new Date(s.started_at).getHours();
    buckets[h].cost += num(s.estimated_cost_usd);
    buckets[h].sessions += 1;
  }
  return buckets;
}

// 7-day-of-week heatmap weighted by cost.
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function peakDays(sessions) {
  const buckets = DOW.map((label, i) => ({ dow: i, label, cost: 0, sessions: 0 }));
  for (const s of sessions) {
    const i = new Date(s.started_at).getDay();
    buckets[i].cost += num(s.estimated_cost_usd);
    buckets[i].sessions += 1;
  }
  return buckets;
}

// Cost-by-model donut (from daily models_used counts × session costs is lossy;
// we attribute session cost across its models by turn share).
export function costByModel(sessions) {
  const map = {};
  for (const s of sessions) {
    const models = s.models_used || {};
    const totalTurns = Object.values(models).reduce((a, b) => a + b, 0) || 1;
    for (const [model, count] of Object.entries(models)) {
      map[model] = (map[model] || 0) + num(s.estimated_cost_usd) * (count / totalTurns);
    }
  }
  return Object.entries(map)
    .map(([name, value]) => ({ name, value: Math.round(value * 1e4) / 1e4 }))
    .sort((a, b) => b.value - a.value);
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

// Simple monthly run-rate projection: trailing daily average × 30. Estimate.
export function runRate(daily) {
  if (!daily.length) return { dailyAvg: 0, monthly: 0, days: 0 };
  const window = daily.slice(-14); // trailing 2 weeks
  const sum = window.reduce((a, d) => a + num(d.estimated_cost_usd), 0);
  const dailyAvg = sum / window.length;
  return { dailyAvg, monthly: dailyAvg * 30, days: window.length };
}

// Agent-SDK forecast tile (pre-June-15) — projected pool spend. Estimate/forecast
// labeled; usage-pool classification is heuristic so the whole tile is an estimate.
export function forecast(daily) {
  const rr = runRate(daily);
  return {
    projectedMonthly: rr.monthly,
    dailyAvg: rr.dailyAvg,
    // Forecast band ±20% — never presented as the exact future bill.
    low: rr.monthly * 0.8,
    high: rr.monthly * 1.2,
  };
}

// Task-category breakdown. On current live payloads tool_names is absent →
// task_category is null, so this is honestly empty. We surface that state rather
// than fabricate a breakdown.
export function taskBreakdown(sessions) {
  const map = {};
  let withCategory = 0;
  for (const s of sessions) {
    const cat = s.task_category;
    if (cat) { map[cat] = (map[cat] || 0) + num(s.estimated_cost_usd); withCategory++; }
  }
  return {
    available: withCategory > 0,
    slices: Object.entries(map).map(([name, value]) => ({ name, value: round(value) })),
  };
}

// Group sessions by a dimension (project / branch / cost_center / device / model).
export function groupSessions(sessions, dim) {
  const map = {};
  for (const s of sessions) {
    let keys = [s[dim] || '—'];
    if (dim === 'model') keys = Object.keys(s.models_used || { '—': 1 });
    for (const key of keys) {
      if (!map[key]) map[key] = { key, cost: 0, sessions: 0, turns: 0, tokens: 0 };
      const g = map[key];
      g.cost += num(s.estimated_cost_usd);
      g.sessions += 1;
      g.turns += num(s.turn_count);
      g.tokens += num(s.total_input_tokens) + num(s.total_output_tokens);
    }
  }
  return Object.values(map).sort((a, b) => b.cost - a.cost);
}

// Multi-criteria filter for the filter chips.
export function filterSessions(sessions, filters) {
  return sessions.filter((s) => {
    if (filters.branch && s.git_branch !== filters.branch) return false;
    if (filters.cost_center && s.cost_center !== filters.cost_center) return false;
    if (filters.device_id && s.device_id !== filters.device_id) return false;
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
    if (s.device_id) { f.device_id.add(s.device_id); deviceLabels[s.device_id] = s.device_label || s.device_id; }
    for (const m of Object.keys(s.models_used || {})) f.model.add(m);
  }
  return {
    branch: [...f.branch], cost_center: [...f.cost_center],
    device_id: [...f.device_id], model: [...f.model], deviceLabels,
  };
}

// CSV export for the current (possibly filtered) session set.
export function sessionsToCSV(sessions) {
  const cols = ['session_id', 'started_at', 'ended_at', 'turn_count',
    'total_input_tokens', 'total_output_tokens', 'estimated_cost_usd',
    'cost_basis', 'git_branch', 'cost_center', 'device_label'];
  const head = cols.join(',');
  const rows = sessions.map((s) => cols.map((c) => {
    const v = s[c] ?? '';
    const str = String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  }).join(','));
  return [head, ...rows].join('\n');
}

function round(n) { return Math.round(n * 1e4) / 1e4; }
