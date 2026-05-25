# WTClaude Phase 0 — Stage-by-Stage Build Plan

**Version:** 1.0
**Date:** May 25, 2026
**Author:** Research & planning session (Cowork)
**For:** Claude Code vibe-coding session

---

## What You're Building

The first accurate Claude Code usage tracker. Every existing tracker (ccusage with 43K weekly npm downloads, tokscale, TokenTracker, etc.) reads from JSONL logs that undercount input tokens by 100x and output tokens by 10-17x. This tool reads from the accurate statusline data path instead.

This is Phase 0 of a larger product (usage estimator + Guardian real-time monitoring + team/enterprise optimization). Phase 0's job is to: prove the accuracy gap, capture users, collect usage data for the moat, and lay the data architecture foundation for everything that comes after.

**Product name:** WTClaude (working name)
**Package name:** `wtclaude` (npm)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  Claude Code                                         │
│  settings.json: { "statusLine": { "command": "..." }}│
│  Pipes accurate JSON on every status update          │
└──────────────────┬──────────────────────────────────┘
                   │ stdin (JSON)
                   ▼
┌─────────────────────────────────────────────────────┐
│  Statusline Script (wtclaude-collector)               │
│  - Receives JSON payload per status update           │
│  - Extracts per-turn deltas from cumulative totals   │
│  - Appends per-turn records to local NDJSON log      │
│  - Outputs status string back to Claude Code         │
└──────────────────┬──────────────────────────────────┘
                   │ local file (~/.wtclaude/sessions/)
                   ▼
┌─────────────────────────────────────────────────────┐
│  CLI (wtclaude)                                      │
│  - Reads local log files                             │
│  - Commands: today, week, month, project, compare,   │
│    whatif, debrief                                    │
│  - Generates shareable comparison cards              │
└──────────────────┬──────────────────────────────────┘
                   │ opt-in sync (HTTPS POST)
                   ▼
┌─────────────────────────────────────────────────────┐
│  Supabase Backend                                    │
│  - Tables: users, sessions, turns, daily_summaries,  │
│    badges, leaderboard_entries                        │
│  - Edge functions: sync, comparison card gen,         │
│    leaderboard, monthly report                       │
│  - Row Level Security for user isolation             │
└──────────────────┬──────────────────────────────────┘
                   │ API
                   ▼
┌─────────────────────────────────────────────────────┐
│  Web Dashboard (React + Vite + Tailwind)             │
│  - Hosted on Vercel                                  │
│  - Daily/weekly/monthly views                        │
│  - Session timeline (Strava-style)                   │
│  - "vs JSONL" comparison view                        │
│  - Leaderboard, badges, profile                      │
│  - Shareable comparison cards                        │
└─────────────────────────────────────────────────────┘
```

---

## Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| Statusline script | Node.js (single file) | Same runtime as npm package, no Python dependency |
| CLI | Node.js + Commander.js | npm ecosystem, one-command install via npx |
| Backend | Supabase (free tier → Pro) | Postgres + Edge Functions + Auth + Realtime, free to 500MB |
| Dashboard | React + Vite + TailwindCSS | Fast, modern, vibe-code friendly |
| Hosting | Vercel Pro ($20/mo) | Required for commercial use, excellent DX |
| Charts | Recharts or Chart.js | Lightweight, React-native |
| Comparison cards | HTML → Canvas → PNG | Shareable images, no server-side rendering needed |

---

## Data Model

### Local Storage (~/.wtclaude/)

```
~/.wtclaude/
├── config.json          # User preferences, sync settings, opt-in flags
├── sessions/
│   └── {session_id}.ndjson   # Per-turn records for each session
├── daily/
│   └── {YYYY-MM-DD}.json    # Daily aggregated summaries
└── comparisons/
    └── {date}.json           # Cached JSONL vs accurate comparisons
```

### Per-Turn Record (what the collector writes)

```json
{
  "ts": "2026-05-25T14:32:01.000Z",
  "session_id": "abc-123",
  "turn": 14,
  "model": "sonnet-4-6",
  "input_tokens": 3420,
  "output_tokens": 1890,
  "cache_read_tokens": 12500,
  "cache_write_tokens": 800,
  "tool_names": ["Read", "Edit", "Bash"],
  "cumulative_input": 48200,
  "cumulative_output": 26700,
  "used_percentage": 34,
  "project_hash": "a1b2c3"
}
```

**Critical design note:** The statusline payload gives CUMULATIVE totals. The collector must compute per-turn DELTAS by tracking the previous cumulative values and subtracting. Store both the delta (for per-turn analysis) and the cumulative (for verification).

### Supabase Schema (cloud sync)

```sql
-- Users
create table users (
  id uuid primary key default gen_random_uuid(),
  anonymous_id text unique not null,  -- hashed, no PII
  created_at timestamptz default now(),
  sharing_enabled boolean default false,
  preferences jsonb default '{}'
);

-- Sessions
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  session_id text not null,  -- from Claude Code
  project_hash text,
  started_at timestamptz,
  ended_at timestamptz,
  total_input_tokens bigint,
  total_output_tokens bigint,
  total_cache_read bigint,
  total_cache_write bigint,
  models_used jsonb,  -- {"sonnet-4-6": 0.65, "opus-4-7": 0.35}
  turn_count int,
  estimated_cost_usd numeric(10,4)
);

-- Turns (per-turn granularity — Guardian foundation)
create table turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references sessions(id),
  user_id uuid references users(id),
  turn_number int,
  timestamp timestamptz,
  model text,
  input_tokens int,
  output_tokens int,
  cache_read_tokens int,
  cache_write_tokens int,
  tool_names text[],
  cumulative_input bigint,
  cumulative_output bigint,
  used_percentage numeric(5,2)
);

-- Daily summaries (fast queries for dashboard)
create table daily_summaries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  date date not null,
  total_input_tokens bigint,
  total_output_tokens bigint,
  total_cache_read bigint,
  total_cache_write bigint,
  session_count int,
  turn_count int,
  models_used jsonb,
  tools_used jsonb,
  estimated_cost_usd numeric(10,4),
  unique(user_id, date)
);

-- Badges
create table badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  badge_type text not null,  -- 'first_100k', 'week_streak', 'million_club', etc.
  earned_at timestamptz default now(),
  metadata jsonb,
  unique(user_id, badge_type)
);

-- Leaderboard (materialized from daily_summaries, refreshed periodically)
create table leaderboard_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  period text not null,  -- 'weekly', 'monthly'
  period_start date not null,
  total_tokens bigint,
  total_cost_usd numeric(10,4),
  efficiency_score numeric(6,2),  -- output/input ratio or similar
  session_count int,
  unique(user_id, period, period_start)
);
```

**Row Level Security:** Every table must have RLS policies so users can only see their own data. Leaderboard entries are visible to all opted-in users.

---

## Build Stages

### Stage 1: Collector + Local CLI (Days 1-3)

**Goal:** A working statusline script and CLI that shows accurate usage data locally. No cloud, no dashboard. This is the shippable minimum for a Reddit/HN post.

**Build order:**

1. **Scaffold the npm package**
   - `npm init` with name `wtclaude`
   - Package structure: `bin/`, `src/collector/`, `src/cli/`, `src/utils/`
   - bin entry: `wtclaude` command
   - Add Commander.js for CLI argument parsing

2. **Build the collector script** (`src/collector/index.js`)
   - Reads JSON from stdin (Claude Code pipes statusline data here)
   - Maintains in-memory state of previous cumulative totals per session
   - Computes per-turn deltas on each update
   - Appends per-turn record to `~/.wtclaude/sessions/{session_id}.ndjson`
   - Outputs a status string back to stdout (e.g., "📊 $4.23 | 340K tok")
   - Must handle: new sessions, model switches mid-session, /compact resets, session resumption
   - Must be fast (<50ms per invocation — it runs on every status update)

3. **Build the JSONL reader** (`src/compare/jsonl-reader.js`)
   - Reads Claude Code's JSONL files from `~/.claude/projects/*/`
   - Parses the same session data ccusage reads
   - Extracts: input_tokens, output_tokens, cache metrics per session
   - This gives the "wrong" numbers for comparison

4. **Build the CLI commands** (`src/cli/`)
   - `wtclaude today` — today's usage summary (tokens, cost, model breakdown, sessions)
   - `wtclaude week` — last 7 days
   - `wtclaude month` — last 30 days
   - `wtclaude project <hash>` — per-project breakdown
   - `wtclaude compare` — side-by-side accurate vs JSONL numbers (THE marketing moment)
   - `wtclaude whatif --plan=pro|max5|max20` — what would today's usage cost on different plans
   - `wtclaude whatif --model=haiku|sonnet|opus` — what if you'd used a different model
   - `wtclaude debrief` — today's end-of-day summary with costliest turn and tip

5. **Build the cost calculator** (`src/utils/cost.js`)
   - Anthropic pricing as of May 2026:
     - Haiku 4.5: $1 / $5 per MTok (input/output)
     - Sonnet 4.6: $3 / $15 per MTok
     - Opus 4.7: $5 / $25 per MTok (estimated — verify current)
   - Cache read: 10% of input price
   - Cache write: 25% of input price
   - Store pricing as a versioned config (not hardcoded) for easy updates

6. **Build the setup command** (`wtclaude setup`)
   - Auto-detects Claude Code settings.json location
   - Adds the statusline command entry
   - Creates ~/.wtclaude/ directory structure
   - Verifies setup is working
   - Shows "You're ready! Start a Claude Code session and run `wtclaude today` after."

7. **Write README.md**
   - Lead with the JSONL bug story (hook)
   - Show the comparison numbers (proof)
   - One-command install: `npx wtclaude setup`
   - Screenshots of CLI output and comparison
   - "Why your current tracker is wrong" section
   - MIT license

**Stage 1 deliverable:** `npx wtclaude setup` → use Claude Code → `wtclaude compare` → see the 100x discrepancy. Postable to Reddit/HN.

---

### Stage 2: Comparison Card + Referral Mechanics (Days 3-5)

**Goal:** Make the "your tracker is lying" moment shareable and viral.

**Build order:**

1. **Shareable comparison card generator** (`src/compare/card.js`)
   - Takes comparison data (ccusage numbers vs accurate numbers)
   - Generates a visual card (HTML rendered to PNG, or SVG)
   - Design: clean, high-contrast, shocking numbers side-by-side
   - Example: "ccusage: $3.42/day | Reality: $18.70/day | 5.5x gap"
   - Include WTClaude branding and URL
   - `wtclaude compare --share` → saves PNG to ~/Desktop and copies to clipboard
   - Also generates an HTML version for web embedding

2. **"Check your numbers" invite link system**
   - `wtclaude invite` → generates a personalized URL
   - URL goes to landing page (static, can be GitHub Pages initially)
   - Landing page: explains the bug, shows example comparison, links to install
   - Track: referral source (which user invited), install completions
   - Keep this simple — a unique URL param is enough for v1

3. **Landing page** (static HTML, deploy on Vercel)
   - Hero: "Your Claude Code tracker is lying to you by 100x"
   - The proof: Magnus Gille's research numbers
   - CTA: "Check your real numbers in 60 seconds" → install instructions
   - Social proof: once you have users, show "X developers have checked their real numbers"

**Stage 2 deliverable:** Users can share comparison cards on social media and send invite links to colleagues.

---

### Stage 3: Supabase Backend + Cloud Sync (Days 5-8)

**Goal:** Opt-in cloud sync so users can access a web dashboard and contribute to the leaderboard.

**Build order:**

1. **Supabase project setup**
   - Create project on Supabase free tier
   - Run schema migration (tables above)
   - Set up Row Level Security policies
   - Create edge functions: `sync-data`, `get-summary`, `get-leaderboard`

2. **User registration flow**
   - Anonymous by default — generate a local UUID, no email required
   - `wtclaude sync --enable` → creates anonymous user in Supabase
   - `wtclaude share --enable` → opts into data sharing for leaderboard/benchmarks
   - Store sync token locally in ~/.wtclaude/config.json

3. **Sync mechanism** (`src/sync/index.js`)
   - Background sync: after each session ends (or on CLI command)
   - `wtclaude sync` → manual push of unsynced data
   - Auto-sync option: set in config, runs on each collector invocation
   - Batch upload: send session + turn data in a single POST
   - Handle: offline resilience, retry logic, conflict resolution
   - Edge function validates and inserts data

4. **Daily summary computation**
   - Edge function or database trigger: aggregate turns into daily_summaries
   - Run on each sync, or as a scheduled Supabase function (cron)
   - This is what the dashboard queries for fast chart rendering

5. **Badge computation** (`src/badges/check.js`)
   - Run after each sync: check if user earned new badges
   - Badge definitions:
     - `first_session` — tracked your first session
     - `truth_revealed` — ran your first comparison
     - `100k_club` — 100K tokens tracked
     - `million_club` — 1M tokens tracked
     - `week_streak` — tracked 7 consecutive days
     - `month_streak` — tracked 30 consecutive days
     - `efficient_day` — day where cache hit rate > 50%
     - `model_mixer` — used 2+ models in a single session
     - `sharer` — enabled data sharing
     - `recruiter` — someone installed via your invite link
   - Notify user in CLI: "🏆 New badge: Million Club! You've tracked 1M tokens."

6. **Leaderboard computation**
   - Edge function: refresh weekly/monthly leaderboard entries
   - Only includes users with sharing_enabled = true
   - Metrics: total tokens, estimated cost, efficiency score, session count
   - Efficiency score = meaningful output / total input (formula TBD, iterate post-launch)

**Stage 3 deliverable:** Users can opt into cloud sync and see their data persisted. Badge notifications in CLI. Leaderboard data being collected.

---

### Stage 4: Web Dashboard (Days 8-12)

**Goal:** A clean, responsive web dashboard showing usage data, session timelines, comparisons, leaderboard, and badges.

**Build order:**

1. **Scaffold React app**
   - Vite + React + TailwindCSS
   - Supabase client SDK for auth and data
   - Recharts or Chart.js for visualizations
   - Deploy on Vercel

2. **Authentication flow**
   - Link local anonymous ID to web session
   - `wtclaude dashboard` → opens browser with auth token
   - No email/password required for v1 — token-based anonymous auth
   - Future: optional email for monthly reports

3. **Dashboard pages:**

   **a. Overview (home)**
   - Today's usage: tokens, cost, sessions, model breakdown
   - 7-day trend chart (bar or area)
   - 30-day trend chart
   - Current badges displayed
   - "vs JSONL" comparison callout if available

   **b. Session Timeline**
   - List of sessions (today, this week, selectable date range)
   - Click into a session → Strava-style timeline:
     - X-axis: time
     - Y-axis: token consumption per turn
     - Color-coded by model
     - Tool call markers
     - Hover: turn details (model, tokens, tools, cost)
   - Highlight cost spikes visually
   - This is the "wow" view — make it beautiful

   **c. Compare**
   - Side-by-side: ccusage/JSONL numbers vs WTClaude accurate numbers
   - For each available session/day: show both sets of numbers
   - Big red "X times wrong" callout
   - "Share this" button → generates comparison card
   - "Invite a friend to check theirs" → generates invite link

   **d. "What If" Calculator**
   - Select a time period (day, week, month)
   - Toggle between plans: Pro ($20), Max 5x ($100), Max 20x ($200), API
   - Toggle between models: current mix vs all-Haiku, all-Sonnet, all-Opus
   - Show: "Your actual cost" vs "What it would have been"
   - Highlight savings or overspend

   **e. Leaderboard**
   - Weekly and monthly tabs
   - Sortable columns: total tokens, cost, efficiency, sessions
   - User's own rank highlighted
   - Opt-in gate: "Enable sharing to see the leaderboard"

   **f. Badges**
   - Grid of all available badges (earned = full color, unearned = greyed)
   - Click badge for description and when earned
   - "Share badge" button for earned badges

   **g. Settings**
   - Sync: enable/disable, manual sync button
   - Sharing: enable/disable, preview exactly what data is shared
   - Notifications: email for monthly report (optional)
   - Plan info: which Claude plan are you on (for "what if" calculations)

4. **Monthly Lite Report generation**
   - Edge function: runs on 1st of each month (Supabase cron)
   - Computes: total tokens, total cost, trend vs previous month, most-used model, busiest day
   - Stores report in a `monthly_reports` table
   - If user has email: send via Resend/Postmark
   - Also viewable in dashboard under a "Reports" tab
   - Lite version (free tier): top-line numbers and trend only
   - Conversion hook at bottom: "Want the full breakdown? Guardian shows WHERE the waste is."

5. **Daily Debrief (email/web)**
   - Edge function: runs end of day (user's timezone if known, else UTC)
   - Short summary: sessions, tokens, cost, costliest moment, one tip
   - Viewable in dashboard
   - Optional email delivery (if user provided email)

**Stage 4 deliverable:** Full web dashboard with all views, deployed on Vercel.

---

### Stage 5: Polish, Testing, Launch Prep (Days 12-14)

**Goal:** Production-ready for public launch.

**Build order:**

1. **Edge case handling**
   - Multiple concurrent Claude Code sessions
   - Session resumption after /compact
   - Model switches mid-session
   - Very long sessions (8+ hours)
   - No data yet (first-run experience)
   - Interrupted sync (network failures)
   - Clock skew between local and server

2. **Performance verification**
   - Collector script: must complete in <50ms (runs on every status update)
   - CLI commands: must render in <500ms
   - Dashboard: initial load <2s, chart renders <500ms
   - Sync: batch upload <2s for a full day's data

3. **Install flow testing**
   - Test: `npx wtclaude setup` on macOS and Linux
   - Test: fresh install, first session, first comparison
   - Test: sync enable, dashboard link, data appears
   - Windows: may need separate handling (path differences)

4. **README finalization**
   - Compelling opening (the bug story)
   - Clear install instructions with screenshots
   - Feature overview with GIFs/screenshots
   - "vs JSONL" proof section
   - Contributing guide
   - License (MIT)

5. **Launch assets**
   - Screenshots of: CLI comparison output, dashboard overview, session timeline, leaderboard
   - Comparison card example image
   - Reddit post draft (for r/ClaudeAI, r/programming)
   - Hacker News Show HN post draft
   - Twitter/X thread draft

6. **Monitoring setup**
   - Supabase dashboard for DB metrics
   - Vercel analytics for dashboard traffic
   - npm download tracking
   - Error tracking (Sentry free tier or similar)

**Stage 5 deliverable:** Production-ready product with launch materials.

---

## What NOT to Build in Phase 0

These are explicitly deferred. Do not build them, do not architect for them beyond what the data model already supports. The code chat should push back if scope creep pulls these in.

| Feature | Why Not Now | When |
|---------|------------|------|
| Estimation engine | Phase 1 — needs Claude API integration, archetype database | Month 2-3 |
| Teaching mode (beyond basic tips) | Phase 1 — needs content library | Month 2-3 |
| Change detection / alerts | Phase 1 — needs changedetection.io setup | Month 2-3 |
| Guardian real-time monitoring | Phase 1-2 — data foundation is ready, but monitoring UX is complex | Month 3-4 |
| Session autopsy | Guardian feature — per-turn data is being collected to support it | Month 3-4 |
| Multi-channel notifications | Guardian — Telegram/Discord/WhatsApp bots | Month 3-4 |
| Full gamification (seasons, prizes) | Phase 2 — basic badges/leaderboard is enough for now | Month 4-6 |
| Team features | Phase 2-3 — needs team auth, admin roles | Month 4-6 |
| Enterprise features | Phase 3 — needs Enterprise Analytics API integration | Month 6+ |
| Multi-provider support | Phase 2+ — Claude-only for now | Month 4+ |
| Payment/subscription system | Phase 1 — no revenue in Phase 0 | Month 2-3 |

---

## Key Technical Decisions (Do Not Override)

These decisions were made during extensive research. The code chat must follow them.

1. **Read statusline data, NOT JSONL.** The entire product premise is accuracy. JSONL is 100x wrong. Never read JSONL for actual usage data — only read it for the comparison view.

2. **Store per-turn data, not just session summaries.** Guardian needs per-turn granularity for anomaly detection and session autopsy. Building with only daily aggregates would require a painful rearchitecture later.

3. **Compute deltas from cumulative totals.** The statusline payload gives cumulative numbers. The collector must track previous values and subtract to get per-turn deltas. Store BOTH the delta and the cumulative (cumulative for verification, delta for analysis).

4. **Anonymous by default, no email required.** Friction kills adoption. Generate a local UUID. Email is optional (for monthly reports). No OAuth, no sign-up form, no passwords for v1.

5. **Opt-in data sharing with clear preview.** Users must explicitly enable sharing. Show them exactly what data is shared before they opt in. Never share: prompts, code, file names, project paths. Only share: token counts, model, tools used, timestamps, project hash.

6. **Pricing stored as versioned config.** Anthropic changes pricing regularly. Don't hardcode pricing anywhere. Use a pricing config file with a version/date. When pricing changes, add a new version — don't overwrite.

7. **MIT license.** Open source the entire Phase 0 tracker. The value is in the data moat and the future paid features (Guardian, estimator), not in the tracker code itself.

8. **Vercel Pro for hosting.** Hobby tier prohibits commercial use. Budget $20/month from day one.

9. **Supabase free tier initially.** Sufficient for first 2,000 users. Upgrade to Pro ($25/mo) at ~5,000 users.

---

## Pricing Reference (Anthropic, May 2026)

Keep these in the versioned pricing config:

```json
{
  "version": "2026-05-25",
  "models": {
    "haiku-4-5": { "input": 1.00, "output": 5.00 },
    "sonnet-4-6": { "input": 3.00, "output": 15.00 },
    "opus-4-7": { "input": 5.00, "output": 25.00 }
  },
  "cache": {
    "read_multiplier": 0.10,
    "write_multiplier": 0.25
  },
  "plans": {
    "pro": { "price_monthly": 20, "label": "Pro" },
    "max_5x": { "price_monthly": 100, "label": "Max 5x" },
    "max_20x": { "price_monthly": 200, "label": "Max 20x" },
    "team_standard": { "price_per_seat": 30, "label": "Team Standard" },
    "team_premium": { "price_per_seat": 60, "label": "Team Premium" }
  },
  "units": "USD per million tokens"
}
```

---

## Success Metrics

| Metric | Week 1 Target | Month 1 Target | Month 2 Target |
|--------|--------------|----------------|----------------|
| npm downloads | 500+ | 5,000+ | 10,000+ |
| Active dashboard users | — | 500+ | 2,000+ |
| Opt-in data sharers | — | 150+ (30%+) | 600+ |
| Comparison cards shared | 50+ | 500+ | 2,000+ |
| GitHub stars | 100+ | 500+ | 1,500+ |
| Reddit/HN front page | 1 post | 2+ posts | organic mentions |

---

## File/Folder Structure (target)

```
wtclaude/
├── package.json
├── README.md
├── LICENSE (MIT)
├── bin/
│   └── wtclaude.js          # CLI entry point
├── src/
│   ├── collector/
│   │   └── index.js          # Statusline script — receives JSON, logs per-turn data
│   ├── cli/
│   │   ├── today.js
│   │   ├── week.js
│   │   ├── month.js
│   │   ├── project.js
│   │   ├── compare.js        # vs JSONL comparison
│   │   ├── whatif.js          # Plan/model what-if calculator
│   │   ├── debrief.js         # End-of-day summary
│   │   ├── invite.js          # Generate invite links
│   │   ├── setup.js           # Auto-configure Claude Code settings
│   │   └── sync.js            # Cloud sync management
│   ├── compare/
│   │   ├── jsonl-reader.js    # Read Claude Code JSONL files
│   │   └── card-generator.js  # Shareable comparison card (HTML/PNG)
│   ├── sync/
│   │   └── index.js           # Upload data to Supabase
│   ├── badges/
│   │   └── check.js           # Badge computation logic
│   ├── utils/
│   │   ├── cost.js            # Token → cost calculation
│   │   ├── pricing.js         # Versioned pricing config
│   │   ├── paths.js           # ~/.wtclaude/ path management
│   │   └── format.js          # CLI output formatting
│   └── config/
│       └── pricing-2026-05-25.json
├── web/                       # Dashboard (separate Vite project, or monorepo)
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Overview.jsx
│   │   │   ├── SessionTimeline.jsx
│   │   │   ├── Compare.jsx
│   │   │   ├── WhatIf.jsx
│   │   │   ├── Leaderboard.jsx
│   │   │   ├── Badges.jsx
│   │   │   └── Settings.jsx
│   │   ├── components/
│   │   └── lib/
│   │       └── supabase.js
│   ├── index.html
│   └── vite.config.js
├── supabase/
│   ├── migrations/
│   │   └── 001_initial_schema.sql
│   └── functions/
│       ├── sync-data/
│       ├── get-summary/
│       ├── get-leaderboard/
│       └── monthly-report/
└── landing/                   # Static landing page
    └── index.html
```
