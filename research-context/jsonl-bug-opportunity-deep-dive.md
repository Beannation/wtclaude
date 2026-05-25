# The JSONL Accuracy Bug — Deep Dive & Opportunity Assessment

**Date:** May 24, 2026
**Purpose:** Full research on whether to build the first accurate Claude Code usage tracker as a wedge product
**Decision needed:** Should Peter build this immediately (tomorrow morning)?

---

## The Bug in Plain English

Every time you use Claude Code, it writes a log file to your computer (JSONL format) recording what happened. Every community tool that tracks your token usage reads this file. The problem: **the numbers in this file are wrong by 100x on input tokens and 10-17x on output tokens.** 75% of entries contain placeholder values (0 or 1) that were never updated with the real numbers.

This means every developer who's ever checked "how much did that session cost me?" using any community tool has been looking at numbers that are catastrophically wrong. They think they used 225K tokens in a day when they actually used 10.4 million.

---

## The Detailed Technical Reality

### Two data paths exist inside Claude Code

1. **JSONL logs** (what everyone reads): Written during streaming, never updated after completion. Input tokens recorded as 0 or 1 in 75% of entries. Output tokens exclude thinking/reasoning tokens (60-70% of Opus output). Streaming duplicates inflate entry count by 51-55%.

2. **Statusbar context** (the accurate source): A JSON payload piped to statusline scripts on every update. Contains cumulative totals maintained internally from finalized API responses. Matches billing data exactly — verified to the token against Anthropic's billing dashboard.

### The numbers (from the primary research paper by Magnus Gille)

**Heavy day (20 sessions, 1,365 API requests):**
- Input tokens: JSONL says 41,444 → Actual is 7,199,162 → **174x undercount**
- Output tokens: JSONL says 183,829 → Actual is 3,208,365 → **17x undercount**
- Cache tokens: JSONL matches actual (~1x) ← this is the proof it's not missing entries

**Moderate day (12 sessions, 1,228 requests):**
- Input tokens: JSONL says 11,758 → Actual is 1,193,366 → **102x undercount**
- Output tokens: JSONL says 69,449 → Actual is 748,337 → **11x undercount**

**Combined daily total:** ccusage reported 225K tokens. Actual was 10.4M. A **46x gap.**

### Root cause

Claude Code writes JSONL entries during streaming (before the API response finalizes). The `input_tokens` field gets a placeholder of 0 or 1. When the request completes and the real number is available, **nobody goes back to update the log entry.** It's an architectural oversight, not a deliberate choice.

Cache metrics are accurate because they're available in the initial API response header before streaming begins.

### What IS accurate (the key to building the solution)

The **statusbar context** — the JSON payload Claude Code pipes to statusline scripts — contains accurate cumulative totals:
- `total_input_tokens` (excludes cache, no double-counting)
- `total_output_tokens` (includes thinking/reasoning tokens)
- `cache_read_input_tokens`
- `cache_creation_input_tokens`
- `used_percentage` (rate limit utilization)

This data comes from Claude Code's internal state, which IS updated from finalized API responses. It's the same data the `/cost` command uses. It matches billing to the exact token.

---

## Who Is Affected & How Much They're Paying

### Tools currently giving wrong numbers

| Tool | Users/Popularity | What it does | Affected? |
|---|---|---|---|
| **ccusage** | 43,496 weekly npm downloads | CLI: daily/weekly/monthly usage analysis | YES — reads JSONL, undercounts 46x |
| **tokscale** | 3,148 GitHub stars | CLI: multi-platform token leaderboard | YES — reads JSONL |
| **Claude-Code-Usage-Monitor** | Popular GitHub repo | Real-time chart + predictions | YES — reads JSONL |
| **claude-usage** | Active GitHub repo | Dashboard with charts & cost estimates | YES — reads JSONL |
| **CodeBurn** | Show HN feature | Task-level token analysis | YES — reads JSONL |
| **par-cc-usage** | PyPI package | Python usage analyzer | YES — reads JSONL |
| **claude-code-usage-analyzer** | GitHub repo | Comprehensive cost & token analyzer | YES — reads JSONL |
| **vscode-claude-status** | VS Code extension | Token usage in status bar | YES — reads JSONL |

**Conservative estimate: 50,000-80,000 developers are using tools that give them wrong data.** ccusage alone has 43K weekly downloads — many of those are recurring users but it signals massive demand.

### Are people paying for wrong data?

Most of these tools are free/open-source. However:
- tokscale has a SaaS component (tokscale.ai) with premium features
- Several tools are part of larger paid ecosystems (ClaudeFast, SessionWatcher)
- Companies are making budget decisions based on this data (the enterprise angle)
- Users are making plan-choice decisions based on wrong numbers ("I only used 225K tokens today, Pro is fine" when they actually used 10.4M)

The real cost isn't subscription fees — it's **bad decisions made on bad data.** Users are:
- Staying on plans that are too small (because they think usage is lower than it is)
- Not optimizing their workflows (because they can't see where tokens are actually going)
- Underestimating project costs when talking to their bosses
- Building inaccurate mental models of how Claude Code works

---

## User Frustration (The Emotional Landscape)

### From the GitHub issues

The original bug report (Issue #22686, Feb 3, 2026) documents that output tokens are "severely undercounted" and only streaming chunks are saved.

The ccusage issue (#866, Feb 24, 2026) has the community realizing their favorite tool is fundamentally broken. The maintainer's response: add a warning that numbers "may be understated" — because they can't fix an upstream bug.

### The broader frustration context (from your handoff doc)

This bug sits inside the LARGER frustration of opacity:
- "Token burn while you are deep in a session... the bill usually shows up after the fact."
- "Customers buy tokens to use AI services — but the amount of tokens needed for each task is sometimes opaque."
- "A simple one sentence reply to a conversation just took me from 59% usage to 100%. How??"

Users already feel they can't understand their usage. The one tool they reached for to gain understanding... is lying to them by 100x. They don't even know it yet. Most users of ccusage have no idea their numbers are wrong.

### The "aha" moment potential

When users discover their tracking has been 100x wrong, the emotional response will be intense. This is a Reddit-front-page, HN-top-story moment waiting to happen. The person who delivers that "aha" — and immediately offers the solution — captures enormous trust and attention.

---

## Why Hasn't Anthropic Fixed It?

### Evidence of non-prioritization

- Bug filed: February 3, 2026 (Issue #22686)
- Independent analysis published: February 24, 2026 (gille.ai blog)
- ccusage community issue opened: February 24, 2026 (Issue #866)
- Feature request for hooks token data: April 22, 2026 (Issue #52089)
- Feature request for session cost in hooks: (Issue #29829)
- Feature request for built-in analytics command: (Issue #33978)
- Feature request for rate limit in statusline JSON: (Issue #36056)

**It has been 3.5 months. No fix shipped.** During this same period Anthropic shipped: usage limit increases, Opus 4.7, new billing models, hooks system expansion, agent teams, and dozens of other features. They're not starved for engineering capacity — this just isn't a priority.

### Why it's not high priority for them

1. **Their own tools work fine.** The `/cost` command, `/usage` command, and `/stats` command all use the accurate internal state (statusbar data). Anthropic's user-facing features aren't broken.

2. **JSONL is a debug/logging artifact, not a product feature.** They didn't design it as a public API for third-party tools. Third parties adopted it because nothing better existed.

3. **Fixing it has no revenue impact for Anthropic.** Users can't track usage accurately → users can't optimize → users potentially pay more. There's a perverse incentive to NOT fix it, though I doubt it's intentional.

4. **The fix requires an architecture change.** Logging during streaming is by design (crash-resistance, low memory). Changing to "log after completion" or "update after completion" requires rethinking the write path. Not hard, but not trivial either.

5. **Multiple competing feature requests.** The community wants: hooks exposure (Issue #52089), statusline exposure (Issue #11535), built-in analytics (Issue #33978), MCP exposure (Issue #49588). Anthropic may be planning a larger solution that addresses all of these at once — but that means waiting longer.

### Estimated timeline for fix

**My assessment: 3-12 months before Anthropic fixes this, possibly never as-is.**

Arguments for "eventually fixed":
- High-profile bug report with clear methodology
- Multiple related feature requests accumulating
- Community frustration building
- Anthropic cares about developer experience

Arguments for "slow/never":
- 3.5 months already with no movement
- Their own tools work fine without it
- No revenue pressure to fix
- May be waiting for a larger "usage analytics" overhaul (Issue #33978 consolidates 10+ requests)
- The "simple fix" (append final values) has been suggested — they haven't done it

**Most likely scenario:** Anthropic ships a larger built-in analytics solution (Issue #33978) in 6-12 months that gives accurate built-in tracking, making JSONL accuracy moot. But that gives you 6-12 months of exclusive window, minimum.

---

## How YOU Could Be First to Solve It

### The technical path (available TODAY)

The accurate data is accessible right now via the **statusline command** feature. Here's how:

Claude Code supports custom statusline commands in `settings.json`:

```json
{
  "statusLine": {
    "command": "/path/to/your-tracker-script.sh"
  }
}
```

This script receives a JSON payload on stdin every time the status updates, containing:
```json
{
  "session_id": "uuid",
  "total_input_tokens": 1234567,
  "total_output_tokens": 567890,
  "cache_read_input_tokens": 5000000,
  "cache_creation_input_tokens": 80000,
  "used_percentage": 42,
  "model": "opus-4-7",
  ...
}
```

**This is the accurate data.** It matches billing exactly. It's updated on every status refresh. No API calls needed. Runs locally. Zero cost.

### What you'd build

**A statusline script that:**
1. Receives the accurate JSON payload on each status update
2. Logs it to a local file (append-only, one line per update — like what JSONL should have been)
3. Calculates per-session and per-day totals correctly
4. Optionally syncs to a web dashboard (your backend)

**Plus a CLI/dashboard that:**
1. Reads the accurate local log
2. Shows: daily cost, per-session breakdown, model mix, cache efficiency
3. Compares against JSONL numbers ("Here's what ccusage told you vs reality")
4. Optionally sends anonymized data to your backend (opt-in — feeds your moat)

### Why this beats every existing tool

| Capability | ccusage / tokscale / others | Your tool |
|---|---|---|
| Data source | JSONL (100x wrong) | Statusbar context (exact) |
| Input token accuracy | 100-174x undercount | 1:1 match to billing |
| Output token accuracy | 10-17x undercount | 1:1 (includes thinking) |
| Includes reasoning tokens | No | Yes |
| Per-session breakdown | Yes (but wrong numbers) | Yes (correct numbers) |
| Model breakdown | Yes | Yes |
| Real-time | No (reads after the fact) | Yes (updates on each response) |
| Sync to web dashboard | Some (tokscale) | Yes (optional, opt-in) |
| Feeds a larger data moat | No | Yes (if user opts in) |

### IMPORTANT: Current limitation

**The Stop hook does NOT currently include token usage data.** This means the HTTP hooks approach described in earlier research (for the enterprise pipeline) needs to work differently today:

- **Today:** Use statusline command (local script, accurate, real-time)
- **Future:** When Anthropic ships token data in hooks (Issue #52089), upgrade to HTTP hooks for remote reporting

The statusline approach works perfectly for individual users and for companies whose devs can install the script. The hooks approach (when available) will be better for enterprise-wide deployment.

---

## Does This Usage Data Help Your Moat?

**Massively.** Here's exactly how:

### For the estimation engine

Every session tracked with accurate data gives you:
- Actual tokens consumed for a real project
- Model selection patterns (when do people use Opus vs Sonnet?)
- Cache efficiency (how much do CLAUDE.md and prompt caching actually save?)
- Session length distribution (how many turns per productive session?)
- Tool usage patterns (which tools burn the most tokens?)

After 1,000 users contributing data for 30 days, you'll have ~30,000 accurately-measured sessions. No one else has this. Not Anthropic publicly, not any community tool (they all have bad data). Your estimation engine trains on ground truth.

### For the enterprise optimization feature (Idea 1)

The accurate tracker IS the data collection layer for enterprise optimization. Same infrastructure, same data, just aggregated per-company instead of per-individual.

### For the teaching layer

Accurate data lets you tell users: "Your CLAUDE.md saved you 30% of tokens this week — here's the proof." Or: "Your MCP server overhead is 18% of every session — here's which server to remove." Currently impossible because everyone's data is 100x wrong.

### For competitive moat

If Anthropic eventually fixes JSONL, existing tools get accurate data too. But you'll have **months of historical accurate data** that no one else collected during the broken period. And you'll have user trust from being first.

---

## The Window: How Much Time Do You Have?

### Pessimistic case (3 months)
Anthropic ships a fix to JSONL or builds native accurate tracking. Your exclusive window was small.

**But:** Even in this case, you've already built the infrastructure and collected data. The tracker becomes one feature of your larger product rather than the wedge.

### Realistic case (6-9 months)
Anthropic is working on a larger analytics overhaul (Issue #33978). It ships in late 2026. You have 6-9 months of exclusive accurate tracking.

**In 6 months with momentum:** Thousands of users, accurate benchmark database, established trust, enterprise pilots running. When Anthropic ships their native solution, you're already differentiated by the teaching layer, estimation engine, and enterprise features they won't build.

### Optimistic case (12+ months)
JSONL never gets fixed because Anthropic builds something separate. Or they deprioritize it further. You own this space for over a year.

### The key insight about timing

**Even if the window is only 3 months, it's still worth building.** Because:
1. It's fast to build (statusline script + basic dashboard = 1-2 weeks for MVP)
2. It collects data from day one that feeds your main product
3. It builds trust and audience before the estimator launches
4. The marketing angle ("your tools are 100x wrong") is time-sensitive — first mover captures the attention

---

## The Go-to-Market Angle

### The reveal post (Reddit/HN)

Title: "Your Claude Code token tracking tools are 100x wrong. Here's proof and a fix."

Content: Link to the gille.ai research (credit them), show the discrepancy in clear terms, explain why, and offer your tool as the solution. This is the kind of post that hits r/ClaudeAI front page and HN top 10 because it's:
- Surprising (people thought they understood their usage)
- Provable (the data is clear)
- Immediately actionable (install this to get accurate numbers)
- Emotionally resonant (validates the "WTF" feeling people already have)

### WTClaude brand fit

This is PERFECT for WTClaude. The brand is literally "WTF, Claude?" and the reveal is "your tracking tools have been lying to you by 100x. WTClaude tells you the truth." The emotional alignment is exact. The name captures the reaction people will have.

### Growth loop

1. User discovers their data was wrong → installs your tool
2. Your tool shows them accurate numbers → they share the shock on social
3. Others see the post → install the tool
4. Users with accurate data optionally feed your moat → your estimates get better
5. You launch the estimator → existing tracker users are your first adopters

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Anthropic fixes JSONL quickly (<3 months) | 15% | Medium (lose exclusivity, keep data) | Ship FAST. Collect as much data as possible in the window. |
| Statusline API changes/breaks | 10% | High (core data source gone) | Pin to current behavior. Monitor for changes. Have JSONL fallback (when fixed). |
| Low adoption (people don't install statusline scripts) | 25% | Medium (slow data collection) | Make installation trivially easy. Show immediate value. Consider Claude Code plugin format. |
| Community backlash ("you're profiting from a bug") | 10% | Low | Open-source the core. Frame as: "We built what Anthropic should have." Credit original researchers. |
| ccusage maintainer fixes their tool first | 5% | Medium | They CAN'T fix it — it's an upstream bug. They can only add warnings. Unless they also switch to statusbar data. |

### Can ccusage just switch to statusbar data?

Theoretically yes. But:
1. Their architecture is built around reading JSONL files after the fact
2. Statusbar data requires an active script running during sessions (different paradigm)
3. They'd need to rebuild their core — it's essentially a different tool
4. The maintainer has filed an issue asking Anthropic to fix it upstream, suggesting they're waiting rather than building around it

---

## The Build Scope (What "Tomorrow Morning" Looks Like)

### Day 1-3: Core statusline tracker
- Statusline script (bash/python) that receives JSON and appends to local log
- Log format: one JSON line per status update with timestamp
- Basic CLI command to summarize: today's tokens, cost, model breakdown
- Installation: add one line to settings.json

### Day 4-7: Dashboard + comparison
- Simple web page showing daily/weekly/monthly usage
- "vs JSONL" comparison (show users the discrepancy in their own data)
- Install instructions page
- Basic opt-in data submission to your backend

### Day 8-10: Polish + launch prep
- README with clear explanation of the bug
- Blog post draft: "Your Claude Code tracking is 100x wrong"
- r/ClaudeAI post draft
- npm package for easy installation

### Week 3-4: Web dashboard + sync
- Account creation (optional)
- Data syncs from local log to web
- Team view (if multiple users from same company)
- Public benchmarks page (from anonymized opt-in data)

**Total MVP: 2 weeks to something shippable. 4 weeks to something polished.**

---

## Final Verdict: Should You Build This Tomorrow?

**Yes.** Here's why in priority order:

1. **The window is open now and closing.** 3.5 months since discovery, no fix. But Anthropic is aware. Every week you wait is a week closer to them solving it (or someone else building what you'd build).

2. **It's fast to build.** The core is a statusline script — literally a few hundred lines of code. The hard part isn't engineering, it's distribution.

3. **It directly feeds your main product.** This isn't a distraction from the estimator — it's the data collection infrastructure for it. Every user of the tracker is a future user of the estimator.

4. **The marketing angle is explosive.** "100x wrong" is a headline. It's shareable, provable, and emotionally resonant. This is your launch moment for the WTClaude brand.

5. **Low downside risk.** If Anthropic fixes it in 3 months, you've still collected 3 months of data, built an audience, and have a working tool that becomes one feature of the larger product. Nothing is wasted.

6. **The WTClaude brand was made for this.** This IS the "WTF, Claude" moment. The name captures exactly what people will feel when they discover the discrepancy.

---

## Sources

- [Claude Code's Token Counts Are Wrong — 100x Off in the JSONL Logs (gille.ai)](https://gille.ai/en/blog/claude-code-jsonl-logs-undercount-tokens/) — Primary research paper
- [GitHub Issue #22686: Output tokens incorrectly recorded in JSONL](https://github.com/anthropics/claude-code/issues/22686) — Original bug report
- [GitHub Issue #866: ccusage undercounts significantly](https://github.com/ryoppippi/ccusage/issues/866) — Community impact
- [GitHub Issue #52089: Expose session token usage to hooks](https://github.com/anthropics/claude-code/issues/52089) — Feature request (unfulfilled)
- [GitHub Issue #29829: Expose session cost in hook event data](https://github.com/anthropics/claude-code/issues/29829) — Related request
- [GitHub Issue #33978: Built-in Usage Analytics Command](https://github.com/anthropics/claude-code/issues/33978) — Anthropic's potential solution (consolidates 10+ issues)
- [Claude Code Energy Monitor (GitHub)](https://github.com/Magnus-Gille/claude-code-energy-monitor) — Tool that uses the accurate statusbar data
- [ccusage npm page](https://www.npmjs.com/package/ccusage) — 43,496 weekly downloads
- [tokscale (GitHub)](https://github.com/junhoyeo/tokscale) — 3,148 stars, also reads JSONL
- [Claude Code Statusline Docs](https://code.claude.com/docs/en/statusline) — How to access accurate data
- [Hooks Reference](https://code.claude.com/docs/en/hooks) — Current hook payload (no token data yet)
- [Claude Code Cost Tracking Docs](https://code.claude.com/docs/en/costs) — /cost command uses accurate internal state
