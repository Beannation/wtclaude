// Shared dual-pool accounting for `credits` / `forecast` / `readiness`.
// Splits spend by billing basis: the Agent-SDK dollar-credit pool, the fast-mode
// usage-credit pool, and ordinary subscription-limit usage. All billing-grade
// (sums the per-turn cost anchor). These are NARROW Phase-0 figures — no
// plan-fit, no predictive layer (that's Phase 1 Guardian).

import { computeTurnCost } from './cost.js';

export function poolSpend(turns) {
  let agent = 0, fast = 0, subscription = 0;
  let agentTurns = 0, fastTurns = 0;
  for (const t of turns) {
    const c = computeTurnCost(t);
    if (t.billing_basis === 'agent_sdk_credits' || t.usage_pool === 'agent_sdk') {
      agent += c; agentTurns++;
    } else if (t.billing_basis === 'fast_mode_usage_credits' || t.speed_tier === 'fast') {
      fast += c; fastTurns++;
    } else {
      subscription += c;
    }
  }
  return { agent, fast, subscription, total: agent + fast + subscription, agentTurns, fastTurns };
}

// Per-day agent-pool spend over [startStr,endStr], for a simple (non-predictive)
// run-rate. Returns { perDay: {date: usd}, days, avgPerDay }.
export function agentDailyRunRate(turns) {
  const perDay = {};
  for (const t of turns) {
    if (!(t.billing_basis === 'agent_sdk_credits' || t.usage_pool === 'agent_sdk')) continue;
    const d = t.ts.slice(0, 10);
    perDay[d] = (perDay[d] || 0) + computeTurnCost(t);
  }
  const days = Object.keys(perDay).length;
  const sum = Object.values(perDay).reduce((a, b) => a + b, 0);
  return { perDay, days, avgPerDay: days > 0 ? sum / days : 0, sum };
}

// Cached OAuth extra_usage object (build-spec M7) if sync has written it to
// config. Treated as an aggregate (not fast-isolated), cached last-known with a
// staleness label. Returns null when unavailable.
export function getExtraUsage(config) {
  const eu = config && config.extra_usage;
  if (!eu || typeof eu !== 'object') return null;
  return {
    is_enabled: !!eu.is_enabled,
    used_credits: typeof eu.used_credits === 'number' ? eu.used_credits : null,
    monthly_limit: typeof eu.monthly_limit === 'number' ? eu.monthly_limit : null,
    currency: eu.currency || 'USD',
    as_of: config.extra_usage_updated_at || eu.as_of || null,
  };
}
