# WTClaude

The first accurate Claude Code usage tracker.

Every existing tracker (ccusage, tokscale, etc.) reads Claude Code's JSONL logs — which undercount input tokens by **100x** and output tokens by **10-17x**. WTClaude reads from the accurate statusline data path instead, matching Anthropic's billing dashboard to the exact token.

## The Problem

Claude Code writes JSONL session logs during streaming, before the API response finalizes. The `input_tokens` field is recorded as 0 or 1 in 75% of entries — and nobody updates it afterward. Output tokens exclude thinking/reasoning tokens (60-70% of Opus output).

**Real numbers** (from [independent research](https://gille.ai/en/blog/claude-code-jsonl-logs-undercount-tokens/)):

| Metric | JSONL Says | Actual | Gap |
|--------|-----------|--------|-----|
| Input tokens | 41,444 | 7,199,162 | **174x** |
| Output tokens | 183,829 | 3,208,365 | **17x** |
| Daily total | 225K tokens | 10.4M tokens | **46x** |

ccusage told users they spent $3.42/day. Reality: $18.70/day.

## The Fix

WTClaude uses Claude Code's statusline command — a JSON payload piped on every status update containing **cumulative totals from finalized API responses**. This is the same data the `/cost` command uses. It matches billing exactly.

## Install

```bash
npx wtclaude setup
```

This does three things:
1. Creates the `~/.wtclaude/` data directory
2. Adds the statusline collector to your Claude Code settings
3. You're done — start a new Claude Code session

## Usage

After using Claude Code with the collector active:

```bash
# Today's usage (tokens, cost, model breakdown)
wtclaude today

# Last 7 or 30 days
wtclaude week
wtclaude month

# THE moment: see how wrong your old tracker was
wtclaude compare

# What would today cost on a different plan?
wtclaude whatif --plan

# What if you'd used a different model?
wtclaude whatif --model haiku

# End-of-day summary with costliest turn and tips
wtclaude debrief
```

## How It Works

1. Claude Code pipes a JSON payload to `wtclaude-collector` on every status update
2. The collector computes per-turn deltas from the cumulative totals
3. Per-turn records are appended to `~/.wtclaude/sessions/{session_id}.ndjson`
4. CLI commands read these local files to show usage summaries

No cloud, no accounts, no data leaving your machine. Everything runs locally.

## Why Not Just Fix JSONL?

It's an upstream bug in Claude Code (filed Feb 2026, still unfixed). The JSONL write path logs during streaming for crash-resistance — but never updates with the real numbers after the response completes. Cache metrics happen to be accurate because they're in the initial response header.

Anthropic's own tools (`/cost`, `/usage`) use the accurate internal state, not JSONL. WTClaude taps into that same accurate source.

## Data Storage

```
~/.wtclaude/
├── config.json                    # Preferences
├── sessions/{session_id}.ndjson   # Per-turn records
├── daily/{YYYY-MM-DD}.json        # Daily aggregates
└── comparisons/{date}.json        # Cached JSONL comparisons
```

## License

MIT
