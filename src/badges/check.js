import { listSessions, readSession, summarizeTurns } from '../utils/sessions.js';
import { localDateOf } from '../utils/time.js';
import { normalizeModel } from '../utils/pricing.js';
import { inputSideTokens } from '../utils/format.js';

// Cache Champion needs a real day of work, not one lucky turn (QA-0928-166).
const CACHE_DAY_MIN_TURNS = 10;

const BADGE_DEFINITIONS = [
  {
    type: 'first_session',
    label: 'First Steps',
    description: 'Tracked your first session',
    check: (stats) => stats.totalSessions >= 1,
  },
  {
    type: '100k_club',
    label: '100K Club',
    description: 'Tracked 100,000 tokens',
    check: (stats) => stats.totalTokens >= 100_000,
  },
  {
    type: 'million_club',
    label: 'Million Club',
    description: 'Tracked 1,000,000 tokens',
    check: (stats) => stats.totalTokens >= 1_000_000,
  },
  {
    type: '10m_club',
    label: '10M Club',
    description: 'Tracked 10,000,000 tokens',
    check: (stats) => stats.totalTokens >= 10_000_000,
  },
  {
    type: 'week_streak',
    label: 'Week Warrior',
    description: 'Tracked 7 consecutive days',
    check: (stats) => stats.longestStreak >= 7,
  },
  {
    type: 'month_streak',
    label: 'Month Master',
    description: 'Tracked 30 consecutive days',
    check: (stats) => stats.longestStreak >= 30,
  },
  {
    // REWORDED 2026-09-28 (QA-0928-85): the stored per-turn tokens are context
    // occupancy (BUILD-014), so this share is not a cache hit rate and must not
    // be called one. The share is over the input side (output is never cached),
    // and the description names those fields, so it cannot be read against the
    // four-field "recorded tokens" total. The badge's meaning stays Peter's call.
    // FIXED 2026-09-28 (RC): the day's input side counts each token once
    // (inputSideTokens) — the stored input already includes the cache fields,
    // and adding them again capped the share at 50%, so the badge was
    // effectively unearnable. The threshold is unchanged.
    // REWORDED 2026-09-28 (RC 0.3.2, last round): the description still read
    // "(input + cache read + cache write)", the three-field sum the fix above
    // removed. It now states the formula as computed below — per turn, the
    // recorded input when it is at least cache read + cache write, else all
    // three (inputSideTokens) — and check.test.js pins each claim in it.
    // web/src/lib/badges.js carries the same words (its test enforces it).
    type: 'efficient_day',
    label: 'Cache Champion',
    description: `Cache reads were half or more of a day's recorded input-side tokens, on a day with ${CACHE_DAY_MIN_TURNS}+ turns. A turn's input side is its recorded input, which already includes cache reads and writes (they are added only on older records whose input is smaller than the two combined)`,
    check: (stats) => stats.bestCacheRate >= 0.5,
  },
  {
    type: 'model_mixer',
    label: 'Model Mixer',
    description: 'Used 2+ models in a single session',
    check: (stats) => stats.maxModelsInSession >= 2,
  },
];

export function checkBadges() {
  const stats = computeStats();
  const earned = [];

  for (const badge of BADGE_DEFINITIONS) {
    if (badge.check(stats)) {
      earned.push({
        type: badge.type,
        label: badge.label,
        description: badge.description,
      });
    }
  }

  return earned;
}

export function checkNewBadges(previousBadgeTypes) {
  const earned = checkBadges();
  const prev = new Set(previousBadgeTypes);
  return earned.filter(b => !prev.has(b.type));
}

export function getAllBadgeDefinitions() {
  return BADGE_DEFINITIONS;
}

function computeStats() {
  const sessions = [];
  for (const id of listSessions()) sessions.push(readSession(id));
  return computeStatsFromSessions(sessions);
}

// Longest run of consecutive LOCAL calendar days in a set of 'YYYY-MM-DD'
// strings; 0 with none.
//
// FIXED 2026-09-28 (QA-0928-86): days were keyed on the UTC date, so seven
// consecutive local evenings (alternating 19:00 and 21:00 EDT) scored a 1-day
// streak, and the count started at 1 with no data. Gaps are computed on the
// Y-M-D itself, so a 23- or 25-hour DST day is still one day.
export function longestStreak(dates) {
  const sorted = [...new Set(dates)].sort();
  const dayNum = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86_400_000; };
  let longest = 0, current = 0;
  for (let i = 0; i < sorted.length; i++) {
    current = i > 0 && dayNum(sorted[i]) - dayNum(sorted[i - 1]) === 1 ? current + 1 : 1;
    if (current > longest) longest = current;
  }
  return longest;
}

// Badge stats from a list of per-session turn arrays (pure, for tests).
export function computeStatsFromSessions(sessionTurns) {
  let totalTokens = 0;
  let maxModelsInSession = 0;
  const activeDates = new Set();
  const perDay = new Map(); // local date -> { reads, total (input side), turns }
  let totalSessions = 0;

  for (const turns of sessionTurns) {
    totalSessions++;
    if (turns.length === 0) continue;

    const summary = summarizeTurns(turns);
    totalTokens += summary.input_tokens + summary.output_tokens +
                   summary.cache_read_tokens + summary.cache_write_tokens;

    // QA-0928-167: one model at two context sizes (claude-opus-5-5 and its
    // [1m] variant) is one model, so count normalized ids.
    const models = new Set(Object.keys(summary.models).map(normalizeModel).filter(k => k && !k.startsWith('<')));
    if (models.size > maxModelsInSession) maxModelsInSession = models.size;

    for (const t of turns) {
      const day = localDateOf(t.ts);
      activeDates.add(day);
      const d = perDay.get(day) || { reads: 0, total: 0, turns: 0 };
      d.reads += t.cache_read_tokens || 0;
      d.total += inputSideTokens(t); // input side counted once (RC 2026-09-28)
      d.turns++;
      perDay.set(day, d);
    }
  }

  // QA-0928-166: the day's aggregate share, on a day with enough turns to mean
  // something — not the best single turn of any day.
  let bestCacheRate = 0;
  for (const d of perDay.values()) {
    if (d.turns < CACHE_DAY_MIN_TURNS || d.total === 0) continue;
    bestCacheRate = Math.max(bestCacheRate, d.reads / d.total);
  }

  return {
    totalSessions,
    totalTokens,
    longestStreak: longestStreak([...activeDates]),
    bestCacheRate,
    maxModelsInSession,
  };
}
