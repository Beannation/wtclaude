import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getSessionsForDateRange, summarizeSessions } from '../utils/sessions.js';
import { readJsonlSessions, summarizeJsonl } from '../compare/jsonl-reader.js';
import { formatComparisonTable } from '../utils/format.js';
import { computeTurnCost } from '../utils/cost.js';
import { getModelPricing, getLatestPricing } from '../utils/pricing.js';
import { generateComparisonCard, generateComparisonHtml } from '../compare/card-generator.js';
import { localDate } from '../utils/time.js';

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
        const svgPath = join(homedir(), 'Desktop', 'wtclaude-comparison.svg');
        const htmlPath = join(homedir(), 'Desktop', 'wtclaude-comparison.html');
        writeFileSync(svgPath, generateComparisonCard(accurate, jsonl));
        writeFileSync(htmlPath, generateComparisonHtml(accurate, jsonl));
        console.log(`  Comparison card saved to:`);
        console.log(`    ${svgPath}`);
        console.log(`    ${htmlPath}`);
        console.log(`  Open the HTML file in a browser, or share the SVG directly.\n`);
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

function estimateJsonlCost(jsonl) {
  const pricing = getModelPricing('sonnet-4-6');
  const cache = getLatestPricing().cache;
  return (jsonl.input_tokens / 1_000_000) * pricing.input +
         (jsonl.output_tokens / 1_000_000) * pricing.output +
         (jsonl.cache_read_tokens / 1_000_000) * pricing.input * cache.read_multiplier +
         (jsonl.cache_write_tokens / 1_000_000) * pricing.input * cache.write_multiplier;
}
