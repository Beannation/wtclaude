import { computeLeaderboardStats, localTier } from '../badges/leaderboard.js';
import { readConfigStrict, getSupabaseConfig, withConfigGuard, syncPreviewLines, SYNC_TURN_FIELDS } from '../sync/index.js';
import { LEADERBOARD_SHOWS } from './share.js';
import { formatTokens } from '../utils/cost.js';
import { amountWithBasis, excludedLines } from '../utils/format.js';
import { output } from './_summary.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude leaderboard` — local leaderboard logic (build-spec M7). Computes the
// stats + a LOCAL tier so it works offline, and shows a privacy preview: what the
// cloud leaderboard shows if you opt in, and what sync uploads (the sync
// manifest, QA-0928-05). Sharing is opt-in (share --enable); nothing leaves the
// machine from this command — it only previews/ranks locally.

export function registerLeaderboard(program) {
  program
    .command('leaderboard')
    .description('Your local leaderboard standing + a privacy preview of what would be shared')
    .option('--json', 'Output machine-readable JSON')
    .action(withConfigGuard((opts) => {
      const o = opts || {};
      const cfg = readConfigStrict();
      const stats = computeLeaderboardStats();
      const tier = localTier(stats.total_tokens);
      const sharingEnabled = !!cfg.sharing_enabled;
      const { syncEnabled } = getSupabaseConfig();

      if (o.json) {
        output(JSON.stringify({
          schema_version: SCHEMA_VERSION,
          tier: tier.key, tier_label: tier.label,
          next_tier: tier.next,
          stats,
          sharing_enabled: sharingEnabled,
          sync_enabled: !!syncEnabled,
          shared_fields: sharedFields(stats),
          leaderboard_shows: LEADERBOARD_FIELDS,
          synced_fields: SYNC_TURN_FIELDS.map((g) => g.label),
        }, null, 2), o);
        return;
      }

      const lines = ['\n  Leaderboard (local)', '  ==================='];
      lines.push('');
      lines.push(`  Tier:           ${tier.label}`);
      if (tier.next) {
        lines.push(`  Next tier:      ${tier.next.label} — ${formatTokens(tier.next.remaining)} tokens to go`);
      } else {
        lines.push('  Next tier:      top tier reached');
      }
      lines.push('');
      lines.push(`  Total tokens:   ${formatTokens(stats.total_tokens)}`);
      // RC 2026-09-28: labelled by basis, "— (not priced)" when nothing could be.
      const b = stats.cost_basis;
      const basis = { cost: stats.total_cost_usd, anchored_cost: b.anchored_usd, estimated_cost: b.estimated_usd, anchored_turns: b.anchored_turns, estimated_turns: b.estimated_turns, excluded_turns: b.excluded_turns, excluded_models: b.excluded_models };
      lines.push(`  Total cost:     ${amountWithBasis(stats.total_cost_usd, basis)}`);
      lines.push(...excludedLines(basis));
      lines.push(`  Sessions:       ${stats.total_sessions}`);
      lines.push(`  Active days:    ${stats.active_days}`);
      lines.push(`  Longest streak: ${stats.longest_streak} day${stats.longest_streak === 1 ? '' : 's'}`);
      lines.push(`  Badges earned:  ${stats.badges_earned}`);
      lines.push('');
      lines.push('  Privacy preview — if you opt in, the leaderboard shows');
      for (const line of LEADERBOARD_SHOWS) lines.push(`  ${line}`);
      lines.push('  It ranks from what cloud sync uploads:');
      for (const line of syncPreviewLines()) lines.push(line);
      lines.push('');
      lines.push(`  Sharing: ${sharingEnabled ? 'ENABLED' : 'off'}${sharingEnabled ? '' : ' — opt in with `wtclaude share --enable`'}.`);
      if (sharingEnabled && !syncEnabled) {
        lines.push('  (Cloud ranking also needs sync: `wtclaude sync --enable`.)');
      }
      lines.push('');
      output(lines.join('\n'), o);
    }));
}

// shared_fields is part of the schema 1.0 --json contract (src/utils/schema.js),
// so its keys and {key, label, value} shape stay as they were. Each value is
// derived from what sync uploads (badges go up as they are). It is not the whole
// upload: synced_fields lists that (the sync manifest), and leaderboard_shows
// lists what the cloud leaderboard displays. Both were added in 0.3.2 (additive).
function sharedFields(stats) {
  return [
    { key: 'total_tokens', label: 'Total tokens', value: stats.total_tokens },
    { key: 'total_sessions', label: 'Sessions', value: stats.total_sessions },
    { key: 'active_days', label: 'Active days', value: stats.active_days },
    { key: 'longest_streak', label: 'Longest streak', value: stats.longest_streak },
    { key: 'badges_earned', label: 'Badges earned', value: stats.badges_earned },
    { key: 'tier', label: 'Tier', value: stats.tier },
  ];
}

// What the cloud leaderboard shows for an opted-in user (get-leaderboard), per
// week and per month.
const LEADERBOARD_FIELDS = [
  { key: 'total_tokens', label: 'Total tokens' },
  { key: 'session_count', label: 'Sessions' },
  { key: 'turn_count', label: 'Turns' },
];
