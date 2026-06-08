import { listSessions, readSession, summarizeTurns } from '../utils/sessions.js';
import { checkBadges } from './check.js';

// Local leaderboard logic. Computes the anonymized, share-safe metrics that feed
// the community leaderboard (build-spec M7 get-leaderboard) and assigns a LOCAL
// tier so the feature works fully offline. Privacy non-negotiable: counts/flags
// and aggregates ONLY — never paths, prompts, code, file names, or project paths.

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

export function computeLeaderboardStats() {
  let totalTokens = 0, totalCost = 0, totalTurns = 0;
  const activeDates = new Set();

  for (const id of listSessions()) {
    const turns = readSession(id);
    if (turns.length === 0) continue;
    const s = summarizeTurns(turns);
    totalTokens += s.input_tokens + s.output_tokens + s.cache_read_tokens + s.cache_write_tokens;
    totalCost += s.cost;
    totalTurns += s.turn_count;
    for (const t of turns) activeDates.add(t.ts.slice(0, 10));
  }

  // Longest active-day streak (same approach as badge stats).
  const sorted = [...activeDates].sort();
  let longest = 0, cur = sorted.length ? 1 : 0;
  for (let i = 1; i < sorted.length; i++) {
    const diff = (Date.parse(sorted[i]) - Date.parse(sorted[i - 1])) / 86_400_000;
    if (diff === 1) cur++; else { if (cur > longest) longest = cur; cur = 1; }
  }
  if (cur > longest) longest = cur;

  const badges = checkBadges();
  return {
    total_tokens: totalTokens,
    total_cost_usd: Math.round(totalCost * 1e6) / 1e6,
    total_sessions: listSessions().filter(id => readSession(id).length > 0).length,
    total_turns: totalTurns,
    active_days: activeDates.size,
    longest_streak: longest,
    badges_earned: badges.length,
    tier: localTier(totalTokens).key,
  };
}
