import { formatCost, formatTokens } from './cost.js';

export function formatUsageSummary(label, summary) {
  const lines = [];
  lines.push(`\n  ${label}`);
  lines.push(`  ${'='.repeat(label.length)}`);
  lines.push(`  Cost:       ${formatCost(summary.cost)}`);
  lines.push(`  Input:      ${formatTokens(summary.input_tokens)} tokens`);
  lines.push(`  Output:     ${formatTokens(summary.output_tokens)} tokens`);
  lines.push(`  Cache read: ${formatTokens(summary.cache_read_tokens)} tokens`);
  lines.push(`  Cache write:${formatTokens(summary.cache_write_tokens)} tokens`);
  lines.push(`  Sessions:   ${summary.session_count}`);
  lines.push(`  Turns:      ${summary.turn_count}`);

  if (summary.models && Object.keys(summary.models).length > 0) {
    lines.push(`  Models:     ${Object.entries(summary.models).map(([m, c]) => `${m} (${c})`).join(', ')}`);
  }

  lines.push('');
  return lines.join('\n');
}

export function formatComparisonTable(accurate, jsonl) {
  const lines = [];
  lines.push('\n  Accurate (WTClaude) vs JSONL (what ccusage reads)');
  lines.push('  ================================================');
  lines.push('');
  lines.push(`  ${'Metric'.padEnd(20)} ${'Accurate'.padEnd(15)} ${'JSONL'.padEnd(15)} Gap`);
  lines.push(`  ${'------'.padEnd(20)} ${'--------'.padEnd(15)} ${'-----'.padEnd(15)} ---`);

  const rows = [
    ['Input tokens', accurate.input_tokens, jsonl.input_tokens],
    ['Output tokens', accurate.output_tokens, jsonl.output_tokens],
    ['Cache read', accurate.cache_read_tokens, jsonl.cache_read_tokens],
    ['Cache write', accurate.cache_write_tokens, jsonl.cache_write_tokens],
    ['Est. cost', accurate.cost, jsonl.cost],
  ];

  for (const [label, acc, jsl] of rows) {
    const gap = jsl > 0 ? `${(acc / jsl).toFixed(1)}x` : 'N/A';
    const accStr = typeof acc === 'number' && label.includes('cost') ? formatCost(acc) : formatTokens(acc);
    const jslStr = typeof jsl === 'number' && label.includes('cost') ? formatCost(jsl) : formatTokens(jsl);
    lines.push(`  ${label.padEnd(20)} ${accStr.padEnd(15)} ${jslStr.padEnd(15)} ${gap}`);
  }

  lines.push('');
  return lines.join('\n');
}
