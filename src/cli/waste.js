import { scanInventory } from '../waste/inventory.js';
import { gatherEvidence, usedIdsFor } from '../waste/evidence.js';
import { computeWaste } from '../waste/compute.js';
import { claudeRoot, displayPath } from '../compare/jsonl-reader.js';
import { parseDaysOption, MAX_DAYS, coveredDays, projectionNote, windowLabel } from '../utils/window.js';
import { formatCost } from '../utils/cost.js';
import { output } from './_summary.js';
import { localDate } from '../utils/time.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude waste` — the free, read-only dead-weight reveal: always-loaded skills and
// subagents you never invoke, and what re-reading them costs at cache-read rates
// (CLAUDE.md files are listed, never judged — QA-0928-71). Reads
// transcript STRUCTURE for evidence (not token guesses); recommends REVIEW, never a
// destructive change. Claude-only.
//
// FIXED 2026-09-28 (RC, QA-0928-22 in waste): the /mo figure divided the
// window's cost by the REQUESTED --days, so one day of transcripts read 30x too
// low at the default 30 days and the figure changed with --days. It now scales
// by the days the transcripts cover (utils/window.js), like whatif,
// compare-models, fable and forecast, and says which basis it used.

export function registerWaste(program) {
  program
    .command('waste')
    .description('Reveal always-loaded skills and subagents you never use, and what they cost you (non-destructive review)')
    .option('--json', 'Output machine-readable JSON')
    // QA-0928-74: `--days 0` silently became 30 and `-3` became 1.
    .option('--days <n>', `Evidence look-back window (1-${MAX_DAYS})`, parseDaysOption, 30)
    .option('--all', 'List every reviewable item (default shows the top by size)')
    .action((opts) => {
      const o = opts || {};
      const days = o.days || 30;
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - (days - 1));
      const dateFilter = { start: localDate(start), end: localDate(end) };

      const items = scanInventory();
      const evidence = gatherEvidence({ dateFilter });
      const usedIds = usedIdsFor(items, evidence);
      // Transcripts older than the window (a file last written before it, or
      // an older entry in a file the scan read) mean the whole window counts.
      const firstTracked = evidence.olderData ? '0000-01-01' : evidence.firstDate;
      const covered = coveredDays(days, firstTracked, dateFilter.end) ?? days;
      const r = computeWaste({ items, usedIds, turns: evidence.turns, modelTurns: evidence.modelTurns, days, coveredDays: covered, today: localDate(end) });

      if (o.json) {
        output(JSON.stringify({ schema_version: SCHEMA_VERSION, estimate: true, ...r }, null, 2), o);
        return;
      }

      const root = displayPath(claudeRoot());
      const lines = [];
      lines.push('\n  Context waste — always-loaded skills & rules  (estimate)');
      lines.push('  ' + '='.repeat(60));
      lines.push('');

      if (r.loaded_count === 0) {
        lines.push('  No always-loaded skills, subagents, or CLAUDE.md rules found in');
        lines.push(`  ${root} or this project — nothing to review. (Claude-only.)`);
        lines.push('');
        output(lines.join('\n'), o);
        return;
      }

      // QA-0928-71: CLAUDE.md files are no longer judged or counted as dead
      // weight, so the headline counts skills and subagents — and says so.
      if (r.judged_count === 0) {
        lines.push(`  No always-loaded skills or subagents found in ${root} or this project.`);
      } else {
        const noun = r.judged_count === 1 ? 'skill or subagent' : 'skills and subagents';
        lines.push(`  ${r.judged_count} always-loaded ${noun}, ${r.used_count} used in the ${windowLabel(days)}.`);
        if (r.dead_count > 0 && r.monthly_usd !== null) {
          lines.push(`  ~${formatCost(r.monthly_usd)}/mo re-reading the other ${r.dead_count} at cache-read rates.  [estimate]`);
          lines.push(`  (${projectionNote(r.covered_days, days)})`);
          for (const l of excludedLines(r)) lines.push(`  ${l}`);
        } else if (r.dead_count > 0) {
          // Withheld, not guessed: see computeWaste() — a family-fallback,
          // partner-platform or unknown rate never produces a figure shown as ours.
          lines.push(`  ${r.dead_count} ${r.dead_count === 1 ? 'is' : 'are'} never invoked. No dollar figure is shown:`);
          for (const l of withheldReason(r)) lines.push(`  ${l}`);
        } else {
          lines.push('  Every loaded skill and subagent was invoked in the window — no dead weight found.');
        }
      }
      if (r.instructions.length > 0) {
        const n = r.instructions.length;
        lines.push(`  ${n} CLAUDE.md file${n === 1 ? ' is' : 's are'} also always loaded — not invocable, so no invocation evidence.`);
        lines.push(`  Listed below with ${n === 1 ? 'its' : 'their'} size; not counted in the figure above.`);
      }
      lines.push('');

      lines.push('  How this actually costs you (the real mechanism):');
      // The cache-read multiplier is PER-MODEL (0.025x on Fable 5.1 / Mythos
      // 5.1, 0.05x on Opus 5.5, 0.1x elsewhere), so render the rate actually
      // resolved for each model — never a hard-coded 10%.
      if (r.cache_read_multiplier !== null) {
        lines.push(`    • re-read every turn — unused prose rides your cached context at ${pct(r.cache_read_multiplier)} of`);
        lines.push(`      the input rate on every subsequent turn (${r.turns} turns tracked).`);
      } else if (r.models.length > 1) {
        lines.push('    • re-read every turn — unused prose rides your cached context at each model\'s');
        lines.push(`      cache-read rate on every subsequent turn (${r.turns} turns tracked):`);
        for (const m of r.models) lines.push(`      ${pct(m.cache_read_multiplier)} of the input rate on ${m.model} (${turnsLabel(m.turns)}).`);
      } else {
        lines.push('    • re-read every turn — unused prose rides your cached context at your');
        lines.push(`      model's cache-read rate on every subsequent turn (${r.turns} turns tracked).`);
      }
      lines.push('    • window bloat — it crowds the context window, forcing earlier compaction.');
      lines.push('    • worse tool selection — more never-used options, more chances to misfire.');
      lines.push('');

      const dead = r.items.filter(i => i.used === false).sort((a, b) => (b.tokens || 0) - (a.tokens || 0));
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

      if (r.instructions.length > 0) {
        lines.push('  Always loaded — not invocable, so no invocation evidence (not judged):');
        for (const it of r.instructions) {
          lines.push(`    ALWAYS  ${it.id.padEnd(26)} ~${tok(it.tokens)}  ${it.source}`);
        }
        lines.push('');
      }

      lines.push('  Billing-grade vs estimate:');
      if (r.priced && r.input_rate !== null) {
        lines.push(`    • billing-grade: turns re-read (your transcript), the ${pct(r.cache_read_multiplier)} cache-read`);
        lines.push(`      multiplier and the $${r.input_rate}/MTok input rate for ${r.model}.`);
      } else if (r.priced) {
        // Several models: billing-grade is claimed for the turn counts only (as
        // the withheld branches below do); the rates are this rate sheet's.
        lines.push('    • billing-grade: turns re-read (your transcript), per model.');
        lines.push('    • list rates (this rate sheet): each model\'s cache-read multiplier and input rate:');
        for (const m of r.models) lines.push(`      ${m.model}: ${pct(m.cache_read_multiplier)} of $${m.input_rate}/MTok (${turnsLabel(m.turns)}).`);
      } else if (r.dead_count > 0 && r.monthly_usd === null) {
        // The headline already printed the reason — refer to it, don't repeat it.
        lines.push('    • billing-grade: turns re-read (your transcript). No rate is shown,');
        lines.push('      for the reason above.');
      } else {
        // Nothing is being re-read, so the headline showed a true $0 and no
        // reason — print it here instead.
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

function turnsLabel(n) { return `${n} turn${n === 1 ? '' : 's'}`; }

function pct(mult) {
  return `${+(mult * 100).toFixed(1)}%`;
}

// QA-0928-20: turns on a model this rate sheet cannot price are left out of the
// dollar figure — never priced at another model's rate — and named here.
function excludedLines(r) {
  return (r.excluded_models || []).map(({ model, turns, reason }) => {
    const n = turnsLabel(turns);
    if (!model) return `Left out of the figure — ${n} with no model recorded.`;
    if (reason.startsWith('partner-platform:')) {
      return `Left out of the figure — ${n} on ${model}: served through ${reason.slice('partner-platform:'.length)}, which publishes its own rates.`;
    }
    return `Left out of the figure — ${n} on ${model}: not in this rate sheet.`;
  });
}

// Why the dollar figure is withheld, in plain words. `unpriced_reason` uses the
// same vocabulary as priceTurn(): no-model | unresolved-model |
// partner-platform:<p> | family-fallback:<nearest key>.
function withheldReason(r) {
  const reason = r.unpriced_reason || '';
  const id = r.model_id || 'your model';
  const others = (r.excluded_models || []).filter(m => m.model && m.model !== r.model_id).map(m => m.model);
  const also = others.length ? [`(Also not priceable here: ${others.join(', ')}.)`] : [];
  if (reason.startsWith('family-fallback:')) {
    return [
      `${id} is not in this version's rate sheet. The nearest Opus rate would be`,
      'a guess, and a guessed rate is not a number we will show as ours.',
      'If it is a new model, update wtclaude: npm i -g wtclaude@latest.',
      'If it is a Bedrock or Google Cloud id, that platform publishes its own rates.',
      ...also,
    ];
  }
  if (reason.startsWith('partner-platform:')) {
    return [
      `${id} is served through ${reason.slice('partner-platform:'.length)}, which publishes its own rates,`,
      'so a first-party rate would not be your rate.',
      ...also,
    ];
  }
  if (reason === 'unresolved-model') {
    return [
      `${id} is not in this version's rate sheet.`,
      'If it is a new model, update wtclaude: npm i -g wtclaude@latest.',
      'If it is a Bedrock or Google Cloud id, that platform publishes its own rates.',
      ...also,
    ];
  }
  return ['no model could be read from your transcripts in this window.'];
}

function tok(n) {
  if (!n) return '0 tok';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K tok`;
  return `${n} tok`;
}
