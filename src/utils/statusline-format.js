// Shared by the collector (hot path — keep this module import-free) and the
// `wtclaude statusline` preview, so the two can never render different figures.

// "context 150K": tokens currently in the context window. Empty before the first
// API response, when Claude Code reports 0.
export function formatContext(tokens) {
  if (!(tokens > 0)) return '';
  if (tokens >= 1_000_000) return `context ${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `context ${(tokens / 1_000).toFixed(0)}K`;
  return `context ${tokens}`;
}
