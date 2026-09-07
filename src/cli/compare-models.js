import { getSessionsForDateRange } from '../utils/sessions.js';
import { formatCost } from '../utils/cost.js';
import { localDate } from '../utils/time.js';
import { output } from './_summary.js';
import { SCHEMA_VERSION } from '../utils/schema.js';
import { computeComparison, COMPARE_MODELS } from '../compare-models/compute.js';
import { readCoworkTurns } from '../compare-models/cowork-reader.js';

// `wtclaude compare-models` — re-price the user's real, recorded usage across
// the three comparison models, split by surface (Code billing-grade, Cowork
// labeled estimate, Chat excluded). A free Phase-0 accuracy feature; a SEPARATE
// command from `whatif` and `fable`. All three surfaces (CLI, dashboard tile,
// companion card) read the SAME computeComparison() so they can't drift.
//
// FIXED 2026-09-07: the description and the header hard-coded "Opus 4.8 vs
// Sonnet 5 vs Fable 5". The comparison set moved to Opus 5 on 2026-08-24 and to
// Fable 5.1 on 2026-09-07, so the two most-read strings in this command had been
// naming a model the code does not compare. They are derived from COMPARE_MODELS
// now — the label can no longer drift from the set being priced.
const MODEL_LABELS = COMPARE_MODELS.map(m => m.label);
const MODEL_LIST = MODEL_LABELS.slice(0, -1).join(', ') + ', and ' + MODEL_LABELS[MODEL_LABELS.length - 1];

export function registerCompareModels(program) {
  program
    .command('compare-models')
    .description(`Re-price your recorded usage across ${MODEL_LIST} — per-surface split (labeled estimate)`)
    .option('--json', 'Output machine-readable JSON')
    .option('--days <n>', 'Look-back window for the re-pricing', '30')
    .action((opts) => {
      const o = opts || {};
      const days = Math.max(1, parseInt(o.days, 10) || 30);
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - (days - 1));
      const startStr = localDate(start);
      const endStr = localDate(end);

      const codeTurns = getSessionsForDateRange(startStr, endStr).flatMap(s => s.turns);
      const coworkTurns = readCoworkTurns({ start: startStr, end: endStr });
      const cmp = computeComparison({ codeTurns, coworkTurns, today: endStr, days });

      if (o.json) {
        output(JSON.stringify({ schema_version: SCHEMA_VERSION, estimate: true, ...cmp }, null, 2), o);
        return;
      }

      const lines = [];
      lines.push(`\n  Compare models — ${MODEL_LABELS.join(' vs ')}  (estimate)`);
      lines.push('  ' + '='.repeat(60));
      lines.push('');

      if (!cmp.surfaces.code.present && !cmp.surfaces.cowork.present) {
        lines.push(`  No usage data found in the last ${days} days. The collector captures`);
        lines.push('  your terminal Code usage — run some Claude Code sessions, then retry.');
        lines.push('');
        output(lines.join('\n'), o);
        return;
      }

      lines.push(`  Re-pricing your recorded usage over the last ${days} days across all three`);
      lines.push('  models, split by where you work. Projected monthly cost per model:');
      lines.push('');

      renderSurface(lines, cmp.surfaces.code);
      renderSurface(lines, cmp.surfaces.cowork);
      renderSurface(lines, cmp.surfaces.chat);

      lines.push('  ── the honest fine print ─────────────────────────────────');
      for (const c of cmp.caveats) lines.push('  • ' + c);
      lines.push('');
      output(lines.join('\n'), o);
    });
}

function gradeTag(grade) {
  if (grade === 'billing-grade') return '[billing-grade tokens]';
  if (grade === 'estimate') return '[labeled estimate]';
  if (grade === 'excluded') return '[excluded]';
  return '';
}

function renderSurface(lines, s) {
  lines.push(`  ${s.label}  ${gradeTag(s.grade)}`);

  if (s.grade === 'excluded' || !s.present) {
    lines.push('    ' + (s.reason || 'No data captured on this machine.'));
    if (s.key === 'cowork') {
      lines.push('    (Point WTCLAUDE_COWORK_AUDIT at a Cowork audit.jsonl to include it.)');
    }
    lines.push('');
    return;
  }

  for (const m of s.models) {
    const d = m.delta_vs_baseline_usd;
    const sign = d > 0 ? '+' : ''; // dollar and pct share a sign; formatCost carries the minus
    const delta = `${sign}${formatCost(d)} / ${sign}${m.delta_pct}%`;
    lines.push(`    ${m.label.padEnd(9)} ${formatCost(m.monthly_usd).padStart(11)}/mo   (${delta} vs your mix)`);
  }
  lines.push(`    ${'Your mix'.padEnd(9)} ${formatCost(s.baseline_monthly_usd).padStart(11)}/mo   (baseline — what you actually run)`);

  // ADDED 2026-09-07 (B1). computeComparison has always EXCLUDED turns it cannot
  // price at first-party rates from both sides, and has always returned
  // `unpriced_turn_count` / `unpriced_models` saying so — but only the --json
  // output carried it. The human-readable table did not, so a user running an
  // unrecognised model saw a baseline that silently omitted those turns with
  // nothing to indicate it.
  //
  // Found by tracing a `claude-fable-5-1` turn through shipped 0.3.0: the turn
  // resolved to null, was dropped from the comparison, and the table showed a
  // baseline of $20.00/mo that excluded the user's single most expensive turn.
  // Adding Fable 5.1 to the rate sheet fixes that specific case; printing this
  // line fixes the class, for the next model we have not added yet.
  if (s.unpriced_turn_count > 0) {
    const n = s.unpriced_turn_count;
    lines.push('');
    lines.push(`    ⚠ ${n} turn${n === 1 ? '' : 's'} excluded from this comparison — and from the`);
    lines.push('      baseline, so the figures above do not cover all your usage.');
    for (const m of s.unpriced_models) lines.push(`        · ${m}`);
    lines.push('      Either the model is not in this version\'s rate sheet, or it was');
    lines.push('      served by a partner platform that publishes its own rates. The');
    lines.push('      cost you were actually charged is unaffected — it comes from the');
    lines.push('      billing-grade anchor, and `wtclaude today` still counts it.');
    lines.push('      If the model is new, upgrade: `npm i -g wtclaude@latest`.');
  }
  lines.push('');
}
