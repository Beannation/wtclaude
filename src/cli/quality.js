import { getSessionsForDateRange } from '../utils/sessions.js';
import { output, resolveRange } from './_summary.js';
import { toCSV } from '../utils/export.js';
import { daysAgo } from './_summary.js';
import { localDate } from '../utils/time.js';
import { coldStartMessage } from '../utils/firstrun.js';
import { SCHEMA_VERSION } from '../utils/schema.js';

// `wtclaude quality` — one-shot success rate (BUILD-016). A "one-shot success"
// is an edit target the model got right without a retry; a retry is the SAME
// salted `edit_target_hash` recurring within a session. The hash is salted and
// never the path/content.
//
// HONESTY: `edit_target_hash` is not exposed in the current Claude Code payload
// (collector records it as null pending live verification), so on today's data
// this renders a clearly-labeled coming-soon state with 0 coverage rather than a
// fabricated rate. The computation below is wired so it lights up automatically
// once the field flows — no backfill, no migration.

export function computeOneShot(turns) {
  // Map of session_id -> Map(edit_target_hash -> count)
  const bySession = new Map();
  let withHash = 0;
  for (const t of turns) {
    if (t.edit_target_hash == null) continue;
    withHash++;
    if (!bySession.has(t.session_id)) bySession.set(t.session_id, new Map());
    const m = bySession.get(t.session_id);
    m.set(t.edit_target_hash, (m.get(t.edit_target_hash) || 0) + 1);
  }
  let targets = 0, oneShot = 0;
  for (const m of bySession.values()) {
    for (const count of m.values()) {
      targets++;
      if (count === 1) oneShot++;
    }
  }
  return { withHash, total: turns.length, targets, oneShot };
}

export function registerQuality(program) {
  program
    .command('quality')
    .description('One-shot success rate — edits landed without a retry (file-aware, salted)')
    .option('--json', 'Output machine-readable JSON')
    .option('--csv', 'Output CSV')
    .option('--clipboard', 'Copy the output to the clipboard as well')
    .option('--since <date>', 'Start date (YYYY-MM-DD)')
    .option('--until <date>', 'End date (YYYY-MM-DD)')
    .action((opts) => {
      const o = opts || {};
      // QA-0928-169: the same range rules as today/week/month — a malformed
      // date is refused, never echoed back as the range. QA-0928-56: --until
      // alone ends quality's own 30-day window on that day.
      let start, end;
      try {
        ({ startStr: start, endStr: end } = resolveRange(daysAgo(29), localDate(), o, { span: 30 })); // local calendar dates (QA-BUG-10)
      } catch (err) {
        console.error(`\n  ${err.message}\n`);
        process.exitCode = 1;
        return;
      }
      const turns = getSessionsForDateRange(start, end).flatMap(s => s.turns);
      const r = computeOneShot(turns);
      const rate = r.targets > 0 ? r.oneShot / r.targets : null;

      if (o.json) {
        output(JSON.stringify({
          schema_version: SCHEMA_VERSION,
          range: { since: start, until: end },
          available: r.withHash > 0,
          edit_targets: r.targets,
          one_shot_successes: r.oneShot,
          one_shot_rate: rate,
          coverage: { turns_with_edit_hash: r.withHash, total_turns: r.total },
        }, null, 2), o);
        return;
      }
      if (o.csv) {
        output(toCSV([{ one_shot_rate: rate == null ? '' : rate.toFixed(4), edit_targets: r.targets, one_shot_successes: r.oneShot }]), o);
        return;
      }

      // No turns at all is a cold start, not a payload gap (QA-0928-169).
      if (r.total === 0) {
        output(coldStartMessage(`${start} to ${end}`), o);
        return;
      }

      const lines = ['\n  One-shot success rate', '  ====================='];
      if (r.withHash === 0) {
        lines.push('');
        lines.push('  Not available yet. This metric reads the salted `edit_target_hash`');
        lines.push('  to detect when an edit had to be retried on the same target. That');
        lines.push('  field is null on the current Claude Code payloads, so there is no');
        lines.push('  data to score (it is captured from day one and will populate with');
        lines.push('  no backfill once the payload exposes it).');
        lines.push('');
        lines.push(`  Turns scanned: ${r.total} · with an edit-target hash: 0`);
        lines.push('');
        output(lines.join('\n'), o);
        return;
      }
      lines.push('');
      lines.push(`  One-shot rate:   ${(rate * 100).toFixed(1)}%`);
      lines.push(`  Edit targets:    ${r.targets}`);
      lines.push(`  Landed first try:${String(r.oneShot).padStart(5)}`);
      lines.push(`  Needed a retry:  ${String(r.targets - r.oneShot).padStart(5)}`);
      lines.push(`  (file-aware via salted edit_target_hash — never the path or content)`);
      lines.push('');
      output(lines.join('\n'), o);
    });
}
