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

      lines.push(`  ${r.loaded_count} always-loaded item${r.loaded_count === 1 ? '' : 's'}, ${r.used_count} used in the last ${days} days.`);
      if (r.dead_count > 0 && r.monthly_usd !== null) {
        lines.push(`  ~${formatCost(r.monthly_usd)}/mo re-reading the other ${r.dead_count} at cache-read rates.  [estimate]`);
      } else if (r.dead_count > 0) {
        // Withheld, not guessed: see computeWaste() — a family-fallback,
        // partner-platform or unknown rate never produces a figure shown as ours.
        lines.push(`  ${r.dead_count} ${r.dead_count === 1 ? 'is' : 'are'} never invoked. No dollar figure is shown:`);
        for (const l of withheldReason(r)) lines.push(`  ${l}`);
      } else {
        lines.push('  Every loaded item was invoked in the window — no dead weight found.');
      }
      lines.push('');

      lines.push('  How this actually costs you (the real mechanism):');
      // The cache-read multiplier is PER-MODEL (0.025x on Fable 5.1 / Mythos
      // 5.1, 0.05x on Opus 5.5, 0.1x elsewhere), so render the rate actually
      // resolved for this user's model — never a hard-coded 10%.
      if (r.cache_read_multiplier !== null) {
        lines.push(`    • re-read every turn — unused prose rides your cached context at ${pct(r.cache_read_multiplier)} of`);
        lines.push(`      the input rate on every subsequent turn (${turns} turns tracked).`);
      } else {
        lines.push('    • re-read every turn — unused prose rides your cached context at your');
        lines.push(`      model's cache-read rate on every subsequent turn (${turns} turns tracked).`);
      }
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
      if (r.priced) {
        lines.push(`    • billing-grade: turns re-read (your transcript), the ${pct(r.cache_read_multiplier)} cache-read`);
        lines.push(`      multiplier and the $${r.input_rate}/MTok input rate for ${r.model}.`);
      } else {
        // The reason is printed here, not referred to: when nothing is being
        // re-read the headline shows a true $0 and no reason appears above.
        lines.push('    • billing-grade: turns re-read (your transcript). No rate is shown:');
        for (const l of withheldReason(r)) lines.push(`      ${l}`);
      }
      if (r.monthly_usd !== null && r.dead_count > 0) {
        lines.push('    • estimate: each item’s prose token size — so the $ is an estimate of');
        lines.push('      magnitude, not a bill.');
      } else {
        lines.push('    • estimate: each item’s prose token size.');
      }
      lines.push('');
      lines.push('  WTClaude never edits, moves, or removes your skills — it reads and reviews.');
      lines.push('  Manage them yourself in Claude Code settings.');
      lines.push('');
      output(lines.join('\n'), o);
    });
}

function pct(mult) {
  return `${+(mult * 100).toFixed(1)}%`;
}

// Why the dollar figure is withheld, in plain words. `unpriced_reason` uses the
// same vocabulary as priceTurn(): no-model | unresolved-model |
// partner-platform:<p> | family-fallback:<nearest key>.
function withheldReason(r) {
  const reason = r.unpriced_reason || '';
  const id = r.model_id || 'your model';
  if (reason.startsWith('family-fallback:')) {
    return [
      `${id} is not in this version's rate sheet. The nearest Opus rate would be`,
      'a guess, and a guessed rate is not a number we will show as ours.',
      'If it is a new model, update wtclaude: npm i -g wtclaude@latest.',
      'If it is a Bedrock or Google Cloud id, that platform publishes its own rates.',
    ];
  }
  if (reason.startsWith('partner-platform:')) {
    return [
      `${id} is served through ${reason.slice('partner-platform:'.length)}, which publishes its own rates,`,
      'so a first-party rate would not be your rate.',
    ];
  }
  if (reason === 'unresolved-model') {
    return [
      `${id} is not in this version's rate sheet.`,
      'If it is a new model, update wtclaude: npm i -g wtclaude@latest.',
      'If it is a Bedrock or Google Cloud id, that platform publishes its own rates.',
    ];
  }
  return ['no model could be read from your transcripts in this window.'];
}

function tok(n) {
  if (!n) return '0 tok';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K tok`;
  return `${n} tok`;
}
