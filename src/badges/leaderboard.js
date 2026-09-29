import { listSessions, readSession, summarizeTurns } from '../utils/sessions.js';
import { localDateOf } from '../utils/time.js';
import { checkBadges, longestStreak } from './check.js';
import { costBasisJson } from '../utils/format.js';

// Local leaderboard logic (build-spec M7). Computes the stats `wtclaude
// leaderboard` shows and assigns a LOCAL tier so the feature works fully
// offline. The stats are totals over local data — tokens, cost, sessions,
// turns, active days, streak, badge count — and nothing here reads paths,
// prompts, code or file names. They are NOT what reaches the cloud: the cloud
// leaderboard (get-leaderboard) ranks from what sync uploads, the per-turn
// manifest in sync/index.js (SYNC_TURN_FIELDS), which is what the privacy
// previews list.

// Token-volume tiers (local, deterministic). Mirrors the badge ladder so the
// rank a user sees offline matches the cloud bucket they'd land in.
const TIERS = [
  { key: 'newcomer', label: 'Newcomer', min: 0 },
  { key: 'regular', label: 'Regular', min: 100_000 },
  { key: 'power', label: 'Power User', min: 1_000_000 },
  { key: 'heavy', label: 'Heavy Hitter', min: 10_000_000 },
  { key: 'elite', label: 'Elite', min: 100_000_000 },
];

export function localTier(totalTokens) {
  let tier = TIERS[0];
  for (const t of TIERS) if (totalTokens >= t.min) tier = t;
  const idx = TIERS.indexOf(tier);
  const next = TIERS[idx + 1] || null;
  return { ...tier, next: next ? { label: next.label, min: next.min, remaining: next.min - totalTokens } : null };
}

// `cost_basis` (RC 2026-09-28): how much of total_cost_usd is the billing-grade
// anchor and how much a list-rate estimate, and which turns it leaves out —
// the same breakdown `today` gives — so the total is never shown unlabelled.
export function computeLeaderboardStats() {
  let totalTokens = 0, totalCost = 0, totalTurns = 0;
  const activeDates = new Set();
  const basis = { cost: 0, anchored_cost: 0, estimated_cost: 0, anchored_turns: 0, estimated_turns: 0, excluded_turns: 0, excluded_models: {} };

  for (const id of listSessions()) {
    const turns = readSession(id);
    if (turns.length === 0) continue;
    const s = summarizeTurns(turns);
    totalTokens += s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens;
    totalCost += s.cost;
    totalTurns += s.turn_count;
    for (const k of ['cost', 'anchored_cost', 'estimated_cost', 'anchored_turns', 'estimated_turns', 'excluded_turns']) basis[k] += s[k] || 0;
    for (const [m, c] of Object.entries(s.excluded_models || {})) basis.excluded_models[m] = (basis.excluded_models[m] || 0) + c;
    for (const t of turns) activeDates.add(localDateOf(t.ts));
  }

  // Longest active-day streak — the badge's own function, on LOCAL days, so
  // the leaderboard and Week Warrior can never disagree (QA-0928-86).
  const longest = longestStreak([...activeDates]);

  const badges = checkBadges();
  return {
    total_tokens: totalTokens,
    total_cost_usd: Math.round(totalCost * 1e6) / 1e6,
    cost_basis: costBasisJson(basis),
    total_sessions: listSessions().filter(id => readSession(id).length > 0).length,
    total_turns: totalTurns,
    active_days: activeDates.size,
    longest_streak: longest,
    badges_earned: badges.length,
    tier: localTier(totalTokens).key,
  };
}
