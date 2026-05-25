# CLAUDE.md — WTClaude Project Context

## Project Overview

WTClaude is the first accurate Claude Code usage tracker. Every existing tracker (ccusage, tokscale, etc.) reads JSONL logs that undercount input tokens by 100x and output tokens by 10-17x. WTClaude reads from the accurate statusline data path instead.

This is Phase 0 of a larger product: usage estimator + Guardian real-time monitoring + team/enterprise optimization. Phase 0's job is to prove the accuracy gap, capture users, and lay the data foundation.

## Critical Technical Context

### The JSONL Bug (why this product exists)

Claude Code writes JSONL session logs to `~/.claude/projects/*/`. These logs record `input_tokens` as 0 or 1 in 75% of entries because they're written during streaming before the API response finalizes. Nobody updates them afterward. Output tokens exclude thinking/reasoning tokens (60-70% of Opus output).

Result: ccusage (43K weekly npm downloads) shows users $3.42/day when reality is $18.70/day. A 5.5x gap. Input tokens alone are undercounted 100-174x.

### The Accurate Data Source (what we use instead)

Claude Code's statusline command pipes a JSON payload to a configured script on every status update. This payload contains cumulative totals from finalized API responses. It matches Anthropic's billing dashboard to the exact token.

The payload includes: `session_id`, `total_input_tokens`, `total_output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `used_percentage`, `model`, and more.

**CRITICAL:** These are CUMULATIVE totals. To get per-turn data, compute deltas by tracking previous cumulative values and subtracting. Always store both cumulative (for verification) and delta (for analysis).

### Configuration

Users add a statusline command to their Claude Code `settings.json`:
```json
{
  "statusLine": {
    "command": "wtclaude-collector"
  }
}
```

## Architecture Constraints

- **Never read JSONL for actual usage data.** Only read JSONL for the "vs JSONL" comparison view. The entire product premise is that JSONL is wrong.
- **Store per-turn data, not just summaries.** Future features (Guardian, session autopsy, anomaly detection) need per-turn granularity. Do not aggregate away the detail.
- **Anonymous by default.** No email, no OAuth, no sign-up for v1. Generate a local UUID. Email is optional for monthly reports.
- **Opt-in data sharing only.** Users explicitly enable sharing. Show a preview of exactly what's shared before opt-in. Never share prompts, code, file names, or project paths.
- **Pricing in versioned config.** Never hardcode Anthropic pricing. Use a JSON config with a version date. Add new versions for pricing changes — don't overwrite old ones.
- **Collector must be fast.** <50ms per invocation. It runs on every Claude Code status update.

## Tech Stack

- **Runtime:** Node.js (single runtime for CLI, collector, and npm package)
- **CLI framework:** Commander.js
- **Backend:** Supabase (Postgres + Edge Functions + Auth)
- **Dashboard:** React + Vite + TailwindCSS
- **Hosting:** Vercel Pro ($20/mo — Hobby prohibits commercial use)
- **Charts:** Recharts or Chart.js
- **License:** MIT

## File Structure

```
wtclaude/
├── bin/wtclaude.js           # CLI entry point
├── src/
│   ├── collector/index.js    # Statusline script
│   ├── cli/                  # CLI commands (today, week, compare, whatif, etc.)
│   ├── compare/              # JSONL reader + comparison card generator
│   ├── sync/                 # Cloud sync to Supabase
│   ├── badges/               # Badge computation
│   ├── utils/                # Cost calc, pricing, paths, formatting
│   └── config/               # Versioned pricing configs
├── web/                      # React dashboard (Vite)
├── supabase/                 # Schema migrations + edge functions
└── landing/                  # Static landing page
```

## Local Data Storage

```
~/.wtclaude/
├── config.json               # Preferences, sync settings, opt-in flags
├── sessions/{session_id}.ndjson  # Per-turn records
├── daily/{YYYY-MM-DD}.json   # Daily aggregates
└── comparisons/{date}.json   # Cached JSONL comparisons
```

## Anthropic Pricing (May 2026)

- Haiku 4.5: $1 / $5 per MTok (input/output)
- Sonnet 4.6: $3 / $15 per MTok
- Opus 4.7: $5 / $25 per MTok (verify current)
- Cache read: 10% of input price
- Cache write: 25% of input price
- Plans: Pro $20/mo, Max 5x $100/mo, Max 20x $200/mo

## What Phase 0 Does NOT Include

Do not build these. Push back on scope creep.

- Estimation engine (Phase 1)
- Guardian real-time monitoring (Phase 1-2)
- Change detection/alerts (Phase 1)
- Multi-channel notifications (Phase 1-2)
- Session autopsy UI (Guardian — but per-turn data IS being collected)
- Payment/subscription (Phase 1)
- Team/enterprise features (Phase 2-3)
- Multi-provider support (Phase 2+)

## Naming Conventions

- Package: `wtclaude`
- CLI command: `wtclaude`
- Collector: `wtclaude-collector`
- Dashboard URL: TBD (wtclaude.com or similar)
- GitHub repo: TBD

## Testing Priority

1. Collector accuracy — verify per-turn deltas match expected values
2. Comparison view — verify JSONL numbers match what ccusage shows
3. Cost calculations — verify against Anthropic pricing
4. Setup flow — `npx wtclaude setup` works on macOS and Linux
5. Sync reliability — data survives network interruptions

## Key Research Documents

The `research-context/` folder contains the full research backing every decision:
- `phase-0-build-plan.md` — detailed stage-by-stage build plan
- `jsonl-bug-opportunity-deep-dive.md` — the JSONL bug research
- `feasibility-report.md` — full technical feasibility assessment
- `approved-new-ideas.md` — all approved product features and pricing
- `market-research-report.md` — TAM/SAM/SOM, competitive landscape
- `feasibility-research-log.md` — running log of all research findings
- `claude-usage-estimator-handoff.md` — original project vision document
- `claude-usage-estimator-iteration-log.md` — iteration decisions
