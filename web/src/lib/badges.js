// The badge list the dashboard shows (earned ones come from get-dashboard's
// `badges`, which the CLI computes). The label and description of each badge
// mirror src/badges/check.js word for word; src/lib/badges.test.js fails when
// the two drift (QA-0928-85: the web kept "cache hit rate" after the CLI
// dropped it).
export const ALL_BADGES = [
  { type: 'first_session', label: 'First Steps', description: 'Tracked your first session' },
  { type: '100k_club', label: '100K Club', description: 'Tracked 100,000 tokens' },
  { type: 'million_club', label: 'Million Club', description: 'Tracked 1,000,000 tokens' },
  { type: '10m_club', label: '10M Club', description: 'Tracked 10,000,000 tokens' },
  { type: 'week_streak', label: 'Week Warrior', description: 'Tracked 7 consecutive days' },
  { type: 'month_streak', label: 'Month Master', description: 'Tracked 30 consecutive days' },
  { type: 'efficient_day', label: 'Cache Champion', description: "Cache reads were half or more of a day's recorded input-side tokens, on a day with 10+ turns. A turn's input side is its recorded input, which already includes cache reads and writes (they are added only on older records whose input is smaller than the two combined)" },
  { type: 'model_mixer', label: 'Model Mixer', description: 'Used 2+ models in a single session' },
];
