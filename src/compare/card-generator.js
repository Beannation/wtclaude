import { formatCost, formatTokens } from '../utils/cost.js';

// Billing-grade ÷ session-log, at the comparison table's one decimal; N/A when
// the session-log side is zero.
function gap(acc, jsl) {
  return jsl > 0 ? `${(acc / jsl).toFixed(1)}x` : 'N/A';
}

// QA-0928-19 (2026-09-28): the figures are WINDOW totals, so the card says which
// window ("Today" / "Over N days"). It used to append "/day" to every window
// total, hard-code the cache-read gap as "~1x", round the token gaps to whole
// numbers (0.3x read "0x") and print "???x" on a zero side.
export function generateComparisonCard(accurate, jsonl, { days = 1 } = {}) {
  const inputGap = gap(accurate.input_tokens, jsonl.input_tokens);
  const outputGap = gap(accurate.output_tokens, jsonl.output_tokens);
  const cacheGap = gap(accurate.cache_read_tokens, jsonl.cache_read_tokens);
  const costGap = gap(accurate.cost, jsonl.cost);
  const window = days === 1 ? 'Today' : `Over ${days} days`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="440" viewBox="0 0 600 440">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f0f1a"/>
      <stop offset="100%" stop-color="#1a1a2e"/>
    </linearGradient>
  </defs>

  <rect width="600" height="440" rx="16" fill="url(#bg)"/>

  <!-- Header -->
  <text x="300" y="48" text-anchor="middle" font-family="system-ui, sans-serif" font-size="20" font-weight="700" fill="#fafafa">WTClaude</text>
  <text x="300" y="74" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#888">Billing-grade cost for Claude Code</text>

  <!-- Column headers -->
  <text x="240" y="110" text-anchor="end" font-family="system-ui, sans-serif" font-size="10" font-weight="600" fill="#4ade80">Billing-grade</text>
  <text x="380" y="110" text-anchor="end" font-family="system-ui, sans-serif" font-size="10" font-weight="600" fill="#888">Session-log estimate</text>
  <text x="520" y="110" text-anchor="end" font-family="system-ui, sans-serif" font-size="12" font-weight="700" fill="#ff6b6b">Gap</text>

  <!-- Divider -->
  <line x1="40" y1="120" x2="560" y2="120" stroke="#333" stroke-width="1"/>

  <!-- Input tokens row -->
  <text x="40" y="155" font-family="system-ui, sans-serif" font-size="13" fill="#ccc">Input tokens</text>
  <text x="240" y="155" text-anchor="end" font-family="monospace" font-size="14" font-weight="600" fill="#4ade80">${formatTokens(accurate.input_tokens)}</text>
  <text x="380" y="155" text-anchor="end" font-family="monospace" font-size="14" fill="#666">${formatTokens(jsonl.input_tokens)}</text>
  <text x="520" y="155" text-anchor="end" font-family="monospace" font-size="16" font-weight="700" fill="#ff6b6b">${inputGap}</text>

  <!-- Output tokens row -->
  <text x="40" y="195" font-family="system-ui, sans-serif" font-size="13" fill="#ccc">Output tokens</text>
  <text x="240" y="195" text-anchor="end" font-family="monospace" font-size="14" font-weight="600" fill="#4ade80">${formatTokens(accurate.output_tokens)}</text>
  <text x="380" y="195" text-anchor="end" font-family="monospace" font-size="14" fill="#666">${formatTokens(jsonl.output_tokens)}</text>
  <text x="520" y="195" text-anchor="end" font-family="monospace" font-size="16" font-weight="700" fill="#ff6b6b">${outputGap}</text>

  <!-- Cache read row -->
  <text x="40" y="235" font-family="system-ui, sans-serif" font-size="13" fill="#ccc">Cache read</text>
  <text x="240" y="235" text-anchor="end" font-family="monospace" font-size="14" font-weight="600" fill="#4ade80">${formatTokens(accurate.cache_read_tokens)}</text>
  <text x="380" y="235" text-anchor="end" font-family="monospace" font-size="14" fill="#666">${formatTokens(jsonl.cache_read_tokens)}</text>
  <text x="520" y="235" text-anchor="end" font-family="monospace" font-size="16" font-weight="700" fill="#ff6b6b">${cacheGap}</text>

  <!-- Divider -->
  <line x1="40" y1="260" x2="560" y2="260" stroke="#333" stroke-width="1"/>

  <!-- Cost row -->
  <text x="40" y="295" font-family="system-ui, sans-serif" font-size="15" font-weight="600" fill="#fff">Cost</text>
  <text x="240" y="295" text-anchor="end" font-family="monospace" font-size="16" font-weight="700" fill="#4ade80">${formatCost(accurate.cost)}</text>
  <text x="380" y="295" text-anchor="end" font-family="monospace" font-size="16" font-weight="600" fill="#666">${formatCost(jsonl.cost)}</text>
  <text x="520" y="295" text-anchor="end" font-family="monospace" font-size="18" font-weight="700" fill="#ff6b6b">${costGap}</text>

  <!-- Big callout -->
  <rect x="40" y="320" width="520" height="50" rx="8" fill="#1e1e3a"/>
  <text x="300" y="351" text-anchor="middle" font-family="system-ui, sans-serif" font-size="14" font-weight="600" fill="#ff6b6b">${window}: billing-grade ${formatCost(accurate.cost)} · session-log estimate ${formatCost(jsonl.cost)}</text>

  <!-- Footer -->
  <text x="300" y="420" text-anchor="middle" font-family="system-ui, sans-serif" font-size="11" fill="#888">Read from the statusline — the source behind your bill.</text>
</svg>`;
}

export function generateComparisonHtml(accurate, jsonl, opts) {
  const svg = generateComparisonCard(accurate, jsonl, opts);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>WTClaude Comparison</title>
<style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#000;}</style>
</head>
<body>${svg}</body>
</html>`;
}
