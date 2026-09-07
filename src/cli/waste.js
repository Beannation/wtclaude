import { scanInventory } from '../waste/inventory.js';
import { gatherEvidence, usedIdsFor } from '../waste/evidence.js';
import { computeWaste } from '../waste/compute.js';
import { formatCost } from '../utils/cost.js';
import { output } from './_summary.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude waste` — the free, read-only dead-weight reveal: always-loaded skills and
// rules you never invoke, and what re-reading them costs at cache-read rates. Reads
// transcript STRUCTURE for evidence (not token guesses); recommends REVIEW, never a
// destructive change. Claude-only.

export function registerWaste(program) {
  program
    .command('waste')
    .description('Reveal always-loaded skills and rules you never use, and what they cost you (non-destructive review)')
    .option('--json', 'Output machine-readable JSON')
    .option('--days <n>', 'Evidence look-back window', '30')
    .option('--all', 'List every reviewable item (default shows the top by size)')
    .action((opts) => {
      const o = opts || {};
      const days = Math.max(1, parseInt(o.days, 10) || 30);
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - (days - 1));
      const dateFilter = { start: localDate(start), end: localDate(end) };

      const items = scanInventory();
      const { usedNames, turns, model } = gatherEvidence({ dateFilter });
      const usedIds = usedIdsFor(items, usedNames);
      const r = computeWaste({ items, usedIds, turns, days, model, today: localDate(end) });

      if (o.json) {
        output(JSON.stringify({ schema_version: SCHEMA_VERSION, estimate: true, ...r }, null, 2), o);
        return;
      }

      const lines = [];
      lines.push('\n  Context waste — always-loaded skills & rules  (estimate)');
      lines.push('  ' + '='.repeat(60));
      lines.push('');

      if (r.loaded_count === 0) {
        lines.push('  No always-loaded skills, subagents, or CLAUDE.md rules found in');
        lines.push('  ~/.claude or this project — nothing to review. (Claude-only.)');
        lines.push('');
        output(lines.join('\n'), o);
        return;
      }

      lines.push(`  ${r.loaded_count} always-loaded items, ${r.used_count} used in the last ${days} days.`);
      if (r.dead_count > 0) {
        lines.push(`  ~${formatCost(r.monthly_usd)}/mo re-reading the other ${r.dead_count} at cache-read rates.  [estimate]`);
      } else {
        lines.push('  Every loaded item was invoked in the window — no dead weight found.');
      }
      lines.push('');

      lines.push('  How this actually costs you (the real mechanism):');
      // The cache-read multiplier is PER-MODEL as of the 2026-09-07 rate sheet
      // (0.025x on Fable 5.1 / Mythos 5.1, 0.1x elsewhere), so render the rate
      // that was actually resolved for this user's model rather than a
      // hard-coded 10% that is wrong for a Fable 5.1 session.
      lines.push(`    • re-read every turn — unused prose rides your cached context at ${+(r.cache_read_multiplier * 100).toFixed(1)}% of`);
      lines.push(`      the input rate on every subsequent turn (${turns} turns tracked).`);
      lines.push('    • window bloat — it crowds the context window, forcing earlier compaction.');
      lines.push('    • worse tool selection — more never-used options, more chances to misfire.');
      lines.push('');

      const dead = r.items.filter(i => !i.used).sort((a, b) => (b.tokens || 0) - (a.tokens || 0));
      if (dead.length > 0) {
        lines.push('  To review (never used ≠ never useful — prompts to check, not removals):');
        const shown = o.all ? dead : dead.slice(0, 12);
        for (const it of shown) {
          lines.push(`    REVIEW  ${it.id.padEnd(26)} ~${tok(it.tokens)}  ${it.source}`);
        }
        if (!o.all && dead.length > shown.length) {
          lines.push(`    (+${dead.length - shown.length} more — re-run with --all or --json)`);
        }
        lines.push('');
      }

      lines.push('  Billing-grade vs estimate:');
      lines.push('    • billing-grade: turns re-read (your transcript), the 10% cache-read');
      lines.push('      multiplier, and the model input rate.');
      lines.push('    • estimate: each item’s prose token size — so the $ is an estimate of');
      lines.push('      magnitude, not a bill.');
      lines.push('');
      lines.push('  WTClaude never edits, moves, or removes your skills — it reads and reviews.');
      lines.push('  Manage them yourself in Claude Code settings.');
      lines.push('');
      output(lines.join('\n'), o);
    });
}

function tok(n) {
  if (!n) return '0 tok';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K tok`;
  return `${n} tok`;
}
