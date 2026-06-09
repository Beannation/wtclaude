import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getSessionsForDateRange, summarizeSessions } from '../utils/sessions.js';
import { readJsonlSessions, summarizeJsonl } from '../compare/jsonl-reader.js';
import { formatComparisonTable } from '../utils/format.js';
import { computeTurnCost } from '../utils/cost.js';
import { getModelPricing, getLatestPricing } from '../utils/pricing.js';
import { generateComparisonCard, generateComparisonHtml } from '../compare/card-generator.js';
import { localDate } from '../utils/time.js';
import { COMPARISONS_DIR } from '../utils/paths.js';

export function registerCompare(program) {
  program
    .command('compare')
    .description('Compare accurate data vs JSONL (what ccusage reads)')
    .option('--days <n>', 'Number of days to compare', '1')
    .option('--share', 'Save a shareable comparison card to ~/Desktop')
    .action((opts) => {
      const days = parseInt(opts.days, 10);
      const end = new Date();
      const start = new Date(end);
      start.setDate(start.getDate() - (days - 1));

      const startStr = localDate(start); // local calendar range (QA-BUG-10)
      const endStr = localDate(end);

      const accurateSessions = getSessionsForDateRange(startStr, endStr);
      const jsonlSessions = readJsonlSessions({ start: startStr, end: endStr });

      if (accurateSessions.length === 0) {
        console.log('\n  No accurate data yet. Use Claude Code with wtclaude-collector configured.');
        console.log('  Run: wtclaude setup\n');
        return;
      }

      const accurate = summarizeSessions(accurateSessions);

      const jsonl = summarizeJsonl(jsonlSessions);
      jsonl.cost = estimateJsonlCost(jsonl);

      console.log(formatComparisonTable(accurate, jsonl));

      if (opts.share) {
        // QA-BUG-R2-01: never let a blocked ~/Desktop write (macOS TCC, headless/CI,
        // read-only target) throw a raw stack trace. Try the Desktop, then fall back
        // to ~/.wtclaude/comparisons/. The table above always prints regardless.
        const saved = saveShareCard(
          generateComparisonCard(accurate, jsonl),
          generateComparisonHtml(accurate, jsonl),
        );
        if (saved.ok) {
          console.log(`  Comparison card saved to:`);
          console.log(`    ${saved.svgPath}`);
          console.log(`    ${saved.htmlPath}`);
          if (saved.fallback) {
            console.log(`  (Couldn't write to your Desktop — ${saved.reason}. Saved to ~/.wtclaude/comparisons/ instead.)`);
          }
          console.log(`  Open the HTML file in a browser, or share the SVG directly.\n`);
        } else {
          console.log(`  Couldn't save the comparison card — ${saved.reason}.`);
          console.log(`  The comparison is shown above; re-run --share once a writable location is available.\n`);
        }
      }

      if (jsonl.input_tokens > 0) {
        const gap = accurate.input_tokens / jsonl.input_tokens;
        if (gap > 5) {
          console.log(`  Your JSONL logs undercount input tokens by ${gap.toFixed(0)}x.`);
          console.log('  Every tool that reads JSONL (ccusage, tokscale, etc.) shows you these wrong numbers.');
          console.log('  WTClaude reads the accurate statusline data instead.\n');
        }
      }
    });
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
      reason = friendlyFsReason(err);
      // try the next target
    }
  }
  return { ok: false, reason };
}

function friendlyFsReason(err) {
  switch (err && err.code) {
    case 'EPERM':
    case 'EACCES':
      return 'permission denied (grant your terminal Desktop access in System Settings, or the folder is protected)';
    case 'EROFS':
      return 'the location is read-only';
    case 'ENOSPC':
      return 'no space left on the device';
    default:
      return (err && (err.code || err.message)) || 'write failed';
  }
}

function estimateJsonlCost(jsonl) {
  const pricing = getModelPricing('sonnet-4-6');
  const cache = getLatestPricing().cache;
  return (jsonl.input_tokens / 1_000_000) * pricing.input +
         (jsonl.output_tokens / 1_000_000) * pricing.output +
         (jsonl.cache_read_tokens / 1_000_000) * pricing.input * cache.read_multiplier +
         (jsonl.cache_write_tokens / 1_000_000) * pricing.input * cache.write_multiplier;
}
