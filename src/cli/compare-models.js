import { getSessionsForDateRange, summarizeTurns } from '../utils/sessions.js';
import { formatCost } from '../utils/cost.js';
import { costBasisBadge, headlineExclusionNote, wrapWords } from '../utils/format.js';
import { localDate } from '../utils/time.js';
import { parseDaysOption, windowStart, splitHistory, coveredDays, projectionNote } from '../utils/window.js';
import { output } from './_summary.js';
import { SCHEMA_VERSION } from '../utils/schema.js';
import { computeComparison, COMPARE_MODELS } from '../compare-models/compute.js';
import { readCowork } from '../compare-models/cowork-reader.js';

// `wtclaude compare-models` — re-price the user's real, recorded usage across
// the three comparison models, split by surface (Code as % differences beside
// its billing-grade total, Cowork labeled estimate, Chat excluded). A free
// Phase-0 accuracy feature; a SEPARATE
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
    .option('--days <n>', 'Look-back window for the re-pricing', parseDaysOption, 30)
    .action((opts) => {
      const o = opts || {};
      const days = o.days;
      const endStr = localDate();
      const startStr = windowStart(days);

      // All tracked history in one read: the window, plus the first tracked day
      // so /mo figures scale by the days the data covers (QA-0928-22).
      const history = splitHistory(getSessionsForDateRange('0000-01-01', endStr), startStr, endStr);
      const codeTurns = history.sessions.flatMap(s => s.turns);
      const cowork = readCowork({ start: startStr, end: endStr });
      const coworkFirst = cowork.older_than_window ? startStr : cowork.first_date;
      const covered = {
        code: coveredDays(days, history.firstDate, endStr) ?? days,
        cowork: coveredDays(days, coworkFirst, endStr) ?? days,
      };
      // The Code surface's real spend for the window: the billing-grade anchor
      // where recorded (decision 4 — shown beside the % differences).
      const sum = summarizeTurns(codeTurns);
      // How many of the Code turns re-pricing leaves out carry no cost from
      // Claude Code — the headline leaves those out too (summarizeTurns'
      // excluded_turns: turnCostBasis(t).basis === 'excluded').
      const headlineExcluded = sum.excluded_turns;
      const billed = {
        usd: round(sum.cost), anchored_usd: round(sum.anchored_cost), estimated_usd: round(sum.estimated_cost),
        anchored_turns: sum.anchored_turns, estimated_turns: sum.estimated_turns,
        label: costBasisBadge(sum).label,
      };
      const cmp = computeComparison({ codeTurns, coworkTurns: cowork.turns, today: endStr, days, coveredDays: covered, billed });
      // What the reader saw (additive, QA-0928-84): logs found but idle in the
      // window is not the same as nothing captured on this machine.
      Object.assign(cmp.surfaces.cowork, { files_found: cowork.files_found, partial_count: cowork.partial_count });
      cmp.surfaces.code.history_found = history.firstDate != null;

      if (o.json) {
        output(JSON.stringify({
          schema_version: SCHEMA_VERSION, estimate: true, window: { start: startStr, end: endStr, days }, ...cmp,
        }, null, 2), o);
        return;
      }

      const lines = [];
      lines.push(`\n  Compare models — ${MODEL_LABELS.join(' vs ')}  (estimate)`);
      lines.push('  ' + '='.repeat(60));
      lines.push('');

      // "No usage data" only when there genuinely is none. FIXED 2026-09-27: a
      // window whose every turn was EXCLUDED as unpriceable used to land here
      // too — shipped 0.3.0 tells a user whose week is all Opus 5.5 (Claude
      // Code's default since v2.1.280) that it found no usage at all. Excluded
      // turns fall through to renderSurface(), which says what was left out.
      const excluded = cmp.surfaces.code.unpriced_turn_count + cmp.surfaces.cowork.unpriced_turn_count;
      if (!cmp.surfaces.code.present && !cmp.surfaces.cowork.present && excluded === 0) {
        lines.push(`  No usage data found in the last ${days} days. The collector captures`);
        lines.push('  your terminal Code usage — run some Claude Code sessions, then retry.');
        lines.push('');
        output(lines.join('\n'), o);
        return;
      }

      lines.push(`  Re-pricing your recorded usage over the last ${days} day${days === 1 ? '' : 's'} (${startStr} to ${endStr})`);
      lines.push('  across all three models, split by where you work:');
      lines.push('');

      renderSurface(lines, cmp.surfaces.code, days, headlineExcluded);
      renderSurface(lines, cmp.surfaces.cowork, days);
      renderSurface(lines, cmp.surfaces.chat, days);

      lines.push('  ── the honest fine print ─────────────────────────────────');
      for (const c of cmp.caveats) lines.push('  • ' + c);
      lines.push('');
      output(lines.join('\n'), o);
    });
}

// FIXED 2026-09-28 (QA-0928-21): 'billing-grade' printed "[billing-grade
// tokens]" over re-priced figures. No re-priced figure is billing-grade; only
// the Code surface's billed total is, and that line says so itself.
function gradeTag(grade) {
  if (grade === 'estimate') return '[labeled estimate]';
  if (grade === 'excluded') return '[excluded]';
  return '';
}

function renderSurface(lines, s, days, headlineExcluded = 0) {
  lines.push(`  ${s.label}  ${gradeTag(s.grade)}`);

  // FIXED 2026-09-27: a surface whose EVERY turn was excluded as unpriceable
  // used to fall into the "no data" branch and print "No data captured on this
  // machine." — false: the data was captured and then excluded. Shipped 0.3.0
  // says exactly that to a user whose window is all Opus 5.5 (Claude Code's
  // default since v2.1.280), because every such turn hits the opus family
  // fallback. The exclusion notice is the true statement, so it wins.
  if (s.grade !== 'excluded' && !s.present && s.unpriced_turn_count > 0) {
    pushExclusion(lines, s, headlineExcluded);
    lines.push('');
    return;
  }

  // FIXED 2026-09-28 (QA-0928-84): "No data captured on this machine" (plus
  // the env-var hint) printed whenever a surface had nothing IN THE WINDOW —
  // including with 702 Cowork logs found and read. Idle is not uncaptured.
  if (s.grade === 'excluded' || !s.present) {
    const found = s.key === 'cowork' ? s.files_found > 0 : s.history_found;
    if (s.reason) lines.push('    ' + s.reason);
    else if (found) lines.push(`    No ${s.key === 'cowork' ? 'Cowork' : 'Code'} activity in the last ${days} day${days === 1 ? '' : 's'}.`);
    else lines.push('    No data captured on this machine.');
    if (s.key === 'cowork' && !found) {
      lines.push('    (Point WTCLAUDE_COWORK_AUDIT at a Cowork audit.jsonl to include it.)');
    }
    lines.push('');
    return;
  }

  if (s.usd_withheld) {
    // Decision 4 (QA-0928-21): % differences only, beside the real billed total.
    const b = s.billed || {};
    lines.push(`    Billed in this window: ${formatCost(b.usd || 0)}${b.label ? ` (${b.label})` : ''}`);
    lines.push('    Each model against your mix, re-priced the same way (token × rate):');
    for (const m of s.models) {
      const sign = m.delta_pct > 0 ? '+' : '';
      lines.push(`      ${m.label.padEnd(10)} ${`${sign}${m.delta_pct}%`.padStart(6)}   vs your mix, re-priced`);
    }
    for (const l of wrap(s.withheld_reason, 70)) lines.push(`    ${l}`);
  } else {
    for (const m of s.models) {
      // Monthly-scale delta (2026-09-27): it sits between two /mo figures, so it
      // must be /mo too. The window delta disagreed with both whenever --days != 30.
      const d = m.monthly_delta_vs_baseline_usd ?? m.delta_vs_baseline_usd;
      const sign = d > 0 ? '+' : ''; // dollar and pct share a sign; formatCost carries the minus
      const delta = `${sign}${formatCost(d)} / ${sign}${m.delta_pct}%`;
      lines.push(`    ${m.label.padEnd(18)} ${formatCost(m.monthly_usd).padStart(11)}/mo   (${delta} vs your mix)`);
    }
    lines.push(`    ${'Your mix, re-priced'.padEnd(18)} ${formatCost(s.baseline_monthly_usd).padStart(11)}/mo`);
    lines.push(`    (${projectionNote(s.covered_days, days)})`);
    if (s.partial_count > 0) {
      const n = s.partial_count;
      lines.push(`    ${n} request${n === 1 ? ' has' : 's have'} no final usage record (interrupted, or logged only`);
      lines.push(`    as ${n === 1 ? 'it' : 'they'} began); counted at the largest usage logged.`);
    }
  }

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
    lines.push('');
    pushExclusion(lines, s, headlineExcluded);
  }
  lines.push('');
}

function pushExclusion(lines, s, headlineExcluded = 0) {
  const n = s.unpriced_turn_count;
  if (s.present) {
    lines.push(`    ⚠ ${n} turn${n === 1 ? '' : 's'} excluded from this comparison — and from the`);
    lines.push('      baseline, so the figures above do not cover all your usage.');
  } else {
    lines.push(n === 1
      ? '    ⚠ The one turn on this surface was excluded, so there is nothing'
      : `    ⚠ All ${n} turns on this surface were excluded, so there is nothing`);
    lines.push('      to compare yet — this is not the same as having no usage.');
  }
  for (const m of s.unpriced_models) lines.push(`        · ${m}`);
  lines.push('      Either the model is not in this version\'s rate sheet, or it was');
  lines.push('      served by a partner platform that publishes its own rates.');
  // Surface-aware (2026-09-27). Only terminal Code has a headline cost from
  // Claude Code itself, and only Code turns are what `wtclaude today` counts;
  // Cowork is a labeled estimate built from Cowork's local logs, so the Code
  // sentence would be false there.
  if (s.key === 'cowork') {
    lines.push('      Cowork figures are an estimate from Cowork’s local logs, and these');
    lines.push('      turns are left out of that estimate.');
  } else {
    // Only an anchored turn still counts in the headline (ledger reviewer).
    for (const l of wrapWords(headlineExclusionNote(n, headlineExcluded), 64)) lines.push(`      ${l}`);
  }
  lines.push('      If the model is new, upgrade: `npm i -g wtclaude@latest`.');
}

// Word-wrap a sentence to `width` columns.
function wrap(text, width) {
  const out = [];
  let line = '';
  for (const w of text.split(' ')) {
    if (line && (line + ' ' + w).length > width) { out.push(line); line = w; } else line = line ? line + ' ' + w : w;
  }
  if (line) out.push(line);
  return out;
}

function round(n) { return typeof n === 'number' ? Math.round(n * 1e6) / 1e6 : n; }
