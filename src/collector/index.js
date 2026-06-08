#!/usr/bin/env node

// ───────────────────────────────────────────────────────────────────────────
// WTClaude statusline collector — THE HEART (build-spec M2)
//
// Claude Code pipes a JSON payload to this script on EVERY status update. It:
//   • anchors cost on the payload's billing-grade `cost.total_cost_usd`
//     (per-turn delta + cumulative) — this is the HEADLINE number;
//   • computes per-turn token deltas from cumulative totals;
//   • captures the day-one fields (usage_pool, billing_basis, speed_tier,
//     user_identifier, device_id, git_branch, cost_center, task_category,
//     edit_target_hash) so no later data migration is needed;
//   • appends one §5 record to ~/.wtclaude/sessions/{session_id}.ndjson;
//   • prints a short status string back to Claude Code.
//
// LAUNCH-CRITICAL SAFE-FAIL CONTRACT (build-spec non-negotiables / kickoff §3):
//   This runs on every status update. It must NEVER break or slow the user's
//   Claude Code. Every path is wrapped so ANY error/timeout fails silently and
//   fast (<50ms), the process always exits 0, and a tracker bug can never
//   degrade the editor. One-line disable: set WTCLAUDE_DISABLE=1 (env) or
//   "disabled": true in ~/.wtclaude/config.json.
//
// DEFENSIVE PARSING: the payload schema has churned (model id, fast-mode field,
// flat→nested tokens). We read the documented nested shape first, fall back to
// the legacy flat shape, tolerate missing/renamed fields, and log an
// "unexpected payload" note rather than crash.
// ───────────────────────────────────────────────────────────────────────────

import { readFileSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { ensureDataDirs, sessionPath, CONFIG_FILE, WTCLAUDE_DIR } from '../utils/paths.js';
import { expectedCost } from '../utils/cost.js';
import { getModelEntry } from '../utils/pricing.js';
import { join } from 'node:path';

// ── helpers ─────────────────────────────────────────────────────────────────

function readStdin() {
  // fd 0 is the piped payload. Synchronous, fast, no event loop wait.
  return readFileSync(0, 'utf8').trim();
}

function safeJSON(str) {
  try { return JSON.parse(str); } catch { return null; }
}

function readConfig() {
  try { return JSON.parse(readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; }
}

function getLastRecord(sessionFile) {
  let data;
  try { data = readFileSync(sessionFile, 'utf8'); } catch { return null; }
  const lines = data.trim().split('\n').filter(Boolean);
  if (lines.length === 0) return null;
  return safeJSON(lines[lines.length - 1]);
}

function logUnexpected(note, sample) {
  // Best-effort breadcrumb; never throws. Helps diagnose payload churn.
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), note, sample }) + '\n';
    appendFileSync(join(WTCLAUDE_DIR, 'collector.log'), line);
  } catch { /* swallow */ }
}

function shortHash(salt, value) {
  return createHash('sha256').update(String(salt || '') + ' ' + String(value)).digest('hex').slice(0, 12);
}

// Pull a value from the first present of several candidate paths. Tolerates
// the nested (documented) shape and the legacy flat shape.
function pick(obj, paths, fallback = undefined) {
  for (const p of paths) {
    const v = p.split('.').reduce((a, k) => (a == null ? a : a[k]), obj);
    if (v != null) return v;
  }
  return fallback;
}

// ── payload → normalized fields (defensive across schema versions) ───────────

function extract(payload) {
  // model id may be an object {id, display_name} (current) or a bare string (legacy).
  const modelRaw = payload.model;
  const modelId = typeof modelRaw === 'string'
    ? modelRaw
    : pick(payload, ['model.id', 'model.display_name'], 'unknown');

  return {
    sessionId: payload.session_id ?? payload.sessionId ?? null,
    modelId,
    // Billing-grade headline cost (cumulative).
    cumulativeCost: pick(payload, ['cost.total_cost_usd', 'total_cost_usd'], null),
    // Tokens — nested context_window.* first, legacy flat second.
    cumInput: pick(payload, ['context_window.total_input_tokens', 'total_input_tokens'], 0),
    cumOutput: pick(payload, ['context_window.total_output_tokens', 'total_output_tokens'], 0),
    cumCacheRead: pick(payload, [
      'context_window.current_usage.cache_read_input_tokens',
      'cache_read_input_tokens',
    ], 0),
    cumCacheWrite: pick(payload, [
      'context_window.current_usage.cache_creation_input_tokens',
      'cache_creation_input_tokens',
    ], 0),
    usedPercentage: pick(payload, ['context_window.used_percentage', 'used_percentage'], null),
    // cwd — never stored raw; only used to derive branch + salted project hash.
    cwd: pick(payload, ['cwd', 'workspace.current_dir', 'workspace.project_dir', 'current_dir'], null),
    // tool_names — may not be exposed in the statusline payload; capture if present.
    toolNames: pick(payload, ['tool_names', 'tools'], null),

    // ── BUILD-022: billing-grade speed tier ──
    // The live payload carries a top-level `fast_mode` boolean (confirmed across
    // 21 captures, all `false`). Read it directly — true/false is billing-grade,
    // undefined means an older CC version that predates the field (fall back to
    // the ratio inference). Coerce only real booleans; anything else → null.
    fastMode: typeof payload.fast_mode === 'boolean' ? payload.fast_mode : null,

    // ── BUILD-023: statusline data surface v2 (capture-only, no new views) ──
    // All fields defensively read — absent on older CC versions → null/0.
    // Cumulative per-session counters (cost.*); we store both the cumulative and
    // the per-turn delta so later $/line + $/active-minute views need no migration.
    cumLinesAdded: pick(payload, ['cost.total_lines_added'], null),
    cumLinesRemoved: pick(payload, ['cost.total_lines_removed'], null),
    cumDurationMs: pick(payload, ['cost.total_duration_ms'], null),
    cumApiDurationMs: pick(payload, ['cost.total_api_duration_ms'], null),
    // Effort / thinking / context flags (per-turn settings snapshot).
    effortLevel: pick(payload, ['effort.level'], null),
    thinkingEnabled: typeof pick(payload, ['thinking.enabled']) === 'boolean'
      ? pick(payload, ['thinking.enabled']) : null,
    exceeds200k: typeof payload.exceeds_200k_tokens === 'boolean' ? payload.exceeds_200k_tokens : null,
    ccVersion: pick(payload, ['version'], null),
    // rate_limits — the shared overall plan limit (five_hour + seven_day). Stored
    // as a flat snapshot per turn; powers the Phase-0 limit gauge / burn-countdown.
    rateLimits: (payload.rate_limits && typeof payload.rate_limits === 'object') ? payload.rate_limits : null,
  };
}

// ── day-one field derivation ─────────────────────────────────────────────────

function detectUsagePool(config) {
  if (config.usage_pool_override) return config.usage_pool_override;
  // The statusline only renders in interactive Claude Code; headless agent runs
  // (claude -p, Agent SDK, GitHub Actions) generally don't invoke it. Heuristic.
  if (process.env.GITHUB_ACTIONS || process.env.CI === 'true') return 'agent_sdk';
  return 'interactive';
}

function detectBillingBasis(usagePool, speedTier) {
  if (speedTier === 'fast') return 'fast_mode_usage_credits';
  if (usagePool === 'agent_sdk') return 'agent_sdk_credits';
  return 'subscription_limits';
}

// BUILD-022: resolve speed_tier, preferring the payload's billing-grade
// `fast_mode` boolean over the legacy ratio inference.
//   • fastMode === true/false  → billing-grade, source 'payload'
//   • fastMode === null         → field absent (older CC) → sideline inference
// Returns { tier, source }. Cost itself stays billing-grade via the anchor
// regardless of this label.
function resolveSpeedTier(fastMode, modelId, tokenDeltas, costDelta) {
  if (fastMode === true) return { tier: 'fast', source: 'payload' };
  if (fastMode === false) return { tier: 'standard', source: 'payload' };
  return { tier: inferSpeedTier(modelId, tokenDeltas, costDelta), source: 'inferred' };
}

// SIDELINED FALLBACK (pre-`fast_mode`-field CC only): infer speed_tier from the
// ratio of the actual per-turn cost delta to the standard-rate expected cost
// (~1.0 standard, ~2.0 fast). Known false-positive prone (cache-heavy turns can
// skew the ratio), which is why the payload field now takes precedence. Cost
// itself stays billing-grade via the anchor regardless of this label.
function inferSpeedTier(modelId, tokenDeltas, costDelta) {
  if (!(costDelta > 0)) return 'standard';
  const expStd = expectedCost(modelId, 'standard', tokenDeltas);
  if (!(expStd > 0)) return 'standard';
  const ratio = costDelta / expStd;
  return ratio >= 1.7 ? 'fast' : 'standard'; // 1.3–1.7 is uncertain → default standard
}

// Time-boxed git branch lookup; reuses the previous record when cwd is unchanged
// (same project_hash) so we don't spawn git on every status update.
function getGitBranch(cwd, projectHash, prev) {
  if (!cwd) return null;
  if (prev && prev.project_hash === projectHash && 'git_branch' in prev) return prev.git_branch;
  try {
    const out = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd, timeout: 40, stdio: ['ignore', 'pipe', 'ignore'],
    });
    const branch = out.toString().trim();
    return branch && branch !== 'HEAD' ? branch : null;
  } catch {
    return null; // not a git repo, git missing, or timed out — metadata only
  }
}

function resolveCostCenter(config, projectHash, gitBranch) {
  const map = config.cost_center_map || {};
  if (projectHash && map[projectHash]) return map[projectHash];
  if (gitBranch && map[gitBranch]) return map[gitBranch];
  return null;
}

// Deterministic, no-LLM task category from tool names (CodeBurn-style taxonomy).
// Returns null when the payload doesn't expose tools (confirm via live capture).
function classifyTask(toolNames) {
  if (!Array.isArray(toolNames) || toolNames.length === 0) return null;
  const t = new Set(toolNames.map(String));
  if (t.has('Edit') || t.has('Write') || t.has('MultiEdit') || t.has('NotebookEdit')) return 'feature_development';
  if (t.has('Bash')) return 'execution_ops';
  if (t.has('Grep') || t.has('Glob')) return 'code_search';
  if (t.has('Read')) return 'reading_review';
  if (t.has('WebSearch') || t.has('WebFetch')) return 'research';
  return 'other';
}

// ── main ─────────────────────────────────────────────────────────────────────

function collect() {
  const raw = readStdin();
  if (!raw) return; // nothing piped — nothing to do

  const payload = safeJSON(raw);
  if (!payload || typeof payload !== 'object') {
    logUnexpected('unparseable payload', raw.slice(0, 200));
    return;
  }

  const f = extract(payload);
  if (!f.sessionId) {
    logUnexpected('payload missing session_id', Object.keys(payload));
    return;
  }
  if (f.cumulativeCost == null && f.cumInput === 0 && f.cumOutput === 0) {
    // Neither the cost anchor nor any tokens are present — likely a new/renamed
    // schema. Record a breadcrumb but don't crash or write a junk turn.
    logUnexpected('no cost anchor and no tokens', Object.keys(payload));
  }

  ensureDataDirs();
  const config = readConfig();
  const file = sessionPath(f.sessionId);
  const prev = getLastRecord(file);

  // ── deltas ──
  const cumInput = Number(f.cumInput) || 0;
  const cumOutput = Number(f.cumOutput) || 0;
  const cumCacheRead = Number(f.cumCacheRead) || 0;
  const cumCacheWrite = Number(f.cumCacheWrite) || 0;
  const cumCost = typeof f.cumulativeCost === 'number' ? f.cumulativeCost : null;

  let deltaInput, deltaOutput, deltaCacheRead, deltaCacheWrite, deltaCost, turn;

  if (prev) {
    // Math.max guards /compact resets, context-occupancy non-monotonicity, and
    // session resumption (build-spec §5: "handle new sessions / model switches /
    // /compact / resume"). Cost is monotonic-cumulative; tokens may be occupancy.
    deltaInput = Math.max(0, cumInput - (prev.cumulative_input ?? 0));
    deltaOutput = Math.max(0, cumOutput - (prev.cumulative_output ?? 0));
    deltaCacheRead = Math.max(0, cumCacheRead - (prev.cumulative_cache_read ?? 0));
    deltaCacheWrite = Math.max(0, cumCacheWrite - (prev.cumulative_cache_write ?? 0));
    deltaCost = cumCost != null && typeof prev.cumulative_cost_usd === 'number'
      ? Math.max(0, cumCost - prev.cumulative_cost_usd)
      : 0;
    turn = (prev.turn ?? 0) + 1;

    // Duplicate status update (nothing changed) — re-emit status, don't write.
    if (deltaInput === 0 && deltaOutput === 0 && deltaCacheRead === 0 && deltaCacheWrite === 0 && deltaCost === 0) {
      emitStatus(prev.cumulative_cost_usd, cumInput + cumOutput + cumCacheRead + cumCacheWrite);
      return;
    }
  } else {
    // First update for this session — cumulative IS the first turn.
    deltaInput = cumInput;
    deltaOutput = cumOutput;
    deltaCacheRead = cumCacheRead;
    deltaCacheWrite = cumCacheWrite;
    deltaCost = cumCost ?? 0;
    turn = 1;
  }

  // ── day-one fields ──
  const salt = config.edit_hash_salt || config.anonymous_id || 'wtclaude';
  const projectHash = f.cwd ? shortHash(salt, f.cwd) : null;
  const gitBranch = getGitBranch(f.cwd, projectHash, prev);
  const costCenter = resolveCostCenter(config, projectHash, gitBranch);
  const usagePool = detectUsagePool(config);
  const tokenDeltas = {
    input_tokens: deltaInput, output_tokens: deltaOutput,
    cache_read_tokens: deltaCacheRead, cache_write_tokens: deltaCacheWrite,
  };
  const { tier: speedTier, source: speedTierSource } = resolveSpeedTier(f.fastMode, f.modelId, tokenDeltas, deltaCost);
  const billingBasis = detectBillingBasis(usagePool, speedTier);

  // ── BUILD-023: per-turn deltas for the cumulative v2 counters ──
  // Math.max guards /compact resets, session resume, and counter non-monotonicity
  // (same discipline as the token/cost deltas above).
  const cumLinesAdded = numOrNull(f.cumLinesAdded);
  const cumLinesRemoved = numOrNull(f.cumLinesRemoved);
  const cumDurationMs = numOrNull(f.cumDurationMs);
  const cumApiDurationMs = numOrNull(f.cumApiDurationMs);
  const deltaLinesAdded = monotonicDelta(cumLinesAdded, prev && prev.cumulative_lines_added);
  const deltaLinesRemoved = monotonicDelta(cumLinesRemoved, prev && prev.cumulative_lines_removed);
  const deltaDurationMs = monotonicDelta(cumDurationMs, prev && prev.cumulative_duration_ms);
  const deltaApiDurationMs = monotonicDelta(cumApiDurationMs, prev && prev.cumulative_api_duration_ms);
  const taskCategory = classifyTask(f.toolNames);
  const toolNames = Array.isArray(f.toolNames) ? f.toolNames.map(String) : [];
  const editTargetHash = null; // edit target not exposed in the payload — confirm via live capture (BUILD live-verify)

  // Flag (don't crash on) an unrecognized model id so the pricing config gets updated.
  const resolved = getModelEntry(f.modelId);
  if (!resolved) logUnexpected('unrecognized model id (cost still anchored on payload)', f.modelId);
  else if (resolved.fallback) logUnexpected('model id hit opus-* family fallback — add explicit pricing entry/alias', f.modelId);

  const record = {
    ts: new Date().toISOString(),
    session_id: f.sessionId,
    turn,
    model: f.modelId,
    input_tokens: deltaInput,
    output_tokens: deltaOutput,
    cache_read_tokens: deltaCacheRead,
    cache_write_tokens: deltaCacheWrite,
    tool_names: toolNames,
    cumulative_input: cumInput,
    cumulative_output: cumOutput,
    cumulative_cache_read: cumCacheRead,
    cumulative_cache_write: cumCacheWrite,
    // ── billing-grade headline cost (the anchor) ──
    cost_usd: round6(deltaCost),
    cumulative_cost_usd: cumCost != null ? round6(cumCost) : null,
    // ── classification / labeling ──
    speed_tier: speedTier,
    speed_tier_source: speedTierSource, // BUILD-022: 'payload' (billing-grade) | 'inferred' (older CC fallback)
    usage_pool: usagePool,
    billing_basis: billingBasis,
    used_percentage: f.usedPercentage ?? null,
    // ── grouping / identity (no-migration discipline) ──
    project_hash: projectHash,
    git_branch: gitBranch,
    cost_center: costCenter,
    device_id: config.device_id ?? null,
    task_category: taskCategory,
    edit_target_hash: editTargetHash,
    user_identifier: config.user_identifier ?? config.anonymous_id ?? null,
    // ── BUILD-023: statusline data surface v2 (capture-only; views are Phase 1 Guardian) ──
    // Per-turn deltas + cumulative counters. All null on CC versions predating the field.
    lines_added: deltaLinesAdded,
    lines_removed: deltaLinesRemoved,
    cumulative_lines_added: cumLinesAdded,
    cumulative_lines_removed: cumLinesRemoved,
    duration_ms: deltaDurationMs,            // wall-clock for this turn (cost.total_duration_ms delta)
    api_duration_ms: deltaApiDurationMs,     // active API time this turn (the part that actually costs)
    cumulative_duration_ms: cumDurationMs,
    cumulative_api_duration_ms: cumApiDurationMs,
    effort_level: f.effortLevel,             // effort.level (e.g. 'xhigh')
    thinking_enabled: f.thinkingEnabled,     // thinking.enabled boolean
    exceeds_200k_tokens: f.exceeds200k,      // long-context flag
    cc_version: f.ccVersion,                 // Claude Code version that emitted this turn
    // rate_limits snapshot — the shared overall plan limit (per GTM-005). Flattened
    // for direct read by the limit gauge; never includes paths/content.
    rate_limit_5h_pct: pick(f.rateLimits, ['five_hour.used_percentage'], null),
    rate_limit_5h_resets_at: pick(f.rateLimits, ['five_hour.resets_at'], null),
    rate_limit_7d_pct: pick(f.rateLimits, ['seven_day.used_percentage'], null),
    rate_limit_7d_resets_at: pick(f.rateLimits, ['seven_day.resets_at'], null),
  };

  appendFileSync(file, JSON.stringify(record) + '\n');
  emitStatus(cumCost, cumInput + cumOutput + cumCacheRead + cumCacheWrite);
}

function round6(n) { return Math.round(n * 1e6) / 1e6; }

// Coerce to a finite number or null (BUILD-023: fields absent on older CC).
function numOrNull(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

// Per-turn delta for a cumulative counter, clamped non-negative. Returns null
// when the current cumulative is unavailable (field absent → no delta to record).
function monotonicDelta(cum, prevCum) {
  if (cum == null) return null;
  return Math.max(0, cum - (typeof prevCum === 'number' ? prevCum : 0));
}

function emitStatus(cumulativeCost, totalTokens) {
  // Short status string rendered back into Claude Code's status line.
  try {
    const costStr = typeof cumulativeCost === 'number' ? `$${cumulativeCost.toFixed(2)}` : '$—';
    const tokStr = totalTokens >= 1_000_000
      ? `${(totalTokens / 1_000_000).toFixed(1)}M`
      : totalTokens >= 1_000 ? `${(totalTokens / 1_000).toFixed(0)}K` : `${totalTokens}`;
    process.stdout.write(`wtclaude · ${costStr} · ${tokStr} tok`);
  } catch { /* never block the status line on a write error */ }
}

// ── safe-fail wrapper (the kill-switch contract) ─────────────────────────────
function main() {
  // One-line disable.
  if (process.env.WTCLAUDE_DISABLE === '1') return;
  let config;
  try { config = readConfig(); } catch { config = {}; }
  if (config && config.disabled === true) return;

  try {
    collect();
  } catch (err) {
    // A tracker that breaks the editor is worse than no tracker. Swallow
    // everything, leave a breadcrumb, and exit clean.
    logUnexpected('collector threw', String(err && err.message || err));
  }
}

main();
process.exit(0);
