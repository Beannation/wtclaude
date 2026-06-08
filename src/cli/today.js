import { addRangeOpts, emitSummary } from './_summary.js';
import { localDate } from '../utils/time.js';
import { isDualPoolActive } from '../utils/config.js';

export function registerToday(program) {
  addRangeOpts(
    program
      .command('today')
      .description('Show today\'s usage summary (supports --json, --since/--until)')
  ).action((opts) => {
    const today = localDate(); // LOCAL calendar day, not UTC (QA-BUG-10)
    const o = opts || {};
    // QA-BUG-04: post-June-15 (the dual-pool flip), `today` splits the total into
    // the interactive (subscription) and Agent-SDK (credits) pools so a dev gets
    // the per-pool read without opening the dashboard. Pre-flip it's a no-op and
    // `today` is byte-for-byte unchanged. usage_pool is already captured per turn,
    // so this is a display change, not a data change. Gated on isDualPoolActive()
    // (honors dual_pool_override), so it stays dormant until the flip.
    if (isDualPoolActive(today)) o.byPool = true;
    emitSummary(`Today (${today})`, today, today, o);
  });
}
