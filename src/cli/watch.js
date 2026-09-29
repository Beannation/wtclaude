import { listSessions, readSessionCached, latestRateLimit, summarizeTurns } from '../utils/sessions.js';
import { basisTag, moneyWithBasis } from '../utils/format.js';
import { localDate, localDateOf, normalizeResetsAt, formatDuration } from '../utils/time.js';
import { gauge, asOf } from './limit.js';

// `wtclaude watch` — live terminal monitor (A1 parity vs CCUM).
// Refreshes a compact frame: today's cost, the current fixed UTC 5h block, and
// the shared plan limit gauge with a BASIC, NON-PREDICTIVE time-to-limit
// estimate. No ML, no forecasting — a clearly-labeled linear extrapolation only
// (the predictive burn intelligence is Phase 1 Guardian).
//
// QA-0928-161: each frame reads the turns ONCE (with a per-file cache, so an
// unchanged file is not re-parsed) and derives everything from that array.

const BLOCK_MS = 5 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
// Readings from the same window can differ by a few seconds of resets_at.
const SAME_WINDOW_MS = 5 * 60 * 1000;
// Below this much of a window the average rate says nothing useful.
const MIN_SPAN_MS = 15 * 60 * 1000;

// All turns sorted oldest→newest (across sessions), via the per-file cache.
function allTurnsSorted(cache) {
  const turns = listSessions().flatMap(id => readSessionCached(id, cache));
  return turns.sort((a, b) => (a.ts < b.ts ? -1 : 1));
}

// BASIC time-to-limit (QA-0928-60). Only snapshots from the CURRENT 5-hour window
// (the latest resets_at) count; the reading is the running max across sessions
// (a lagging session's lower % is not a drop); the rate is the window average —
// % used ÷ time since the window began (resets_at − 5 h) — not two points
// seconds apart. Returns null with no snapshot, { note } for a plain-language
// state (including a snapshot whose reset time cannot be read), or
// { msToLimit } from `now`. Honest + non-predictive by design.
export function timeToLimit(turns, now = Date.now()) {
  const pts = [];
  let reset = null, snapshots = 0;
  for (const t of turns) {
    if (t.rate_limit_5h_pct == null) continue;
    snapshots++;
    const r = normalizeResetsAt(t.rate_limit_5h_resets_at);
    const ms = Date.parse(t.ts);
    const pct = Number(t.rate_limit_5h_pct);
    if (r == null || !Number.isFinite(ms) || !Number.isFinite(pct)) continue;
    pts.push({ ms, pct, r });
    if (reset == null || r > reset) reset = r;
  }
  if (!pts.length) return snapshots ? { note: "reset time unknown in your last snapshot — can't estimate" } : null;
  if (reset <= now) return { note: `the 5-hour window reset ${formatDuration(now - reset)} ago — no snapshot since` };
  const inWindow = pts.filter(p => Math.abs(p.r - reset) <= SAME_WINDOW_MS);
  const pct = Math.max(...inWindow.map(p => p.pct));
  const lastMs = Math.max(...inWindow.map(p => p.ms));
  const untilReset = formatDuration(reset - now);
  if (pct >= 100) return { note: `limit reached — resets in ${untilReset}` };
  const elapsed = lastMs - (reset - BLOCK_MS);
  if (elapsed < MIN_SPAN_MS) return { note: 'too early in this window to estimate' };
  const perMs = pct / elapsed;
  if (perMs <= 0) return { note: `no measurable use in this window — resets in ${untilReset}` };
  const hitAt = lastMs + (100 - pct) / perMs;
  if (hitAt >= reset) return { note: `won't reach the limit before it resets in ${untilReset}` };
  return { msToLimit: Math.max(0, hitAt - now), ratePerHr: perMs * HOUR_MS };
}

function hhmmUtc(ms) { return new Date(ms).toISOString().slice(11, 16); }

// One frame from an already-read turn list. `now` injectable for tests.
export function renderFrame(turns, now = Date.now()) {
  const today = localDate(new Date(now)); // local calendar day (QA-BUG-10); the clock below stays labeled UTC
  const todaySum = summarizeTurns(turns.filter(t => localDateOf(t.ts) === today));
  const bStart = Math.floor(now / BLOCK_MS) * BLOCK_MS;
  const blockSum = summarizeTurns(turns.filter(t => { const ms = Date.parse(t.ts); return ms >= bStart && ms < bStart + BLOCK_MS; }));
  const rl = latestRateLimit(turns);
  const ttl = timeToLimit(turns, now);
  // Costs carry the same badge as `today` (QA-0928-55).
  const cost = (s) => (basisTag(s).priced ? moneyWithBasis(s.cost, s) : '—  (not priced)');

  const lines = [];
  lines.push(`  wtclaude watch · ${new Date(now).toISOString().slice(11, 19)} UTC`);
  lines.push('  ' + '─'.repeat(46));
  lines.push(`  Today:            ${cost(todaySum)}`);
  lines.push(`  UTC 5h block:     ${cost(blockSum)} · ${hhmmUtc(bStart)}–${hhmmUtc(bStart + BLOCK_MS)} UTC`);
  if (rl) {
    lines.push('');
    lines.push(gauge('5-hour limit ', rl.rate_limit_5h_pct, rl.rate_limit_5h_resets_at, rl.ts, now));
    lines.push(gauge('7-day limit  ', rl.rate_limit_7d_pct, rl.rate_limit_7d_resets_at, rl.ts, now));
    lines.push(`  ${asOf(rl.ts, now)}`);
  } else {
    lines.push('');
    lines.push('  (no rate-limit data yet — older CC, or OAuth fallback applies)');
  }
  lines.push('');
  if (!ttl) {
    lines.push('  Time to 5h limit: needs a rate-limit snapshot to estimate');
  } else if (ttl.note) {
    lines.push(`  Time to 5h limit: ${ttl.note}`);
  } else {
    lines.push(`  Time to 5h limit: ~${formatDuration(ttl.msToLimit)} at this window's average rate (est. · non-predictive)`);
  }
  // QA-0928-62 (relabel): the block is a fixed UTC bucket, as in `blocks`.
  lines.push('  UTC 5h block = a fixed 5-hour UTC bucket (as in `blocks`), not your limit window.');
  lines.push('  ' + '─'.repeat(46));
  return lines.join('\n');
}

export function registerWatch(program) {
  program
    .command('watch')
    .description('Live monitor: cost, UTC 5h block, plan limit + basic non-predictive time-to-limit')
    .option('--once', 'Render a single frame and exit (for scripting/CI)')
    .option('--interval <s>', 'Refresh interval in seconds (1 or more)', '5')
    .action((opts) => {
      const o = opts || {};
      // 1 second or more (QA-0928-159): 0 and 0.5 used to become 5 s silently.
      const secs = Number(o.interval);
      if (!Number.isFinite(secs) || secs < 1) {
        console.error(`\n  --interval must be a number of seconds, 1 or more (got "${o.interval}")\n`);
        process.exitCode = 1;
        return;
      }
      const cache = new Map();
      if (o.once) { console.log(renderFrame(allTurnsSorted(cache))); return; }
      const draw = () => { process.stdout.write('\x1b[2J\x1b[H'); console.log(renderFrame(allTurnsSorted(cache))); console.log('\n  Ctrl-C to exit.'); };
      draw();
      const timer = setInterval(draw, secs * 1000);
      process.on('SIGINT', () => { clearInterval(timer); process.stdout.write('\n'); process.exit(0); });
    });
}
