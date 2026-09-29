import { writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { getSessionsForDateRange, summarizeSessions } from '../utils/sessions.js';
import {
  readJsonlUsage, summarizeUsageRecords, transcriptsAvailable, transcriptRootForDisplay, displayPath,
} from '../compare/jsonl-reader.js';
import { formatComparisonTable, costBasisBadge, gapRatio } from '../utils/format.js';
import { formatCost, priceTurn, hasTokens } from '../utils/cost.js';
import { generateComparisonCard, generateComparisonHtml } from '../compare/card-generator.js';
import { localDate } from '../utils/time.js';
import { setupComplete, coldStartMessage, configProblem } from '../utils/firstrun.js';
import { COMPARISONS_DIR } from '../utils/paths.js';
import { parseDaysOption, MAX_DAYS } from '../utils/window.js';

export function registerCompare(program) {
  program
    .command('compare')
    .description('Compare your billing-grade cost vs a session-log estimate')
    .option('--days <n>', `Number of days to compare (1-${MAX_DAYS})`, parseDaysOption, 1)
    .option('--share', 'Save a shareable comparison card to ~/Desktop')
    .action((opts) => {
      const days = opts.days;
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - (days - 1));

      const startStr = localDate(start); // local calendar range (QA-BUG-10)
      const endStr = localDate(end);

      const accurateSessions = getSessionsForDateRange(startStr, endStr);

      if (accurateSessions.length === 0) {
        // BUGFIX (PM-BUILD-bugfix-001): `compare` defaults to --days 1, i.e. the
        // *today* window. A set-up user with data on prior days but none today
        // would otherwise be told "Run: wtclaude setup" — wrong and alarming, and
        // it reads like the product is broken. Only tell genuinely-unconfigured
        // users to run setup; a configured-but-empty-window user gets the same
        // honest "you're set up and capturing" cold-start copy that
        // today/week/month already share (no fabricated numbers, no new copy).
        // QA-0928-07: an unparsable config.json is named by the cold-start
        // copy, never answered with "run setup".
        if (!setupComplete() && !configProblem()) {
          console.log('\n  No accurate data yet. Use Claude Code with wtclaude-collector configured.');
          console.log('  Run: wtclaude setup\n');
        } else {
          console.log(coldStartMessage(`${startStr} to ${endStr}`));
        }
        return;
      }

      // QA-0928-69: no transcript directory is not "zero session-log usage". It
      // rendered as a $0 estimate — the most favourable possible reading for us.
      // Say what is missing, and save no card, in both empty cases.
      if (!transcriptsAvailable()) {
        console.log(`\n  No Claude Code transcripts found at ${displayPath(transcriptRootForDisplay())} — nothing to compare against.`);
        if (opts.share) console.log('  No comparison card was saved.');
        console.log('');
        return;
      }

      // Streamed, one compact final record per response (QA-0928-15/-16).
      const scan = readJsonlUsage({ start: startStr, end: endStr });
      if (scan.records.length === 0) {
        console.log(`\n  No Claude Code transcript has a response from ${startStr} to ${endStr} (local dates) — nothing to compare against.`);
        if (opts.share) console.log('  No comparison card was saved.');
        console.log('');
        return;
      }

      const match = matchSessions(accurateSessions, scan.records);
      if (match.records.length === 0) {
        console.log(`\n  None of the transcript sessions from ${startStr} to ${endStr} was recorded by the collector —`);
        console.log('  nothing like for like to compare.');
        for (const l of leftOutLines(match)) console.log(l);
        if (opts.share) console.log('  No comparison card was saved.');
        console.log('');
        return;
      }

      const accurate = summarizeSessions(match.sessions);
      const jsonl = summarizeUsageRecords(match.records);
      const priced = priceRecords(match.records);
      jsonl.cost = priced.usd;

      console.log(formatComparisonTable(accurate, jsonl));
      const n = match.sessions.length;
      console.log(`  Both columns cover the same ${n} session${n === 1 ? '' : 's'}, ${startStr} to ${endStr} (local dates).`);
      for (const l of leftOutLines(match)) console.log(l);
      console.log('  The session-log estimate is priced at the model its log records, at list rates.');
      for (const [model, count] of priced.unpriced) {
        console.log(`  Not priced — ${count} response${count === 1 ? '' : 's'} on ${model}: not in this rate sheet, so left out of the estimate.`);
      }
      console.log('');

      if (opts.share) {
        // QA-BUG-R2-01: never let a blocked ~/Desktop write (macOS TCC, headless/CI,
        // read-only target) throw a raw stack trace. Try the Desktop, then fall back
        // to ~/.wtclaude/comparisons/. The table above always prints regardless.
        const saved = saveShareCard(
          generateComparisonCard(accurate, jsonl, { days }),
          generateComparisonHtml(accurate, jsonl, { days }),
        );
        if (saved.ok) {
          console.log(`  Comparison card saved to:`);
          console.log(`    ${saved.svgPath}`);
          console.log(`    ${saved.htmlPath}`);
          if (saved.fallback) {
            console.log(`  (Couldn't write to your Desktop — ${saved.reason}. Saved to ${displayPath(COMPARISONS_DIR)} instead.)`);
          }
          console.log(`  Open the HTML file in a browser, or share the SVG directly.\n`);
        } else {
          console.log(`  Couldn't save the comparison card — ${saved.reason}.`);
          console.log(`  The comparison is shown above; re-run --share once a writable location is available.\n`);
        }
      }

      // QA-0928-18: this printed "undercounts input tokens by 313x" directly
      // under a session-log cost 2x HIGHER than billing-grade — it was gated on
      // input tokens alone. The headline (canon, wording unchanged) now prints
      // only when the session-log COST is actually lower, and only when every
      // log-side response was priced (a response left out unpriced lowers that
      // side by construction), and only when every billing-side turn carries the
      // statusline's cost anchor — the headline says the billing figure "is read
      // from the statusline", which a partly-estimated column would make only
      // partly true. Otherwise the two numbers are stated plainly.
      const logLower = jsonl.cost < accurate.cost && priced.unpriced.size === 0;
      const fullyAnchored = accurate.anchored_turns > 0 && accurate.estimated_turns === 0;
      const gap = jsonl.input_tokens > 0 ? accurate.input_tokens / jsonl.input_tokens : 0;
      if (logLower && fullyAnchored && gap > 5) {
        console.log(`  Your session-log estimate undercounts input tokens by ${gap.toFixed(0)}x.`);
        console.log('  Session-log trackers reconstruct cost from the JSONL, which can drift from your bill.');
        console.log('  The billing-grade figure is read from the statusline — the source behind your bill.');
        console.log('  Your gap is whatever yours is.\n');
      } else {
        console.log(`  ${neutralComparison(accurate, jsonl)}\n`);
      }
    });
}

// QA-0928-17: like for like. The statusline runs only in terminal Claude Code,
// so transcripts from the desktop app, the Agent SDK, or a terminal session the
// collector did not record have no billing-grade counterpart. Counting them
// compared different work: 7 days on the QA machine, 33 of 49 transcript
// sessions and 83% of log-side responses. Both columns now cover the sessions
// present on BOTH sides, and what each side had alone is counted and said.
//
// Subagent (sidechain) records carry their parent's sessionId, so they stay in.
// That is deliberate: the statusline's session cost includes subagent spend.
// Checked on real sessions (2026-09-28): with subagent records counted the two
// sides agree within ~15%; without them the log side falls to ~68%.
export function matchSessions(accurateSessions, records) {
  const billIds = new Set(accurateSessions.map(s => s.session_id));
  const matched = new Set();
  const kept = [];
  const logOnly = new Map();   // session id -> entrypoint
  for (const r of records) {
    if (r.session_id && billIds.has(r.session_id)) {
      kept.push(r);
      matched.add(r.session_id);
    } else {
      const id = r.session_id || '';
      if (!logOnly.get(id)) logOnly.set(id, r.entrypoint || null);
    }
  }
  const bySource = { desktop: 0, sdk: 0, other: 0 };
  for (const ep of logOnly.values()) {
    if (ep === 'claude-desktop') bySource.desktop++;
    else if (typeof ep === 'string' && ep.startsWith('sdk')) bySource.sdk++;
    else bySource.other++;
  }
  const sessions = accurateSessions.filter(s => matched.has(s.session_id));
  return {
    sessions,
    records: kept,
    log_only: bySource,
    billing_only: accurateSessions.length - sessions.length,
  };
}

function plural(n, one, many = `${one}s`) { return `${n} ${n === 1 ? one : many}`; }

function leftOutLines(match) {
  const lines = [];
  const { desktop, sdk, other } = match.log_only;
  const away = [];
  if (desktop) away.push(plural(desktop, 'desktop-app session'));
  if (sdk) away.push(plural(sdk, 'Agent SDK session'));
  if (away.length) lines.push(`  Left out — ${away.join(' and ')}: the statusline doesn't run there.`);
  if (other) lines.push(`  Left out — ${plural(other, "terminal session the collector didn't record", "terminal sessions the collector didn't record")}.`);
  if (match.billing_only) lines.push(`  Left out — ${plural(match.billing_only, 'collector session with no transcript', 'collector sessions with no transcript')} in this window.`);
  return lines;
}

// QA-0928-68: each response is priced at the model its log line records (fast
// rates when the log says the response ran in fast mode), as log-based trackers
// do. This was pinned to Sonnet 4.6 for every token whatever the logs said —
// neither Claude Code's default nor what ran — so the pin moved the gap in
// either direction, invisibly. A model this rate sheet cannot price (unknown,
// partner-platform, family-fallback guess) is left out and named, never priced
// at a stand-in rate. `<synthetic>` placeholders are not API calls.
function priceRecords(records, today) {
  let usd = 0;
  const unpriced = new Map();   // model -> responses left out
  for (const r of records) {
    if (r.model === '<synthetic>') continue;
    const p = priceTurn(r.model, r.speed === 'fast' ? 'fast' : 'standard', r, today);
    if (p.priceable) usd += p.usd;
    else if (hasTokens(r)) {
      const m = r.model || '(no model recorded)';
      unpriced.set(m, (unpriced.get(m) || 0) + 1);
    }
  }
  return { usd, unpriced };
}

// Both figures side by side, no verdict. The ratio reads the same way as the
// table's "Billing ÷ log" column, in the same format (RC 2026-09-28).
function neutralComparison(accurate, jsonl) {
  const basis = costBasisBadge(accurate).label || 'billing-grade';
  let s = `For the same sessions: statusline ${formatCost(accurate.cost)} (${basis}), session-log estimate ${formatCost(jsonl.cost)}`;
  if (accurate.cost > 0 && jsonl.cost > 0) s += ` — the statusline figure is ${gapRatio(accurate.cost, jsonl.cost)} the estimate`;
  return s + '.';
}

// Write the share card to the first writable target: ~/Desktop, then
// ~/.wtclaude/comparisons/ as a guaranteed-writable fallback. Never throws —
// returns { ok, svgPath, htmlPath, fallback, reason } so the caller can degrade
// gracefully (QA-BUG-R2-01 / KTD-17). A blocked Desktop is the common case on
// macOS (TCC denies a non-Apple `node` binary) and in headless/CI runs.
function saveShareCard(svg, html) {
  const targets = [
    { dir: join(homedir(), 'Desktop'), fallback: false },
    { dir: COMPARISONS_DIR, fallback: true },
  ];
  let reason = 'write failed';
  for (const t of targets) {
    try {
      mkdirSync(t.dir, { recursive: true });
      const svgPath = join(t.dir, 'wtclaude-comparison.svg');
      const htmlPath = join(t.dir, 'wtclaude-comparison.html');
      writeFileSync(svgPath, svg);
      writeFileSync(htmlPath, html);
      return { ok: true, svgPath, htmlPath, fallback: t.fallback, reason };
    } catch (err) {
      reason = friendlyFsReason(err, t.dir);
      // try the next target
    }
  }
  return { ok: false, reason };
}

function friendlyFsReason(err, dir) {
  switch (err && err.code) {
    case 'EPERM':
    case 'EACCES':
      return 'permission denied (grant your terminal Desktop access in System Settings, or the folder is protected)';
    case 'EROFS':
      return 'the location is read-only';
    case 'ENOSPC':
      return 'no space left on the device';
    // QA-0928-165: printed the raw code ("EEXIST").
    case 'EEXIST':
    case 'ENOTDIR':
      return `a file named ${basename(dir)} is in the way`;
    default:
      return (err && (err.code || err.message)) || 'write failed';
  }
}
