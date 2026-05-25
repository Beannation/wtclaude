import { listSessions, readSession, summarizeTurns } from '../utils/sessions.js';

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
    type: 'efficient_day',
    label: 'Cache Champion',
    description: 'Achieved 50%+ cache hit rate in a day',
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
  const sessionIds = listSessions();
  let totalTokens = 0;
  let maxModelsInSession = 0;
  let bestCacheRate = 0;
  const activeDates = new Set();

  for (const id of sessionIds) {
    const turns = readSession(id);
    if (turns.length === 0) continue;

    const summary = summarizeTurns(turns);
    totalTokens += summary.input_tokens + summary.output_tokens +
                   summary.cache_read_tokens + summary.cache_write_tokens;

    const modelCount = Object.keys(summary.models).length;
    if (modelCount > maxModelsInSession) maxModelsInSession = modelCount;

    for (const t of turns) {
      activeDates.add(t.ts.slice(0, 10));

      const totalInput = t.input_tokens + t.cache_read_tokens + t.cache_write_tokens;
      if (totalInput > 0) {
        const rate = t.cache_read_tokens / totalInput;
        if (rate > bestCacheRate) bestCacheRate = rate;
      }
    }
  }

  const sortedDates = [...activeDates].sort();
  let longestStreak = 0;
  let currentStreak = 1;

  for (let i = 1; i < sortedDates.length; i++) {
    const prev = new Date(sortedDates[i - 1]);
    const curr = new Date(sortedDates[i]);
    const diffDays = (curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);

    if (diffDays === 1) {
      currentStreak++;
    } else {
      if (currentStreak > longestStreak) longestStreak = currentStreak;
      currentStreak = 1;
    }
  }
  if (currentStreak > longestStreak) longestStreak = currentStreak;

  return {
    totalSessions: sessionIds.length,
    totalTokens,
    longestStreak,
    bestCacheRate,
    maxModelsInSession,
  };
}
