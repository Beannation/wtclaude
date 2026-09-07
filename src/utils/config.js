// Shared config access for the CLI commands (M4). Thin wrapper over the sync
// config reader that supplies safe Phase-0 defaults so a command never crashes
// just because `setup` hasn't written the v1.9 fields yet (M6 is still partial).
// Read-only: these helpers never write config.

import { getConfig } from '../sync/index.js';
import { getLatestPricing } from './pricing.js';

export function loadConfig() {
  return getConfig() || {};
}

// Display currency: --currency flag > config.display_currency > USD.
// USD always stays the billing-grade source of truth (BUILD-015).
export function getDisplayCurrency(opts = {}) {
  if (opts && opts.currency) return String(opts.currency).toUpperCase();
  const c = loadConfig();
  return (c.display_currency || 'USD').toUpperCase();
}

// ── Agent-SDK credit-pool split: ANNOUNCED, THEN PAUSED ─────────────────────
//
// REWRITTEN 2026-08-24. The June-15 split was announced and then paused by
// Anthropic, and the pause still holds: Agent SDK usage, `claude -p` and
// third-party integrations draw the subscription's ordinary usage limits today.
// There is no separate credit wallet.
//
// This used to be a DATE gate — `today >= 2026-06-15` — which meant that from
// June 15 onward every surface told the user the split was "now active" and
// showed them a credit balance against a pool that does not exist. A date cannot
// answer this question, because the event the date described did not happen.
// The gate now reads the rate sheet's `agent_sdk_pool.activated`, which is false.
//
// If this ever reactivates, that is a critical accuracy event for us: flip
// `agent_sdk_pool.activated` in the rate sheet, not a date.

export function getAgentSdkPool() {
  const p = getLatestPricing();
  return p.agent_sdk_pool || { status: 'paused', activated: false, announced_activation_date: '2026-06-15' };
}

// The date the split was ANNOUNCED for. Retained for historical copy only — it
// is not a countdown target and must never be rendered as one.
export function getDualPoolActivationDate() {
  const c = loadConfig();
  if (c.dual_pool_activation_date) return c.dual_pool_activation_date;
  return getAgentSdkPool().announced_activation_date || '2026-06-15';
}

// Is the split actually in effect? `dual_pool_override` still forces it either
// way for testing and for the day it reactivates.
export function isDualPoolActive() {
  const c = loadConfig();
  if (typeof c.dual_pool_override === 'boolean') return c.dual_pool_override;
  return getAgentSdkPool().activated === true;
}

// One sentence, used wherever a surface would otherwise imply the split is live.
export const AGENT_SDK_POOL_PAUSED_NOTE =
  'The Agent-SDK credit split announced for June 15, 2026 is paused — SDK, `claude -p` '
  + 'and third-party usage still draw your subscription\'s ordinary usage limits, not a '
  + 'separate credit pool.';

// ── Fable: PLAN-CONDITIONAL, not a date cliff ───────────────────────────────
//
// FAMILY-SCOPED 2026-09-07: the plan mechanic below attaches to Fable as a
// family, not to any one Fable model, so Fable 5.1 inherits it unchanged.
//
// REWRITTEN 2026-08-24. Fable became a permanent, plan-conditional offering on
// 2026-07-20 (Help Center: "Claude Fable 5 on your plan"). Everything below used
// to be built on a moving "Fable cliff" date — a date after which all Fable use
// billed usage credits. That model is simply the wrong SHAPE now:
//
//   • Max, Team Premium, Enterprise Premium — Fable is INCLUDED, up to 50% of the
//     weekly usage limit. That is a share OF the weekly limit, not an allowance on
//     top of it, and it is not a credits wallet. These users have no Fable bill.
//   • Pro, Team Standard — Fable bills usage credits from the first token.
//   • Enterprise Standard — usage credits only if the organisation enables it.
//
// The old date survives only as `historical_boundary_date`: records from before
// 2026-07-20 were produced under the previous mechanic and must be read that way.
// It is NOT a future event and must never be rendered as a countdown.
//
// Fable in Claude Code requires CC 2.1.170 or later; Fable 5.1 specifically has
// been the default Fable model since CC 2.1.257 (2026-09-01).

// Neutral availability gate. Replaces the June-2026 export-control suspension
// switch, whose text described a suspension that ended when Anthropic redeployed
// Fable on 2026-07-01. Kept as a mechanism (a fast kill switch is worth having)
// but drained of the stale specifics: set `"fable_unavailable": true` in
// ~/.wtclaude/config.json to suppress the forecast, with an optional
// `"fable_unavailable_note"` explaining why.
export function isFableAvailable() {
  const c = loadConfig();
  return c.fable_unavailable !== true;
}

export function getFableUnavailableNote() {
  const c = loadConfig();
  return c.fable_unavailable_note
    || 'Claude Fable is marked unavailable in your local config, so the forecast is paused.';
}

// The boundary between the old date-based mechanic and the current
// plan-conditional one. Only ever used to interpret STORED records.
export function getFableHistoricalBoundary() {
  const p = getLatestPricing();
  return (p.fable && p.fable.historical_boundary_date) || '2026-07-19';
}

// The date on and after which the plan-conditional mechanic applies.
export function getFablePermanentSince() {
  const p = getLatestPricing();
  return (p.fable && p.fable.permanent_since) || '2026-07-20';
}

// How Fable bills for a given plan key.
//   'included_weekly'  — drawn from the weekly limit, up to 50% of it. No bill.
//   'usage_credits'    — billed as usage credits from the first token.
//   'org_conditional'  — Enterprise Standard: credits only if the org enabled it.
//   'unknown'          — no plan configured. Surfaces must show BOTH readings.
export function getFableBilling(planKey = getPlanKey()) {
  if (!planKey) return 'unknown';
  const f = getLatestPricing().fable || {};
  if (planKey === 'enterprise_standard') return 'org_conditional';
  if (Array.isArray(f.included_plans) && f.included_plans.includes(planKey)) return 'included_weekly';
  if (Array.isArray(f.credits_plans) && f.credits_plans.includes(planKey)) return 'usage_credits';
  return 'unknown';
}

// Fable promo-credit facts, straight from the rate sheet so no surface restates
// them from memory. Claiming closed 2026-08-02; the credits expire 2026-09-17 at
// 11:59 PM PT regardless of when they were claimed, and they are spent before
// other credits — including auto-reload — silently.
//
// NOT stated here and never to be stated: that credits were consumed or refunded
// during the Fable mis-gating episode. That has never had an Anthropic-primary
// source; it is a third-party report only.
// Fable promotional credits — the ONE model-scoped fact inside the otherwise
// family-scoped `fable` block.
//
// SCOPED 2026-09-07. These credits are FABLE 5 ONLY. Help Center 15424964, read
// that day: the one-time credit "applied to the Fable 5 change only, and there's
// no equivalent credit for Fable 5.1", and the earlier 50%-inclusion promotion
// "applied to Fable 5 only. Claude Fable 5.1 was never part of it." Eligibility
// was Pro and Team standard seats held as of 2026-07-19.
//
// So a user whose Fable usage is entirely Fable 5.1 has no promotional credits
// and must not be shown a countdown to their expiry as though they did.
// `applies_to` lets the caller decide; `scope` carries the model list.
export function getFablePromoCredits() {
  const f = getLatestPricing().fable || {};
  const scope = Array.isArray(f.promo_credit_scope) ? f.promo_credit_scope : ['fable-5'];
  return {
    expiry_date: f.promo_credit_expiry || '2026-09-17',
    expiry_note: f.promo_credit_expiry_note || null,
    claiming_closed: f.promo_credit_claiming_closed || '2026-08-02',
    scope,
    // True when at least one model in the window could carry these credits.
    // With no models supplied we return true: a user with no Fable turns at all
    // may still hold claimed credits, and hiding the expiry from them would be
    // the more harmful error of the two.
    appliesTo(modelKeys) {
      if (!Array.isArray(modelKeys) || modelKeys.length === 0) return true;
      return modelKeys.some(k => scope.includes(k));
    },
  };
}

// Plan key (pro | max_5x | max_20x) if the user set one at setup; else null.
export function getPlanKey() {
  const c = loadConfig();
  const raw = c.plan || c.plan_tier || null;
  if (!raw) return null;
  const norm = String(raw).toLowerCase().replace(/[\s-]/g, '_');
  const map = {
    pro: 'pro',
    max5: 'max_5x', max_5x: 'max_5x', max5x: 'max_5x',
    max20: 'max_20x', max_20x: 'max_20x', max20x: 'max_20x',
    // Team tiers entered the rate sheet on 2026-08-24. They matter here because
    // Fable bills differently on Standard (usage credits) than on Premium
    // (included, up to 50% of the weekly limit).
    team: 'team_standard', team_standard: 'team_standard', team_std: 'team_standard',
    team_premium: 'team_premium', team_prem: 'team_premium',
    enterprise_standard: 'enterprise_standard', ent_standard: 'enterprise_standard',
    enterprise_premium: 'enterprise_premium', ent_premium: 'enterprise_premium',
  };
  return map[norm] || raw;
}

// Whole-day countdown to a YYYY-MM-DD target. Negative once past.
export function daysUntil(targetDateStr, fromStr = new Date().toISOString().slice(0, 10)) {
  const a = Date.parse(fromStr + 'T00:00:00Z');
  const b = Date.parse(targetDateStr + 'T00:00:00Z');
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}
