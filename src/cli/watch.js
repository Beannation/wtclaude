import { listSessions, readSession, getLatestRateLimitTurn, getSessionsForDateRange, summarizeSessions } from '../utils/sessions.js';
import { computeTurnCost, formatCost } from '../utils/cost.js';
import { localDate } from '../utils/time.js';

// `wtclaude watch` — live terminal monitor (A1 parity vs CCUM).
// Refreshes a compact frame: today's cost, current 5h-block burn, and the
// shared plan limit gauge with a BASIC, NON-PREDICTIVE time-to-limit estimate.
// No ML, no forecasting — a clearly-labeled linear extrapolation only (the
// predictive burn intelligence is Phase 1 Guardian).

const BLOCK_MS = 5 * 60 * 60 * 1000;

function bar(pct, width = 20) {
  const p = Math.max(0, Math.min(100, Number(pct) || 0));
  const filled = Math.round((p / 100) * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

function countdown(sec) {
  if (sec == null) return 'unknown';
  const ms = sec * 1000 - Date.now();
  if (ms <= 0) return 'now';
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

// All turns sorted oldest→newest (across sessions).
function allTurnsSorted() {
  const turns = [];
  for (const id of listSessions()) for (const t of readSession(id)) turns.push(t);
  return turns.sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

// Current 5h-block cost (billing-grade — sums the per-turn anchor).
function currentBlockCost(turns) {
  const blockStart = Math.floor(Date.now() / BLOCK_MS) * BLOCK_MS;
  let cost = 0;
  for (const t of turns) {
    const ms = Date.parse(t.ts);
    if (ms >= blockStart) cost += computeTurnCost(t);
  }
  return cost;
}

// BASIC time-to-limit: linear from the two most recent DISTINCT 5h rate-limit
// snapshots → %/hour → hours to 100%, clamped to the reset countdown. Returns a
// human string or a "not enough data" note. Honest + non-predictive by design.
function timeToLimit(turns) {
  const pts = turns
    .filter(t => t.rate_limit_5h_pct != null && t.rate_limit_5h_resets_at != null)
    .map(t => ({ ms: Date.parse(t.ts), pct: Number(t.rate_limit_5h_pct), reset: t.rate_limit_5h_resets_at }));
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  // Find the most recent earlier point with a different pct + earlier time.
  let prev = null;
  for (let i = pts.length - 2; i >= 0; i--) {
    if (pts[i].ms < last.ms && pts[i].pct !== last.pct) { prev = pts[i]; break; }
  }
  if (!prev) return { note: 'flat — no measurable burn in the window', reset: last.reset };
  const dPct = last.pct - prev.pct;
  const dHr = (last.ms - prev.ms) / 3600000;
  if (dHr <= 0 || dPct <= 0) return { note: 'not rising — limit not approaching', reset: last.reset };
  const ratePerHr = dPct / dHr;
  const hrsToFull = (100 - last.pct) / ratePerHr;
  return { hrsToFull, ratePerHr, reset: last.reset };
}

function renderFrame() {
  const turns = allTurnsSorted();
  const today = localDate(); // local calendar day (QA-BUG-10); the live clock below stays labeled UTC
  const todaySessions = getSessionsForDateRange(today, today);
  const todayCost = todaySessions.length ? summarizeSessions(todaySessions).cost : 0;
  const blockCost = currentBlockCost(turns);
  const rl = getLatestRateLimitTurn();
  const ttl = timeToLimit(turns);

  const lines = [];
  lines.push(`  wtclaude watch · ${new Date().toISOString().slice(11, 19)} UTC`);
  lines.push('  ' + '─'.repeat(46));
  lines.push(`  Today:            ${formatCost(todayCost)}`);
  lines.push(`  Current 5h block: ${formatCost(blockCost)}`);
  if (rl) {
    lines.push('');
    lines.push(`  5-hour limit  ${bar(rl.rate_limit_5h_pct)} ${String(Math.round(rl.rate_limit_5h_pct ?? 0)).padStart(3)}%  resets in ${countdown(rl.rate_limit_5h_resets_at)}`);
    lines.push(`  7-day limit   ${bar(rl.rate_limit_7d_pct)} ${String(Math.round(rl.rate_limit_7d_pct ?? 0)).padStart(3)}%  resets in ${countdown(rl.rate_limit_7d_resets_at)}`);
  } else {
    lines.push('');
    lines.push('  (no rate-limit data yet — older CC, or OAuth fallback applies)');
  }
  lines.push('');
  if (!ttl) {
    lines.push('  Time to 5h limit: need ≥2 snapshots to estimate');
  } else if (ttl.note) {
    lines.push(`  Time to 5h limit: ${ttl.note}`);
  } else {
    const capped = Math.min(ttl.hrsToFull, Math.max(0, (ttl.reset * 1000 - Date.now()) / 3600000));
    const hrs = Math.floor(capped);
    const mins = Math.round((capped - hrs) * 60);
    lines.push(`  Time to 5h limit: ~${hrs}h ${mins}m at the current burn (est. · non-predictive)`);
  }
  lines.push('  ' + '─'.repeat(46));
  return lines.join('\n');
}

export function registerWatch(program) {
  program
    .command('watch')
    .description('Live monitor: cost, 5h block, plan limit + basic non-predictive time-to-limit')
    .option('--once', 'Render a single frame and exit (for scripting/CI)')
    .option('--interval <s>', 'Refresh interval in seconds', '5')
    .action((opts) => {
      const o = opts || {};
      if (o.once) { console.log(renderFrame()); return; }
      const interval = Math.max(1, parseInt(o.interval, 10) || 5) * 1000;
      const draw = () => { process.stdout.write('\x1b[2J\x1b[H'); console.log(renderFrame()); console.log('\n  Ctrl-C to exit.'); };
      draw();
      const timer = setInterval(draw, interval);
      process.on('SIGINT', () => { clearInterval(timer); process.stdout.write('\n'); process.exit(0); });
    });
}
