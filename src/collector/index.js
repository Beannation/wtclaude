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
//   Claude Code. Every path is wrapped so ANY error fails silently and fast,
//   the process always exits 0, and a tracker bug can never degrade the
//   editor. One-line disable: set WTCLAUDE_DISABLE=1 (env) or
//   "disabled": true in ~/.wtclaude/config.json.
//
// TIME BUDGET (restated for QA-0928-145): Node's own cold start is ~40 ms on
//   an idle machine before a line of ours runs, so no Node collector can
//   finish in an absolute "<50 ms". The budget is the collector's OWN overhead
//   over bare `node -e ''`: target <= 25 ms, constant in the session file's
//   size. Hence: no child processes (git branch comes from .git/HEAD), only the
//   session file's tail is read, config.json is read once, and the rate sheet
//   is parsed only when a turn needs it (a first turn or model change, a Fable
//   turn, an older CC's speed inference). Claude Code cancels an in-flight run
//   when a newer update arrives, so a slow tick costs a status refresh.
//
// DEFENSIVE PARSING: the payload schema has churned (model id, fast-mode field,
// flat→nested tokens). We read the documented nested shape first, fall back to
// the legacy flat shape, tolerate missing/renamed fields, and log an
// "unexpected payload" note rather than crash.
// ───────────────────────────────────────────────────────────────────────────

import { readFileSync, appendFileSync, openSync, readSync, fstatSync, closeSync, statSync, renameSync, unlinkSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ensureDataDirs, sessionPath, isValidSessionId, CONFIG_FILE, WTCLAUDE_DIR } from '../utils/paths.js';
import { expectedCost } from '../utils/cost.js';
import { getModelEntry, getLatestPricing, normalizeModel } from '../utils/pricing.js';
import { join, dirname, resolve, isAbsolute } from 'node:path';
import { formatContext } from '../utils/statusline-format.js';

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

// The session file's tail: the last VALID record (`prev`), the last record
// carrying a numeric cost anchor (`anchor`, usually prev itself), the file size
// and whether it ends in a newline.
//
//  • Tail only (QA-0928-145/147): the whole file used to be read and split on
//    every tick — 23 ms at 50 MB. The last 64 KB almost always holds the last
//    record; the window grows only when it doesn't (a >64 KB line) or when an
//    anchored payload needs the last anchor from further back (unanchored
//    rows, which real data lacks).
//  • Last VALID record (QA-0928-13): a truncated last line (a crash mid-append)
//    used to read as "no previous record", so the next payload was booked as
//    turn 1 with the full cumulative — a double count. Walk back past it.
const TAIL_BYTES = 64 * 1024;

function readSessionTail(file, needAnchor) {
  const out = { prev: null, anchor: null, size: 0, endsWithNewline: true };
  let fd;
  try { fd = openSync(file, 'r'); } catch { return out; }
  try {
    out.size = fstatSync(fd).size;
    if (out.size === 0) return out;
    for (let window = TAIL_BYTES; ; window *= 4) {
      const start = Math.max(0, out.size - window);
      const buf = Buffer.allocUnsafe(out.size - start);
      readSync(fd, buf, 0, buf.length, start);
      out.endsWithNewline = buf[buf.length - 1] === 0x0a;
      const lines = buf.toString('utf8').split('\n');
      if (start > 0) lines.shift(); // the window may open mid-line
      out.prev = null; out.anchor = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        const rec = safeJSON(lines[i]);
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
        if (!out.prev) out.prev = rec;
        if (typeof rec.cumulative_cost_usd === 'number') { out.anchor = rec; break; }
        if (!needAnchor) break;
      }
      if (out.anchor || (out.prev && !needAnchor) || start === 0) return out;
    }
  } catch {
    return out;
  } finally {
    closeSync(fd);
  }
}

// Serialise the final re-read + append of one session across overlapping
// collector runs (QA-0928-151: two runs started together both booked the same
// interval in 34 of 40 forced trials). The critical section is ~1 ms. On
// contention we wait in 2 ms steps for up to ~50 ms, then skip this update —
// safe, because cost is cumulative: the next update books what this one
// carried. A lock older than 2 s is a leftover from a killed run and is taken
// over; if no lock can be created at all, the append goes ahead unlocked, so
// locking can never stop capture.
const SLEEP_CELL = new Int32Array(new SharedArrayBuffer(4));

function withSessionLock(file, fn) {
  const lock = `${file}.lock`;
  for (let attempt = 0; attempt < 25; attempt++) {
    let fd;
    try {
      fd = openSync(lock, 'wx');
    } catch (err) {
      if (err.code !== 'EEXIST') return fn();
      const st = statSync(lock, { throwIfNoEntry: false });
      if (st && Date.now() - st.mtimeMs > 2000) { try { unlinkSync(lock); } catch { /* raced */ } continue; }
      Atomics.wait(SLEEP_CELL, 0, 0, 2);
      continue;
    }
    try { return fn(); } finally {
      closeSync(fd);
      try { unlinkSync(lock); } catch { /* already gone */ }
    }
  }
  return false; // still contended — skip this update
}

// Best-effort breadcrumb; never throws. Helps diagnose payload churn. Capped
// (QA-0928-48): above 256 KB the log rotates to collector.log.1, so the pair
// never exceeds ~512 KB. Callers pass key names or sizes, never raw payload
// bytes — those start with the cwd, which is never stored raw.
const LOG_CAP_BYTES = 256 * 1024;

function logUnexpected(note, sample) {
  try {
    const file = join(WTCLAUDE_DIR, 'collector.log');
    const st = statSync(file, { throwIfNoEntry: false });
    if (st && st.size > LOG_CAP_BYTES) renameSync(file, `${file}.1`);
    appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), note, sample }) + '\n');
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
    freshInput: pick(payload, ['context_window.current_usage.input_tokens'], 0),
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
  // (claude -p, Agent SDK) don't invoke it. The old CI / GITHUB_ACTIONS env
  // heuristic stamped interactive turns agent_sdk — a pool whose split is
  // paused — whenever a shell exported CI=true (QA-0928-152), so it is gone.
  return 'interactive';
}

// REWRITTEN 2026-08-24, family-scoped 2026-09-07. Fable stopped being a date
// cliff on 2026-07-20: it is permanent and PLAN-CONDITIONAL, for every Fable
// model including Fable 5.1. Max / Team Premium / Enterprise Premium get it
// included, drawn from up to 50% of the weekly usage limit — subscription limits,
// not a credits wallet. Pro / Team Standard bill usage credits from token #1.
// Enterprise Standard bills credits only if the org enabled Fable.
//
// When no plan is configured we do NOT guess: billing_basis stays
// 'subscription_limits' (the neutral default every non-Fable turn gets, so we
// never fabricate a credits charge) and the record carries fable_billing:
// 'unknown' so downstream surfaces can show both readings and say so.
//
// The agent_sdk branch is retained for records that were already stamped that
// way, but the Agent-SDK pool split is PAUSED — SDK and `claude -p` usage draws
// ordinary subscription limits today. See agent_sdk_pool in the rate sheet.
function detectBillingBasis(usagePool, speedTier, modelId, config) {
  if (speedTier === 'fast') return 'fast_mode_usage_credits';
  if (usagePool === 'agent_sdk') return 'agent_sdk_credits';
  if (fableBillingFor(modelId, config) === 'usage_credits') return 'usage_credits';
  return 'subscription_limits';
}

// How Fable bills for this user, or null when the turn is not a Fable turn.
// Returns 'included_weekly' | 'usage_credits' | 'org_conditional' | 'unknown'.
function fableBillingFor(modelId, config) {
  const modelKey = normalizeModel(modelId);
  if (!modelKey || !modelKey.startsWith('fable')) return null;

  const fable = getLatestPricing().fable || {};
  const raw = (config && (config.plan || config.plan_tier)) || null;
  if (!raw) return 'unknown';
  const plan = String(raw).toLowerCase().replace(/[\s-]/g, '_');
  const canonical = {
    pro: 'pro', max5: 'max_5x', max_5x: 'max_5x', max5x: 'max_5x',
    max20: 'max_20x', max_20x: 'max_20x', max20x: 'max_20x',
    team: 'team_standard', team_standard: 'team_standard', team_std: 'team_standard',
    team_premium: 'team_premium', team_prem: 'team_premium',
    enterprise_standard: 'enterprise_standard', enterprise_premium: 'enterprise_premium',
  }[plan] || plan;

  if (canonical === 'enterprise_standard') return 'org_conditional';
  if (Array.isArray(fable.included_plans) && fable.included_plans.includes(canonical)) return 'included_weekly';
  if (Array.isArray(fable.credits_plans) && fable.credits_plans.includes(canonical)) return 'usage_credits';
  return 'unknown';
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

// Current git branch, read straight from .git/HEAD on every turn (QA-0928-50).
// It used to spawn `git rev-parse` once per cwd stretch and reuse the answer,
// so a mid-session checkout kept the old branch and one 40 ms timeout cached
// null for the whole stretch. Reading HEAD is ~0.1 ms, needs no child process
// (and so no Xcode git-shim dialog), and handles linked worktrees and
// submodules, whose .git is a `gitdir:` file. A detached HEAD is null, as
// `rev-parse --abbrev-ref` ('HEAD') was. Metadata only: any failure is null.
function readGitBranch(cwd) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) return null;
  try {
    let dir = cwd;
    for (let depth = 0; depth < 64; depth++) {
      const dotGit = join(dir, '.git');
      const st = statSync(dotGit, { throwIfNoEntry: false });
      if (st) {
        let gitDir = dotGit;
        if (st.isFile()) {
          const m = /^gitdir:\s*(.+?)\s*$/m.exec(readFileSync(dotGit, 'utf8'));
          if (!m) return null;
          gitDir = resolve(dir, m[1]);
        }
        const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
        const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head);
        return ref ? ref[1] : null;
      }
      const parent = dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  } catch { /* unreadable repo metadata — no branch */ }
  return null;
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

// A cumulative cost below half the last anchored cumulative is a counter
// RESET, not a correction (QA-0928-12). Claude Code restarts
// cost.total_cost_usd when a session is resumed (seen in real data: a large
// cumulative dropping to $0.00 inside one session_id); clamping that drop to $0 lost every dollar until the
// new cumulative climbed past the old one, and the status line showed the
// stale figure. The 50% bar keeps a small downward recompute — or a stale
// payload from an overlapping run — from being booked twice.
const RESET_RATIO = 0.5;

// FIXED 2026-09-28 (RC): the ratio alone can't tell a restart from a stale
// payload — a stale reading below half was booked as a reset (counted twice),
// and a restart whose first reading stayed at or above half was clamped (lost).
// cost.total_duration_ms is wall-clock time since Claude Code's process
// started, and it restarts with the cost counter (a real reset in a
// large local corpus did exactly that), so `reading time − duration` dates the
// process. When the duration fell too: a process that started after the last
// anchored reading (within a second's slack) is a RESTART, booked in full;
// the same process means an older payload arriving late — STALE, skipped.
// Without duration figures on both sides, the 50% rule stands.
const RESTART_SLACK_MS = 1000;

function classifyDrop(now, base, cur, anchor, nowMs) {
  const dNow = cur.cumDurationMs, dPrev = anchor ? anchor.cumulative_duration_ms : null;
  const prevAt = anchor && anchor.ts ? Date.parse(anchor.ts) : NaN;
  if (Number.isFinite(dNow) && Number.isFinite(dPrev) && Number.isFinite(prevAt) && dNow < dPrev) {
    const startShift = (nowMs - dNow) - (prevAt - dPrev);
    return startShift >= dPrev - RESTART_SLACK_MS ? 'reset' : 'stale';
  }
  return now < base * RESET_RATIO ? 'reset' : 'clamp';
}

// Per-turn deltas of this payload against the session's last valid record.
// Returns { skip } when nothing should be written.
function computeDeltas(prev, anchor, cur, nowMs = Date.now()) {
  if (!prev) {
    // First update for this session — cumulative IS the first turn. But the
    // session-start payload (nothing billed, nothing used) is not a turn
    // (QA-0928-49): almost every real session opened with a $0 / 0-token row
    // that pushed the real first turn to turn 2.
    const unused = cur.cumInput === 0 && cur.cumOutput === 0 && cur.cumCacheRead === 0 && cur.cumCacheWrite === 0;
    if (unused && !(cur.cumCost > 0)) return { skip: true };
    return {
      turn: 1, counterReset: false,
      input: cur.cumInput, output: cur.cumOutput,
      cacheRead: cur.cumCacheRead, cacheWrite: cur.cumCacheWrite,
      cost: cur.cumCost,
    };
  }

  // Math.max guards /compact resets, context-occupancy non-monotonicity, and
  // session resumption (build-spec §5: "handle new sessions / model switches /
  // /compact / resume"). Tokens may be occupancy (their semantics are BUILD-014).
  const input = Math.max(0, cur.cumInput - (prev.cumulative_input ?? 0));
  const output = Math.max(0, cur.cumOutput - (prev.cumulative_output ?? 0));
  const cacheRead = Math.max(0, cur.cumCacheRead - (prev.cumulative_cache_read ?? 0));
  const cacheWrite = Math.max(0, cur.cumCacheWrite - (prev.cumulative_cache_write ?? 0));

  // Cost: null when this payload has no anchor (QA-0928-52 — readers then
  // label the turn an estimate instead of a billing-grade $0). Otherwise the
  // delta against the last ANCHORED row, walking back past unanchored ones
  // (QA-0928-146); with no anchor anywhere yet, this reading counts in full.
  //
  // Compare LIKE FOR LIKE. `cumulative_cost_usd` was written through round6(),
  // so subtracting it from the raw payload value leaves a sub-microcent residue
  // on an unchanged payload — enough to defeat the duplicate guard below, which
  // then writes a row whose own cost rounds to $0. In a real local corpus those
  // phantom rows were a sizeable share of all records, every one of them
  // carrying a cumulative identical to its predecessor, with no counter-examples.
  let cost = null;
  let counterReset = false;
  if (cur.cumCost != null) {
    const now = round6(cur.cumCost);
    const base = anchor ? anchor.cumulative_cost_usd : null;
    if (base == null) cost = now;
    else if (now < base) {
      const kind = classifyDrop(now, base, cur, anchor, nowMs);
      if (kind === 'stale') return { skip: true };   // an older reading than the one we have
      if (kind === 'reset') { cost = now; counterReset = true; }
      else cost = 0;                                  // a small downward recompute
    } else cost = now - base;
  }

  // Duplicate status update (nothing changed) — don't write. A reset is always
  // written, even at $0 with unchanged tokens: it is the new baseline.
  if (!counterReset && input === 0 && output === 0 && cacheRead === 0 && cacheWrite === 0 && !(cost > 0)) {
    return { skip: true };
  }
  return { turn: (prev.turn ?? 0) + 1, counterReset, input, output, cacheRead, cacheWrite, cost };
}

function collect(config) {
  const raw = readStdin();
  if (!raw) return; // nothing piped — nothing to do

  const payload = safeJSON(raw);
  if (!payload || typeof payload !== 'object') {
    logUnexpected('unparseable payload', { length: raw.length });
    return;
  }

  const f = extract(payload);
  if (!f.sessionId) {
    logUnexpected('payload missing session_id', Object.keys(payload));
    return;
  }

  const cur = {
    cumInput: Number(f.cumInput) || 0,
    cumOutput: Number(f.cumOutput) || 0,
    cumCacheRead: Number(f.cumCacheRead) || 0,
    cumCacheWrite: Number(f.cumCacheWrite) || 0,
    // A finite numeric string ("0.75") is accepted as the anchor (QA-0928-146).
    cumCost: finiteOrNull(f.cumulativeCost),
    // Dates the Claude Code process, to tell a restart from a stale payload.
    cumDurationMs: finiteOrNull(f.cumDurationMs),
  };
  const ctx = contextTokens(f);

  if (!isValidSessionId(f.sessionId)) {
    // A path separator or '..' would write outside sessions/ (QA-0928-150).
    logUnexpected('invalid session_id — not recorded', { length: String(f.sessionId).length });
    emitStatus(cur.cumCost, ctx);
    return;
  }
  if (cur.cumCost == null && cur.cumInput === 0 && cur.cumOutput === 0) {
    // Neither the cost anchor nor any tokens are present — likely a new/renamed
    // schema. Record a breadcrumb but don't crash or write a junk turn.
    logUnexpected('no cost anchor and no tokens', Object.keys(payload));
    emitStatus(null, ctx);
    return;
  }

  const file = sessionPath(f.sessionId);
  const needAnchor = cur.cumCost != null;
  let tail = readSessionTail(file, needAnchor);
  let d = computeDeltas(tail.prev, tail.anchor, cur);
  // The status line always shows THIS payload's figure — never a stale one.
  if (d.skip) { emitStatus(cur.cumCost, ctx); return; }

  // ── day-one fields ──
  // No per-install salt (setup never ran, or config.json is unreadable) means
  // no project_hash and no branch (QA-0928-149): the old fallback to the public
  // constant 'wtclaude' — or to the anonymous id the server receives — let a
  // guessed path be confirmed against the hash.
  const salt = config.edit_hash_salt || null;
  const projectHash = salt && f.cwd ? shortHash(salt, f.cwd) : null;
  const gitBranch = salt ? readGitBranch(f.cwd) : null;
  const costCenter = resolveCostCenter(config, projectHash, gitBranch);
  const usagePool = detectUsagePool(config);
  const taskCategory = classifyTask(f.toolNames);
  const toolNames = Array.isArray(f.toolNames) ? f.toolNames.map(String) : [];
  const editTargetHash = null; // edit target not exposed in the payload — confirm via live capture (BUILD live-verify)

  const buildRecord = (d, prev) => {
    const tokenDeltas = {
      input_tokens: d.input, output_tokens: d.output,
      cache_read_tokens: d.cacheRead, cache_write_tokens: d.cacheWrite,
    };
    const { tier: speedTier, source: speedTierSource } = resolveSpeedTier(f.fastMode, f.modelId, tokenDeltas, d.cost);
    const billingBasis = detectBillingBasis(usagePool, speedTier, f.modelId, config);

    // ── BUILD-023: per-turn deltas for the cumulative v2 counters ──
    // Math.max guards /compact resets, session resume, and counter non-monotonicity
    // (same discipline as the token/cost deltas above).
    const cumLinesAdded = numOrNull(f.cumLinesAdded);
    const cumLinesRemoved = numOrNull(f.cumLinesRemoved);
    const cumDurationMs = numOrNull(f.cumDurationMs);
    const cumApiDurationMs = numOrNull(f.cumApiDurationMs);

    return {
      ts: new Date().toISOString(),
      session_id: f.sessionId,
      turn: d.turn,
      model: f.modelId,
      // HONESTY FLAG (B2). `model` is the session's CONFIGURED model, taken from
      // the payload's `model.id` — documented as "Current model identifier and
      // display name". It is NOT the model that actually served the response.
      // Anthropic's Cookbook is explicit that serving-model analytics must come
      // from `usage.iterations` ("Analytics recorded against the requested model
      // will be wrong whenever a fallback is used"), and the statusline payload
      // carries no `iterations` field and no serving-model field of any kind
      // (verified against the statusline docs, 2026-08-24). So a fallback-served
      // turn is attributed here to the requested model, and we cannot see that it
      // happened. Recording the provenance is the honest thing we CAN do.
      model_source: 'session_setting',
      input_tokens: d.input,
      output_tokens: d.output,
      cache_read_tokens: d.cacheRead,
      cache_write_tokens: d.cacheWrite,
      tool_names: toolNames,
      cumulative_input: cur.cumInput,
      cumulative_output: cur.cumOutput,
      cumulative_cache_read: cur.cumCacheRead,
      cumulative_cache_write: cur.cumCacheWrite,
      // ── billing-grade headline cost (the anchor) ──
      // null (not 0) when the payload carried no cost anchor (QA-0928-52).
      cost_usd: d.cost != null ? round6(d.cost) : null,
      cumulative_cost_usd: cur.cumCost != null ? round6(cur.cumCost) : null,
      // The payload's cumulative restarted inside this session (QA-0928-12);
      // cost_usd is then the new cumulative itself.
      ...(d.counterReset ? { counter_reset: true } : {}),
      // ── classification / labeling ──
      speed_tier: speedTier,
      speed_tier_source: speedTierSource, // BUILD-022: 'payload' (billing-grade) | 'inferred' (older CC fallback)
      usage_pool: usagePool,
      billing_basis: billingBasis,
      // Plan-conditional Fable reading for this turn; null on non-Fable turns.
      // 'unknown' means no plan is configured — surfaces must show both readings.
      fable_billing: fableBillingFor(f.modelId, config),
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
      lines_added: monotonicDelta(cumLinesAdded, prev && prev.cumulative_lines_added),
      lines_removed: monotonicDelta(cumLinesRemoved, prev && prev.cumulative_lines_removed),
      cumulative_lines_added: cumLinesAdded,
      cumulative_lines_removed: cumLinesRemoved,
      duration_ms: monotonicDelta(cumDurationMs, prev && prev.cumulative_duration_ms),             // wall-clock for this turn (cost.total_duration_ms delta)
      api_duration_ms: monotonicDelta(cumApiDurationMs, prev && prev.cumulative_api_duration_ms),  // active API time this turn (the part that actually costs)
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
  };

  let record = buildRecord(d, tail.prev);

  // Compare-and-append under the session lock (QA-0928-151): if another
  // collector run appended since our read, recompute against its row so
  // overlapping runs can't both book the same interval. Claude Code cancels
  // in-flight runs, so this is rare.
  ensureDataDirs();
  const written = withSessionLock(file, () => {
    const again = readSessionTail(file, needAnchor);
    if (again.size !== tail.size) {
      tail = again;
      d = computeDeltas(tail.prev, tail.anchor, cur);
      if (d.skip) return false;
      record = buildRecord(d, tail.prev);
    }
    // Never glue a record onto a partial last line (QA-0928-13).
    appendFileSync(file, (tail.endsWithNewline ? '' : '\n') + JSON.stringify(record) + '\n');
    return true;
  });

  // Flag (don't crash on) an unrecognized or family-guessed model id so the
  // pricing config gets updated — once per session and model, not once per
  // turn (QA-0928-48: one real log held thousands of identical lines).
  if (written && (!tail.prev || tail.prev.model !== f.modelId)) {
    const resolved = getModelEntry(f.modelId);
    if (!resolved) logUnexpected('unrecognized model id (cost still anchored on payload)', f.modelId);
    else if (resolved.fallback) logUnexpected('model id hit opus-* family fallback — add explicit pricing entry/alias', f.modelId);
  }
  emitStatus(cur.cumCost, ctx);
}

function round6(n) { return Math.round(n * 1e6) / 1e6; }

// Coerce to a finite number or null (BUILD-023: fields absent on older CC).
function numOrNull(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

// Like numOrNull, but a finite numeric string counts too (the cost anchor).
function finiteOrNull(v) {
  if (typeof v === 'string' && v.trim() !== '') v = Number(v);
  return numOrNull(v);
}

// Per-turn delta for a cumulative counter, clamped non-negative. Returns null
// when the current cumulative is unavailable (field absent → no delta to record).
function monotonicDelta(cum, prevCum) {
  if (cum == null) return null;
  return Math.max(0, cum - (typeof prevCum === 'number' ? prevCum : 0));
}

// Tokens currently in the context window — the same input-only sum Claude Code
// uses for its own used_percentage. Per the statusline docs (read 2026-09-28),
// context_window.total_input_tokens already IS input + cache_creation +
// cache_read from the most recent API response, so nothing is added to it.
// (BUILD-018: the old figure added total_output and the current_usage cache
// fields on top — counting cached tokens twice — and called a context snapshot
// "tok", as if it were tokens used this session.)
function contextTokens(f) {
  const total = Number(f.cumInput) || 0;
  if (total > 0) return total;
  return (Number(f.freshInput) || 0) + (Number(f.cumCacheRead) || 0) + (Number(f.cumCacheWrite) || 0);
}

function emitStatus(cumulativeCost, ctxTokens) {
  // Short status string rendered back into Claude Code's status line: the
  // session's billing-grade cost, then the current context size (omitted before
  // the first API response).
  try {
    const costStr = typeof cumulativeCost === 'number' ? `$${cumulativeCost.toFixed(2)}` : '$—';
    const ctx = formatContext(ctxTokens);
    process.stdout.write(`wtclaude · ${costStr}${ctx ? ` · ${ctx}` : ''}`);
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
    collect(config || {});
  } catch (err) {
    // A tracker that breaks the editor is worse than no tracker. Swallow
    // everything, leave a breadcrumb, and exit clean.
    logUnexpected('collector threw', String(err && err.message || err));
  }
}

main();
process.exit(0);
