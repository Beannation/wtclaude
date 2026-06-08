import { computeLeaderboardStats, localTier } from '../badges/leaderboard.js';
import { getConfig, getSupabaseConfig } from '../sync/index.js';
import { formatCost, formatTokens } from '../utils/cost.js';
import { output } from './_summary.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude leaderboard` — local leaderboard logic (build-spec M7). Computes the
// share-safe stats + a LOCAL tier so it works offline, and shows a privacy
// preview of EXACTLY what would be shared. Sharing is opt-in (share --enable);
// nothing leaves the machine from this command — it only previews/ranks locally.

export function registerLeaderboard(program) {
  program
    .command('leaderboard')
    .description('Your local leaderboard standing + a privacy preview of what would be shared')
    .option('--json', 'Output machine-readable JSON')
    .action((opts) => {
      const o = opts || {};
      const stats = computeLeaderboardStats();
      const tier = localTier(stats.total_tokens);
      const cfg = getConfig();
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
      lines.push(`  Total cost:     ${formatCost(stats.total_cost_usd)}`);
      lines.push(`  Sessions:       ${stats.total_sessions}`);
      lines.push(`  Active days:    ${stats.active_days}`);
      lines.push(`  Longest streak: ${stats.longest_streak} day${stats.longest_streak === 1 ? '' : 's'}`);
      lines.push(`  Badges earned:  ${stats.badges_earned}`);
      lines.push('');
      lines.push('  Privacy preview — if you opt in, ONLY these aggregates are shared');
      lines.push('  (no prompts, code, file names, or project paths, ever):');
      for (const f of sharedFields(stats)) lines.push(`    • ${f.label}: ${f.value}`);
      lines.push('');
      lines.push(`  Sharing: ${sharingEnabled ? 'ENABLED' : 'off'}${sharingEnabled ? '' : ' — opt in with `wtclaude share --enable`'}.`);
      if (sharingEnabled && !syncEnabled) {
        lines.push('  (Cloud ranking also needs sync: `wtclaude sync --enable`.)');
      }
      lines.push('');
      output(lines.join('\n'), o);
    });
}

// The exact, share-safe field set (counts/aggregates only).
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
