# Claude Usage Estimator — Approved New Ideas (Pending Merge)

**Purpose:** Dedicated file for new ideas validated during research. Each entry is approved by Peter. Will be merged into the main feasibility report and build plan only on explicit instruction.

**Rule:** Nothing gets added here without Peter's clear approval.

---

## Idea 1: Enterprise Usage-to-Optimization Pipeline

**Status:** Approved
**Date approved:** May 24, 2026
**Proposed phase:** Phase 3 (month 6-9), with hooks infrastructure built earlier

### Summary

Enterprise and Team plan customers deploy a lightweight hook/plugin to their employees' Claude Code instances. Usage metadata (never content) feeds into a dedicated per-customer database. After the first month of data collection, the app delivers:

- A licensing optimization report in their dashboard
- Real-time alerts during the month (e.g., "7 users on Premium seats are consistently underutilizing — recommend Standard")
- Ongoing cost-efficiency scoring and trend analysis

The company gets certainty that their spend is being used as effectively as possible. We get usage data from large user pools that can optionally feed our broader benchmark database.

### How it works technically

**Data collection — two complementary paths:**

1. **Claude Code hooks (granular, per-turn):** HTTP hook on the Stop lifecycle event POSTs usage metadata to the customer's dedicated endpoint after every Claude Code interaction. Captures: tokens per turn, model used, tool names invoked, session duration, project folder hash. Does NOT capture: prompt content, response content, code, file contents, tool call arguments.

2. **Enterprise Analytics API integration (broad, all products):** Pulls per-user aggregated data across all Claude surfaces (chat, Claude Code, Cowork) via Anthropic's programmatic API. Less granular than hooks (daily/hourly aggregates vs per-turn) but covers everything, not just Claude Code. Requires customer to grant admin API access.

Both paths combined give: "We can tell you not just WHAT they spent, but WHY — which tools, which patterns, which sessions were wasteful."

**Data stored per hook event:**
- timestamp
- user_id (anonymizable to employee_number)
- model_used (sonnet/opus/haiku)
- input_tokens, output_tokens, cache_tokens
- tool_names_invoked (not inputs/outputs)
- session_id
- project_folder_hash (not actual path)
- duration_seconds

**Data NEVER stored:**
- Prompt text
- Response text
- File contents
- Code
- Tool call arguments or results

### What the customer sees

**Monthly optimization report (after 30 days of data):**
- Per-user utilization scoring (underutilizing / well-matched / over-capacity)
- Seat-mix recommendation: "Move 12 people from Premium to Standard, save $360/mo with zero interruption risk"
- Top waste patterns identified: "3 users running agent teams on routine tasks — switching to single-session saves $800/mo"
- Model routing insights: "28% of Opus usage is for tasks Sonnet handles equally well — potential $1,200/mo savings"
- Confidence level on each recommendation (low at 1 month, high at 3 months)

**Real-time alerts (within the first month):**
- "User X hasn't used Claude Code in 14 days — Premium seat idle"
- "7 users consistently under 20% utilization of their plan allocation"
- "Team spend is trending 40% above last month — driven by 3 users running parallel agents"
- "Based on current trajectory, 5 users will hit limits by Thursday"

**Ongoing dashboard:**
- Cost-per-project attribution (which initiatives are expensive?)
- Team benchmarks vs similar organizations (if opted into shared data)
- Historical trends beyond Anthropic's 90-day window
- Predicted next-month spend based on patterns

### Critical correction: plan structure differences

**Enterprise plan:** Seat fee + ALL usage billed at API rates. No per-seat plan tiers. No "Max vs Pro" per employee. Optimization focus = reduce wasteful consumption patterns, route models efficiently, identify idle seats.

**Team plan:** Standard ($30/seat) vs Premium ($60/seat) with different token allocations. Optimization focus = match each seat to the right tier based on actual usage. This is where the "recommend downgrade/upgrade" logic applies most directly.

Both segments are valuable. The framing adjusts per segment.

### The data-sharing incentive model

**Private mode (full price):** Customer's data is theirs alone. No contribution to broader benchmarks. Still get their own optimization reports.

**Shared mode (discounted, e.g., 20% off):** Anonymized usage patterns contribute to the broader benchmark database. Customer gets: discount + access to industry benchmarks + better estimates (trained on more data). Aggregation threshold: benchmarks only published when N≥20 companies contribute to a category.

What "shared" means concretely:
- We learn: "Teams of 8 doing SaaS MVPs average X tokens/dev/day on Sonnet"
- We never learn: "Acme Corp's user #4 spent Y tokens on project Z"
- Shared data is aggregated and anonymized before entering the pool

### Why this is defensible

1. **Anthropic provides data but not recommendations.** Their Analytics API shows the bill — it doesn't say what to do about it. We're the "so what" layer.
2. **Once hooks are deployed across a team, switching cost is high.** IT approved it, developers installed it, historical data accumulated. Sticky.
3. **The benchmark database compounds.** Each customer who shares makes every other customer's recommendations better. Network effect.
4. **Granular hooks data exceeds what Anthropic's API provides.** Per-turn, per-tool attribution is ours alone.
5. **FinOps buyers already understand this category.** Flexera, Zylo, Cloudability — same pitch, different domain. Proven market.

### Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Anthropic adds recommendations to their own dashboard | High | Move fast, build benchmark moat, offer cross-provider value (post multi-provider expansion) |
| Hooks adoption friction at enterprise (IT deployment) | Medium | Ship as Claude Code plugin/skill that IT can mandate via settings.json in repo templates. One-line install. |
| "Recommend downgrade" creates Anthropic friction | Medium | Frame as "optimize utilization" and "reduce churn from frustration," not "spend less." Anthropic prefers happy retained customers over frustrated churning ones. |
| 1 month insufficient for high-confidence recommendations | Medium | Ship initial report at 1 month with clear confidence labels. Mark high-confidence recs as requiring 3 months. Be honest. |
| Hooks only capture Claude Code, not chat/Cowork | Low | Analytics API integration covers the gap. Hooks provide depth, API provides breadth. Both together = complete picture. |
| Enterprise Analytics API is in beta, could change | Medium | Hooks-based data is independent and always available. API is additive, not foundational. |
| SOC 2 required for enterprise sales | Expected | Plan SOC 2 Type I for Phase 3 timeline. Use SOC 2-compliant infra (Supabase, Vercel). Budget $15-30K + 4-6 months. |
| Privacy concerns about usage monitoring becoming surveillance | Real | Strong messaging: "We show team-level patterns and cost optimization, never individual productivity scoring." Allow employees to see their own data. Never frame as performance monitoring. |

### Deployment model options

1. **SaaS (recommended for most):** Data stored on our infrastructure. Requires SOC 2 + DPA. Suitable for companies 10-500 people.
2. **Customer-hosted:** Deploy in their cloud (AWS/GCP). Highest security bar. Most complex to support. For regulated industries or 500+ person orgs.
3. **Hybrid:** Data stays in their database instance. Our app connects read-only. Middle ground for security-sensitive but non-regulated companies.

### Pricing considerations (preliminary)

Aligned with the Model 4 revenue structure from the iteration log:
- Team tier ($99/mo per company, up to 5 seats) gets basic utilization scoring
- Enterprise tier ($499-$2,000/mo) gets full optimization pipeline: hooks integration, real-time alerts, monthly reports, benchmark access, dedicated support

Value justification: A 50-person team on mixed Premium/Standard seats at ~$2,500/mo Claude spend. A 20% optimization = $500/mo saved. Tool pays for itself in month 1 at the $499 tier.

### Dependencies

- Hooks infrastructure must be built in Phase 1-2 (for the consumer accurate-tracker tool)
- SOC 2 readiness needed before first enterprise pilot
- Enterprise Analytics API access requires customer to provision admin key
- Benchmark database needs 20+ contributing companies before benchmarks are publishable

---

## Idea 2: Anthropic Change → Auto Re-Estimate Pipeline (Team/Enterprise)

**Status:** Approved
**Date approved:** May 24, 2026
**Proposed phase:** Phase 2-3 (builds on change detection infrastructure from MVP + enterprise optimization pipeline from Idea 1)

### Summary

Every time Anthropic changes pricing, rate limits, tokenizer behavior, or plan structures, Team and Enterprise admins get a one-click "re-estimate" action that recalculates their entire team's optimization report against the new reality. The app becomes the place you go when Anthropic changes things — your certainty layer in a constantly shifting environment.

Each change also generates content (blog post, newsletter, SEO surface) that drives users back to the product. Anthropic's volatility — which they show no signs of stopping — becomes our recurring engagement engine.

### The core insight

Anthropic changes things constantly and unpredictably:
- Opus 4.7 tokenizer: +35% tokens for same text (April 2026)
- Peak-hour throttling rolled out without warning
- Rate limits silently reduced (January 2026 revolt)
- Bonus periods appear and expire
- Plan structures evolve (Enterprise billing model changed)
- New models launch with different cost profiles

Every one of these changes invalidates existing estimates and team optimization reports. Companies currently have no systematic way to respond. They find out from Reddit complaints or when their developers hit walls. By the time they react, they've already overspent or under-provisioned.

### How it works

**Detection layer (already planned in MVP):**
- changedetection.io monitors ~10 key Anthropic pages
- On change detected → webhook fires → new pricing_snapshot created
- AI summarizes what changed and quantifies impact

**Re-estimation layer (the new feature):**

For individual users:
- Notification: "Anthropic changed X on [date]. Your estimate from [date] may now be Y% off."
- One-click button: "Re-estimate with current pricing"
- Shows before/after comparison: "Your project now costs ~15% more due to tokenizer change. Here's what changed and 2 actions to offset it."

For Team/Enterprise admins:
- Dashboard alert: "Anthropic pricing change detected. Your team's optimization report is stale."
- One-click "Re-optimize": recalculates entire team's seat-mix recommendation, cost projections, and utilization scoring against new parameters
- Generates a diff report: "Under old pricing, your recommended config was X at $Y/mo. Under new pricing, recommended config is Z at $W/mo. Net impact: +$300/mo unless you [specific action]."
- Optional: auto-notify affected team members with personalized impact summary

**Content layer (marketing engine):**
- Each detected change auto-drafts a blog post (human-edited before publish)
- Newsletter sent to subscriber list: "What [change] means for your Claude spend"
- SEO surface: every change = a new indexed page answering the exact query people will search
- Social post template generated for quick sharing

### What the admin sees in their dashboard

**When a change is detected:**

```
⚠️ Anthropic Change Detected — May 15, 2026

What changed: Opus 4.7 tokenizer now produces ~35% more tokens for equivalent input text. Per-token pricing unchanged.

Impact on your team:
- 8 developers using Opus regularly
- Estimated monthly cost increase: +$1,840/mo if usage patterns unchanged
- 3 developers can switch to Sonnet for affected tasks with no quality loss

Recommended actions:
1. Move routine refactoring from Opus → Sonnet (saves ~$1,200/mo)
2. Update team CLAUDE.md to prefer Sonnet for [task types] (saves ~$400/mo)
3. No action needed for 5 devs using Opus for architecture work (justified)

[Re-optimize team plan →]  [Dismiss]  [View full analysis]
```

**After clicking "Re-optimize":**

Updated seat-mix recommendation recalculated against new pricing reality. Before/after cost comparison. Specific per-user recommendations if plan tiers should change (Team plan Standard ↔ Premium shifts). Projected savings if recommendations followed.

### Why this is high-value

1. **Sells certainty in uncertainty.** The pitch is: "Anthropic will keep changing things. You can either find out from frustrated developers, or find out from us with a plan already ready."

2. **Recurring engagement without you pushing.** Anthropic triggers the engagement for you. Every change = users come back, interact, generate data, see value.

3. **Data flywheel.** Every re-estimation is a new data point. You learn: "When Anthropic changed X, teams of size Y adjusted by doing Z." Over time you can predict the right response to changes before companies even ask.

4. **Stickiness multiplier on Idea 1.** The optimization pipeline (Idea 1) is already valuable at rest. This makes it valuable in motion — it's not just "optimize once" but "stay optimized continuously." Subscription value justified month over month.

5. **Content marketing on autopilot.** The detection infrastructure you're already building for the product also generates your marketing content. Zero incremental effort per piece — just edit and publish.

6. **Competitive moat vs Anthropic building it themselves.** Anthropic will never publish "here's how our change hurts you and what to do about it." That's your exclusive angle. They can't be the honest broker about their own pricing decisions.

### Technical implementation

**Built on existing infrastructure:**
- Change detection: already planned (changedetection.io, ~$5/mo)
- Pricing snapshots: already in the data model
- Estimation engine: already built for individual estimates
- Team optimization: already planned in Idea 1

**New components needed:**
- Batch re-estimation endpoint: takes a team's stored estimates + new pricing_snapshot → recalculates all
- Diff report generator: compares old vs new optimization recommendations, surfaces meaningful changes
- Admin notification system: email + in-app alert when change affects their team
- Content auto-drafting: Claude API call with change summary → draft blog post (human reviews)
- Before/after visualization component in dashboard

**Computational cost of re-estimation:**
- Individual re-estimate: ~$0.003-0.01 (one API call for feature extraction is cached, just recalculate with new multipliers)
- Team of 50 re-estimate: 50 × arithmetic recalculation = <100ms total (no API calls needed if features already extracted)
- The expensive part (Claude API extraction) was already done at original estimate time. Re-estimation against new pricing is pure arithmetic on stored features. Essentially free.

### For Enterprise specifically

Even though Enterprise doesn't have seat tiers to optimize, the re-estimate tool is still valuable:
- "New tokenizer means your team's projected monthly spend increases from $12K to $16K"
- "Here's how to offset: route these 3 task types to Sonnet instead of Opus"
- "Your prompt caching strategy needs updating — cache TTL changes affect your hit rate"
- "New model (Sonnet 4.7) available — for your team's workload profile, switching saves ~$2K/mo at equivalent quality"

Enterprise value = cost predictability and proactive response to changes, not seat shuffling.

### Frequency of Anthropic changes (justifies the feature)

Based on research, Anthropic has made significant changes approximately every 4-6 weeks in 2025-2026:
- Model releases (new tokenizers, capabilities, pricing)
- Rate limit adjustments
- Plan structure changes
- Feature additions that affect token consumption
- Peak-hour policy changes

This means the re-estimate feature triggers roughly monthly — frequent enough to demonstrate ongoing value, infrequent enough that it doesn't become noise.

### Pricing implications

This feature justifies recurring subscription pricing for Team/Enterprise tiers. The value proposition shifts from "optimize once" to "stay optimized continuously." Monthly subscription is natural — you're paying for ongoing certainty, not a one-time report.

Strengthens the case for:
- Team tier at $99/mo (includes change alerts + re-optimization)
- Enterprise tier at $499-$2,000/mo (includes proactive change management + impact analysis)

### Dependencies

- Change detection infrastructure (MVP, already planned)
- Pricing snapshot system (MVP, already planned)
- Team optimization pipeline (Idea 1)
- Stored feature extraction from original estimates (core architecture)
- Admin notification system (new, but standard SaaS pattern)
- Content management workflow (new, but lightweight — just a Claude API call + human review)

---

## Idea 3: Accurate Claude Code Tracker (Wedge Product — "Phase 0")

**Status:** Approved — REVISED May 25, 2026 (see Idea 8 for updated build spec)
**Date approved:** May 24, 2026 (original), May 25, 2026 (revised)
**Proposed phase:** Phase 0 — build BEFORE the estimator, ship first
**Full research:** See `jsonl-bug-opportunity-deep-dive.md`
**Note:** The original spec below is preserved for reference. The revised build spec incorporating Guardian foundations, stickiness features, and referral mechanics is in **Idea 8**.

### Summary

Ship the first accurate Claude Code usage tracker by reading the statusbar context data (which matches billing exactly) instead of the broken JSONL logs that every existing tool uses. Use this as the wedge product to build audience, trust, and the data moat that feeds the estimator.

### Follow-Up Analysis

#### Q1: If this is so easy, why hasn't anyone done it?

Several people have gotten close. Nobody has assembled the whole thing. Here's why:

**Magnus Gille discovered the bug and built the accurate reader — but aimed it at energy monitoring, not usage tracking.** His claude-code-energy-monitor reads the statusbar data correctly and he published the definitive research proving JSONL is broken. But his tool shows energy consumption estimates (kWh, CO2), not cost/token analytics. He solved the data problem but built a niche product on top of it. His repo has modest adoption — it's not competing with ccusage because it's not trying to.

**The ccusage ecosystem is architecturally locked to JSONL.** ccusage (43K weekly downloads) was built from the ground up to parse JSONL files after the fact. Switching to statusline data would require a fundamentally different architecture — an active process running during sessions, not a post-hoc log reader. The maintainer filed an issue asking Anthropic to fix JSONL upstream rather than rebuilding. This is rational for them (why rewrite your tool when the platform should fix the bug?) but it leaves the gap open.

**The statusline ecosystem focuses on display, not analytics.** There are 10+ statusline projects (ccstatusline, claude-code-statusline, ClaudeCodeStatusLine, claude-statusline-powerline, etc.). They all focus on making the terminal status bar look beautiful — showing tokens, model, git info in real-time. None of them log the data to build analytics, historical trends, or a web dashboard. They consume the accurate data and throw it away after displaying it.

**The bug is only 3.5 months old.** The research was published February 24, 2026. In that time the community has been: (1) absorbing the shock, (2) adding warnings to their tools, (3) filing feature requests with Anthropic, and (4) waiting. No one has yet said "forget waiting — I'll build the right thing from scratch."

**It's a product gap, not a technical gap.** The technical pieces all exist: statusline API (documented), accurate data (proven), local logging (trivial). What doesn't exist is someone who combines accurate data + analytics + dashboard + distribution + a plan to turn it into a business. That's the missing piece — not code, but product vision.

**So yes: perfect timing + the right ambition.** Someone eventually will. The question is whether you get there first. The window is 3-12 months based on Anthropic's likely fix timeline.

#### Q2: Critical reasons NOT to pursue this

Being honest about the risks:

**1. It's a feature, not a company.** An accurate token tracker alone is a nice open-source tool, not a sustainable business. It only makes strategic sense as the wedge into the larger estimator/optimizer product. If you build just this and stop, you've built a free tool that helps people but doesn't generate revenue or defensible IP. You need to treat it explicitly as Phase 0 of the larger vision, not a standalone project.

**2. Anthropic could fix JSONL or ship native analytics at any time.** If they push the "final values" fix (a few lines of code on their end) tomorrow, every existing tool instantly gets accurate data and your advantage evaporates. Probability of fix in <3 months: ~15%. In <6 months: ~35%. You're betting on their continued deprioritization.

**3. The statusline API is undocumented and could change.** The JSON payload piped to statusline commands isn't a versioned public API. Anthropic could change the field names, structure, or behavior in any update. You'd need to monitor for breaking changes and adapt quickly. This is manageable but adds ongoing maintenance.

**4. Statusline only works during active sessions.** Unlike JSONL (which you can analyze days later), statusline data must be captured in real-time while Claude Code is running. If the user forgets to set up the script, or starts a session before configuration, that session's data is lost. This is a meaningful UX limitation vs tools that can retroactively analyze all historical sessions.

**5. It may cannibalize your estimator launch.** If people see WTClaude as "that token tracker," it might be harder to reposition as "the estimation + optimization platform." Mitigate by always framing the tracker as "step 1 of understanding your Claude usage" with the estimator as the natural next step.

**6. Vercel Hobby plan prohibits commercial use.** You'd need Vercel Pro ($20/mo/developer) for a commercial web dashboard. Not a dealbreaker but a cost from day one.

#### Q3: Free for everyone, or gate some of it?

**Recommended: Free core, gated premium.** Here's the split:

**Free forever (the moat-building layer):**
- The statusline script itself (open-source)
- Local CLI with accurate daily/weekly summaries
- Basic web dashboard showing current day + last 7 days
- The "vs JSONL" comparison view (your marketing hook — shows them the 100x discrepancy)
- Opt-in data sharing toggle

**Gated (Pro, $9/mo — later, not at launch):**
- Full history (30/90/365 days)
- Per-project cost attribution
- Model routing analysis ("you used Opus for X tasks where Sonnet would've been 60% cheaper")
- Export to CSV/PDF
- Change impact alerts (when Anthropic changes things)
- Personal optimization recommendations
- Team aggregation view

**Don't gate anything at launch.** Ship 100% free. Your goal in the first 60 days is users and data, not revenue. Gate features only after you have 5,000+ active users and have proven the value. The users who've been using it free for 2 months will convert at higher rates than cold signups.

#### Q4: How to get people to opt in to share data?

This is the critical question for the moat. Here are the incentive layers, from most to least effective:

**1. Unlock benchmarks (most effective).** "See how your usage compares to developers with similar projects." This is genuinely useful AND requires shared data to exist. You can't show benchmarks if nobody shares. Frame it as: "Turn on sharing → unlock community insights." The value is immediate and obvious.

**2. Accuracy improvement.** "When you share, our estimates get better for everyone — including you. Your next project estimate will be based on real data from [N] developers, not guesses." This appeals to the community-minded developer who already contributes to open-source.

**3. Free Pro features / credits.** "Share your anonymized usage data → get 3 months of Pro free." This is the classic "pay with data" model. Works well for users who want premium features but don't want to pay cash yet. Credits toward the estimator's paid tier once it launches would also work.

**4. Visibility / status.** tokscale already proved developers will share usage data for a leaderboard and contribution graph. The "I burned 2M tokens this week" badge has social currency in the Claude Code community. Consider: anonymized sharing as default, public profile as opt-in extra.

**5. The privacy-first framing.** Make it crystal clear what's shared: token counts, model selection, session duration, cache rates. Never: prompts, code, file names, project details. Show users a preview of exactly what their shared data looks like before they opt in. Transparency drives trust.

**Estimated opt-in rate:** Based on comparable developer tools, 30-50% of active users will opt in if the value exchange is clear and immediate. With the benchmarks unlock, possibly 50-60%.

#### Q5: Operating costs at different user levels

**Infrastructure: Supabase (database) + Vercel (dashboard) + optional VPS (changedetection)**

Data volume per user per active day: statusline fires ~200-500 times per active session. Each JSON payload ~500 bytes. An active developer averaging 6 hours/day generates ~250KB-500KB of raw data per day. Aggregated to hourly/daily summaries for storage, this compresses to ~5KB/user/day stored.

| Users (monthly active) | Database storage | Edge function calls | Bandwidth | Infra cost/month | Marginal cost/user |
|---|---|---|---|---|---|
| 100 | ~15MB | ~30K | ~1GB | **$0** (free tiers) | $0 |
| 1,000 | ~150MB | ~300K | ~5GB | **$0** (free tiers) | $0 |
| 5,000 | ~750MB | ~1.5M | ~20GB | **$45** (Supabase Pro $25 + Vercel Pro $20) | $0.009 |
| 10,000 | ~1.5GB | ~3M | ~40GB | **$55** (Supabase Pro + Vercel Pro + bandwidth) | $0.0055 |
| 50,000 | ~7.5GB | ~15M | ~150GB | **$150-200** (Supabase Pro + Vercel Pro + bandwidth overages) | $0.003-0.004 |
| 100,000 | ~15GB | ~30M | ~300GB | **$300-500** (may need Supabase Team $599 for performance) | $0.003-0.005 |

**Key takeaway:** You're at $0/month until ~2,000 users. Under $50/month until 5,000. Under $200/month until 50,000. This is an absurdly cheap product to operate. The Claude API cost for the estimator (when it launches) will dwarf infrastructure costs.

**Not included above:** Domain (~$15/year), email service for notifications (free tier of Resend/Postmark covers thousands of emails), changedetection.io VPS (~$5/month).

#### Q6: How long to vibe code this?

Assuming Claude Code with Sonnet, a React + Vite + Tailwind stack, and Supabase backend:

| Component | Estimated vibe-coding time | Notes |
|---|---|---|
| Statusline script (Python/bash) | 2-4 hours | ~200 lines. Receives JSON, appends to local log. Magnus Gille's repo is MIT-licensed reference. |
| CLI reader (show today/week/month) | 4-6 hours | Read local log, aggregate, format output. Straightforward data processing. |
| Supabase schema + edge functions | 3-4 hours | Tables for users, sessions, daily_summaries. Edge function receives synced data. |
| Web dashboard (React + Vercel) | 2-3 days | Daily/weekly charts, model breakdown, cost estimate, "vs JSONL" comparison view. |
| Sync mechanism (local → cloud) | 4-6 hours | Opt-in. Statusline script or separate cron POSTs summaries to Supabase edge function. |
| Install flow + docs | 4-6 hours | Clear README, one-command install, settings.json snippet, screenshots. |
| "vs JSONL" comparison feature | 3-4 hours | Read JSONL files, show side-by-side with accurate data. The marketing hook. |
| Polish, testing, edge cases | 1-2 days | Handle: new sessions, multiple projects, model switches mid-session, /compact events. |

**Total: 7-10 days of focused vibe coding.** With Claude Code doing the heavy lifting, the code itself is straightforward. The time goes into: getting edge cases right, making installation dead simple, and polishing the dashboard.

If you want something postable to Reddit in the absolute minimum time: the statusline script + CLI (no web dashboard) is 2-3 days. Post the "100x wrong" reveal with just a CLI tool, iterate the web dashboard based on feedback.

#### Q7: The current broken UX (what a developer sees today)

Here's the experience of a developer using ccusage today, step by step:

**Morning:** Developer starts Claude Code, works on a feature for 3 hours. Uses Opus for architecture decisions, Sonnet for implementation. Runs 4 MCP servers. Has a few retry loops. Hits a rate limit warning once.

**End of day:** Wants to know what that cost. Runs `bunx ccusage daily` in terminal.

**What ccusage shows them:**
```
Date: 2026-05-24
Input tokens:     12,847
Output tokens:    58,203
Cache read:    2,145,302
Cache write:     189,450
Total tokens:  2,405,802
Estimated cost:     $3.42
Models: opus-4-7 (35%), sonnet-4-6 (65%)
```

**What they think:** "Okay, $3.42 today. Not bad. I'm well within my Max plan limits. Opus is a bit expensive but manageable."

**What actually happened:**
```
Actual input tokens:    1,284,700   (100x what they saw)
Actual output tokens:     987,446   (17x what they saw — includes thinking)
Cache read:             2,145,302   (this one was correct)
Cache write:              189,450   (this one was correct)
Total tokens:           4,606,898   (1.9x the total they saw)
Actual equivalent cost:    $18.70   (5.5x what they estimated)
```

**The decisions they make on bad data:**
- "I don't need to optimize — $3.42/day is fine" → Actually $18.70/day, optimization would save real money
- "Opus isn't that expensive for my use" → Opus thinking tokens are invisible in JSONL; actual Opus cost is 3x what they see
- "My Pro plan should be enough" → It absolutely isn't; they're burning through it 5x faster than they think
- "My team of 5 probably costs ~$500/mo" → Actually ~$2,800/mo; their budget projection is wrong by 5x
- "I'll tell my boss we need Max 5x" → They actually need Max 20x, and they'll hit limits in week 1 and blame the tool

**The emotional sequence:**
1. Check ccusage → feel informed, feel in control
2. Hit rate limit unexpectedly → confusion ("but ccusage said I only used $3?!")
3. Check Anthropic's usage page → completely different numbers → more confusion
4. Post on Reddit: "My usage tracker says I used barely anything but I hit limits??"
5. Someone links the gille.ai article → realize all their data was wrong → "WTF"
6. Lose trust in tracking tools → go back to flying blind → frustration loop restarts

**This is exactly the moment your tool intercepts.** You catch them at step 5 or 6 with: "Here's why your numbers were wrong, and here's the tool that gives you the real ones."

---

## Idea 4: Gamification Layer — Leaderboards, Seasons, Prizes, Badges

**Status:** Approved (placeholder — to be fleshed out later)
**Date approved:** May 25, 2026
**Proposed phase:** TBD

### Summary

Add gamification mechanics to the product to drive engagement, retention, and community. Initial concepts include:

- **Leaderboards** — usage efficiency rankings, cost savings rankings, community contributions
- **Seasons** — time-bounded competitive periods (monthly/quarterly) with fresh starts and themed challenges
- **Prizes** — rewards for top performers, milestones, or community contributions
- **Badges** — achievement system for usage milestones, optimization wins, data sharing, streaks, etc.

### Notes

Details to be defined in a future session. tokscale (2.3K GitHub stars) already uses a gamified angle with leaderboards and contribution graphs — validates that developers respond to gamification in this category.

---

## Idea 5: Adjacent Feature Opportunities (10 features)

**Status:** Approved (batch — individual features to be scheduled during build planning)
**Date approved:** May 25, 2026
**Source:** Market research report, Section 4

### Quick Wins (buildable in days, high perceived value)

**5a. Prompt Caching Opportunity Finder**
"Your system prompt is 4,000 tokens and you're not caching it. Enabling caching would save $X/month." Directly actionable savings recommendation. Data already available from tracking.

**5b. Model Recommender**
"Based on your project description, here's which Claude model to use for each task." Already implicit in the estimation engine; surface it as a standalone feature.

**5c. API vs. Subscription ROI Calculator**
"Based on your usage, you'd save $X/month switching from Max to API (or vice versa)." High-value decision tool, pure arithmetic.

### Medium Lift (buildable in weeks, strong differentiation)

**5d. MCP Server Cost Calculator**
"Your 4-server setup adds ~7,000 tokens per turn. Here's which tools are unused and costing you." Unique value leveraging MCP overhead research data.

**5e. Agent Workflow Cost Simulator**
"Before building a multi-agent system, estimate total cost: orchestrator + N workers × M turns." Addresses the documented 7x cost multiplier for agent teams.

**5f. Budget Alerts and Forecasting**
"At your current pace, you'll hit $X by end of month." Natural extension of tracking, high retention driver.

### Enterprise Features (buildable in weeks-months, revenue drivers)

**5g. Team Usage Dashboards**
Shareable usage analytics without exposing prompt content. Engineering manager must-have.

**5h. Invoice Reconciliation**
"Does your Anthropic bill match what you actually used? Here's discrepancies." Enterprise trust-builder.

**5i. Prompt Cost Optimizer**
"Paste your prompt, see estimated cost. Here's a cheaper version." Requires Claude API call per optimization, but high perceived value.

**5j. Claude Code Settings Optimizer**
"Your current model/permission settings cost X. Switching to Y saves Z with no quality loss." Deep Claude Code intelligence, hard for competitors to replicate.

---

## Idea 6: Guardian — Real-Time Rate Limit Intelligence (Subscription Feature)

**Status:** Approved
**Date approved:** May 25, 2026
**Proposed phase:** Phase 1 (core subscription offering for individual users)

### Summary

Guardian is the always-on, continuous monitoring layer that justifies a $2-3/month individual subscription. It solves the problem that usage estimation stabilizes but session-level burn rates never do — as proven by the March 2026 rate limit crisis where users across all paid tiers had sessions drain 10-20x faster than expected with zero visibility until lockout.

### Core Guardian Features ($2-3/month)

- **Real-time burn rate monitoring** — tracks token consumption via statusline data as you work
- **Predictive limit alerts** — "At your current pace, you'll hit your session limit in 47 minutes. Consider switching to Haiku for tool calls or pausing until window refreshes."
- **Anomaly detection** — "That prompt consumed 7% of your session quota (10x your normal rate). Possible caching issue or context explosion."
- **Optimal timing recommendations** — sliding 5-hour window tracking, peak vs. off-peak planning, session scheduling
- **Weekly digest** — 30-second read, always different, one actionable recommendation (the retention anchor)
- **Monthly deep intelligence report** — full trends, waste identification, model recommendations, caching opportunity analysis, MCP overhead breakdown
- **Multi-channel notifications** — Telegram, Discord, WhatsApp, email, or desktop companion app (menu bar / system tray widget showing current burn rate and time-to-limit)
- **Cost-per-project attribution** — "Project A: $12.40, Project B: $67.80, Project C: $3.20"
- **Prompt efficiency analysis** — token efficiency scoring, specific compression recommendations
- **MCP overhead tracking** — which servers are loaded but unused, per-turn cost of each
- **Session autopsy / "Why did I burn so much?"** — when a session drains significantly more than expected, Guardian explains why. Live alert version: "That session just consumed 34,000 tokens (4x your average). Breakdown: 41% tool call overhead (5 MCP servers loaded), 28% context reprocessing (large file in context), 22% model responses, 9% system prompt. The big driver was your GitHub MCP server triggering 12 tool calls." Post-session version: tap any session in your dashboard to see the full cost autopsy — per-turn token breakdown, what spiked, what was normal, and what you could change next time. Turns "WTF just happened" into an actionable answer in seconds.

### Why It's Sticky (the YNAB parallel)

YNAB charges $9/month for personal finance intelligence. Users save $600 in the first 2 months. They don't cancel because money is always flowing, something is always different, and ignoring it feels irresponsible.

Guardian at $2-3/month is the same model for AI spend. Tokens are always flowing, sessions are always variable, anomalies are unpredictable (March 2026 proved this), and one prevented limit-hit per month saves hours of productivity worth far more than $3.

Estimation stabilizes. Real-time monitoring never does.

---

## Idea 7: Revised Individual Pricing Model (Free / Guardian / Credits)

**Status:** Approved
**Date approved:** May 25, 2026
**Supersedes:** The $9/month Pro tier from the original market research report

### Strategic Principle

Free features serve three purposes: (1) bring users back regularly, (2) generate data for the moat, (3) create informed buyers who understand what Guardian protects. Episodic value is free. Continuous value is Guardian.

### Free Tier (episodic value — drives return visits, data collection, and conversion)

- Accurate usage tracker (the Phase 0 wedge)
- **Unlimited estimates** — every estimate trains the heuristic engine and feeds the archetype database. Gating estimates would be penny-wise, pound-foolish. API cost per estimate: $0.004-0.013.
- **Teaching mode** — contextual optimization tips on every estimate. Makes users smarter about costs → makes them more likely to want Guardian, not less. Creates informed buyers.
- **Change alerts** — when Anthropic changes pricing, models, or limits. Infrequent (2-6x/year significant changes), low cost, high return-visit value. Each alert is a natural Guardian upsell moment: "Guardian users got real-time adjustments before this alert went out."
- **Monthly summary report (lite version)** — high-level overview of the month's usage: total tokens, total estimated cost, top-line trend vs. previous month. Enough to be useful and bring users back monthly, but without the deep intelligence, waste identification, optimization recommendations, or per-project breakdowns that Guardian provides. Another conversion tool — the lite report shows you WHAT happened; Guardian tells you WHY and WHAT TO DO about it.
- Raw usage dashboard

### Guardian Tier ($2-3/month — continuous, always-on value)

Everything in Free, plus:
- Real-time burn rate monitoring
- Predictive limit alerts
- Anomaly detection
- Optimal timing recommendations
- Weekly digest (the retention anchor — 30 seconds, always different, always actionable)
- **Monthly deep intelligence report** — full trends, waste identification, model recommendations, caching opportunities, MCP overhead analysis, per-project cost attribution, efficiency scoring. Significantly richer than the free lite summary.
- Multi-channel notifications (Telegram, Discord, WhatsApp, email, desktop companion)
- Cost-per-project attribution
- Prompt efficiency analysis
- MCP overhead tracking and unused server alerts

### Credits (a la carte — for non-subscribers wanting occasional premium features)

- Detailed multi-phase project estimates with confidence intervals
- Deep prompt optimization (AI-powered rewrite for efficiency)
- Custom reports
- Credit packs: 5 for $3, 12 for $5, 30 for $10 (no expiry)

### Team Tier ($15-25/seat/month)

- Everything in Guardian for each seat
- Team-wide dashboards and analytics
- Seat-mix optimization (Standard vs. Premium recommendations)
- Budget alerts and forecasting
- Shared estimates and team benchmarks

### Enterprise Tier ($2K-5K/month or % of savings)

- Everything in Team
- Dedicated analytics and custom integrations
- Invoice reconciliation
- Cross-team benchmarking
- API access
- Data stays in customer's infrastructure (optional)

### Revenue Model Validation

- Guardian at $2-3/month: even 3% conversion of free users is profitable given operating costs of $71/month at 1K MAU
- Free tier costs ~$0.004-0.013 per estimate in API calls — negligible vs. data moat value
- Monthly lite reports cost near-zero (computed from data already collected)
- Team/Enterprise tiers carry the majority of revenue long-term
- Individual Guardian subscriptions provide steady baseline + proof of consumer demand

---

## Idea 8: Revised Phase 0 Build Spec (Supersedes original Idea 3 build plan)

**Status:** Approved
**Date approved:** May 25, 2026
**Proposed phase:** Phase 0 — ship first, before everything else
**Supersedes:** The build plan in Idea 3 (original spec preserved there for reference)
**Context:** Revised to incorporate Guardian foundations, stickiness features, referral mechanics, gamification seeds, and the revised pricing model (Idea 7)

### What Changed from the Original Phase 0

1. **Data architecture is richer.** Original stored aggregated daily summaries. Revised stores per-turn data (model, input/output/cache tokens, tool names, timestamp) from day one. This is because Guardian (Idea 6) needs per-turn granularity for session autopsy, anomaly detection, and predictive alerts. Building with daily aggregates and rearchitecting later would be a costly mistake. Storage cost increase is minimal.

2. **Free tier is much more generous.** Per the revised pricing model (Idea 7), the free tier now includes unlimited estimates (Phase 1), teaching mode, change alerts, and a monthly lite report. Phase 0 doesn't include estimates (that's Phase 1), but the monthly lite report and teaching-layer hooks should ship in Phase 0 since they're computed from tracking data that's already there.

3. **Referral and virality are designed in from day one, not bolted on.** The "vs JSONL" comparison is now a shareable card. Invite links, leaderboards, and badges ship at launch or within 2 weeks, not "TBD."

4. **Guardian foundations are laid.** The data model, notification infrastructure, and baseline computation all start in Phase 0, so Guardian can launch on top of existing data without migration.

### Phase 0 Feature Spec

#### Core (must-ship, non-negotiable)

**Statusline script (per-turn granularity)**
- Receives JSON payload from Claude Code's statusline command
- Captures per-turn: timestamp, model_used, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tool_names_invoked, session_id, project_folder_hash
- Appends to structured local log (not just session summaries)
- MIT-licensed, ~200-300 lines
- Reference: Magnus Gille's claude-code-energy-monitor for statusline data structure

**CLI reader**
- `wtclaude today` / `wtclaude week` / `wtclaude month` / `wtclaude project <name>`
- Accurate summaries with model breakdown and cost estimates
- "What if" mode: `wtclaude whatif --plan=pro` / `wtclaude whatif --model=haiku` — shows what the same sessions would have cost under different plans/models. Creates awareness of optimization opportunities.
- Daily debrief output: end-of-day summary with costliest moment, tip of the day

**"vs JSONL" comparison**
- `wtclaude compare` — reads both JSONL and statusline data, shows side-by-side
- The core marketing hook: "ccusage says $3.42. Reality: $18.70."
- **Shareable comparison card generator** — produces a visual card (PNG or HTML) showing the discrepancy. One-click copy to clipboard. Designed for Reddit/Twitter/HN posting.
- **"Check your real numbers" invite link** — generates a personalized link a user can send to colleagues. Links to landing page with install instructions and automated comparison.

**npm package**
- `npx wtclaude` — one-command install and first run
- Direct competitor to ccusage's distribution (43K weekly npm downloads)

**Web dashboard (cloud sync, opt-in)**
- Daily/weekly/monthly views with charts
- Model breakdown, cost estimates, project attribution
- **Session timeline view** — Strava-style visual of each session: token consumption per turn, model switches, tool calls, cost spikes plotted on a timeline. Inherently interesting and shareable. Developers look at this the way runners look at pace charts. Naturally surfaces "oh, THAT turn is where it went" insights.
- "vs JSONL" comparison view (always accessible)
- Responsive, clean, fast

**Supabase backend**
- Tables: users, sessions, turns (per-turn data), daily_summaries, badges, leaderboard
- Edge functions for data sync, comparison card generation
- Designed to support Guardian queries (anomaly baselines, burn rate computation) without schema changes later

**Install flow + docs**
- Clear README with the JSONL bug story front and center
- One-command install, settings.json snippet, screenshots
- "60 seconds to accurate data" onboarding

#### Stickiness Features (ship at launch or within 1 week)

**Daily Debrief**
- 30-second end-of-day summary: "Today: 4 sessions, 340K tokens, ~$X. Costliest moment: 2:15 PM (context reprocessing after large paste). Tip: use /compact before large context switches."
- Delivered via terminal output (default), email (opt-in), or preferred notification channel
- This is the free proto-Guardian — gets users hooked on the intelligence format
- Computed from per-turn data already collected, zero incremental cost
- Guardian upgrade path is obvious: "Want this in REAL TIME instead of end-of-day? That's Guardian."

**Monthly Lite Report**
- High-level overview: total tokens, total estimated cost, top-line trend vs. previous month, most-used model, busiest day
- Enough to be useful and bring users back monthly
- NOT the deep intelligence of Guardian's monthly report (no waste identification, no per-project breakdown, no optimization recommendations, no efficiency scoring)
- Delivered via email, brings users back to dashboard
- Conversion tool: "Want to know WHERE the waste is and WHAT to do about it? Upgrade to Guardian."

**"What If" Mode**
- Available in CLI and dashboard
- "If you'd been on [different plan], this month would have cost $X instead of $Y"
- "If you'd used Haiku for tool calls and Sonnet for reasoning, you'd have saved 40%"
- Creates optimization awareness without gating it — every "what if" that shows savings nudges toward Guardian

**Personal Badges / Milestones**
- Lightweight gamification from day one
- "First 100K tokens tracked" / "First week streak" / "1M tokens tracked" / "Most efficient session of the month" / "Ran comparison — truth revealed"
- Zero cost to implement, micro-dopamine hits, shareable
- Foundation for full gamification layer (Idea 4: seasons, leaderboards, prizes)

#### Referral Features (ship within 2 weeks of launch)

**Shareable Comparison Card**
- Generated when user runs "vs JSONL" comparison
- Visual card: "ccusage: $3.42/day. Reality: $18.70/day. Your tracker has been lying to you."
- One-click share: clipboard, Twitter, Reddit
- Every share is an acquisition event
- THIS is the primary referral mechanic — it's surprising, personal, provably true, and makes people want to check their own numbers

**"Check Your Real Numbers" Invite Link**
- User generates a personalized link to send to colleagues/friends
- "I just found out my Claude Code tracker was 100x wrong. Check yours: [link]"
- Links to landing page → install flow → automated comparison → "wow" moment → new user
- Referral tracking: know who invited whom (future: referral rewards)

**Basic Leaderboard**
- Opt-in users only (requires data sharing toggle)
- Sortable by: total tokens this week/month, efficiency score, cost savings from optimizations
- Creates competition and social proof
- tokscale proved developers compete on token usage — build this from launch, not deferred
- Incentive to opt in: "See how you compare" unlocks when sharing is enabled

**Team Comparison (opt-in)**
- Invite specific people to compare usage
- "I'm more efficient than you this week" — shareable, competitive, fun
- Seeds the team features that come with the paid Team tier later

### Revised Build Timeline

| Component | Time Estimate | Notes |
|-----------|--------------|-------|
| Statusline script (per-turn granularity) | 4-6 hours | ~300 lines. Per-turn capture, not just session summaries. |
| CLI reader + "what if" mode + daily debrief | 6-8 hours | Core CLI commands plus intelligence output |
| Supabase schema + edge functions | 5-7 hours | Per-turn tables, badges, leaderboard, designed for Guardian |
| Web dashboard + session timeline | 3-4 days | Charts, timeline view, comparison view, badges, leaderboard |
| Sync mechanism (local → cloud) | 4-6 hours | Opt-in. POST per-turn summaries to Supabase edge function |
| "vs JSONL" comparison + shareable card | 5-7 hours | Side-by-side comparison, PNG/HTML card generator, share buttons |
| Notification foundation | 4-6 hours | Daily debrief via email/terminal, monthly lite report, invite links |
| Referral mechanics | 4-6 hours | Invite links, shareable cards, "check your numbers" landing page |
| Install flow + docs | 4-6 hours | README with JSONL bug story, one-command install, screenshots |
| Polish + testing + edge cases | 2-3 days | Per-turn edge cases, multiple projects, model switches, /compact |
| **TOTAL** | **10-14 days** | Up from 7-10; extra days buy stickiness + referral mechanics |

### Fastest Path (if speed is priority)

**Days 1-4: CLI + Comparison Card (shippable, postable to Reddit/HN)**
- Statusline script + CLI reader + "vs JSONL" comparison + shareable card
- No web dashboard yet — terminal-only
- Post the "your tracker is 100x wrong" reveal with just the CLI
- Use community reaction to validate before building the full dashboard

**Days 5-14: Full Dashboard + Social Features**
- Web dashboard with session timeline, leaderboard, badges
- Cloud sync, referral mechanics, invite links
- Daily debrief, monthly lite report
- Ship riding the momentum from the CLI launch

### What Phase 0 Explicitly Does NOT Include (deferred to later phases)

- Estimation engine (Phase 1)
- Teaching mode beyond basic tips in daily debrief (Phase 1)
- Change alerts (Phase 1 — requires change detection infrastructure)
- Guardian real-time monitoring and alerts (Phase 1-2, but data foundation is ready)
- Session autopsy (Guardian feature, but per-turn data to support it is being collected)
- Multi-channel notifications beyond email/terminal (Guardian)
- Full gamification: seasons, prizes (Idea 4, later phase)
- Team/Enterprise features (Phase 2-3)
- Multi-provider support (Phase 2+)

### How Phase 0 Sets Up Everything Else

| Phase 0 Foundation | What It Enables Later |
|---|---|
| Per-turn data storage | Guardian anomaly detection, session autopsy, predictive alerts |
| Daily debrief format | Guardian weekly digest + real-time alerts (same format, higher frequency) |
| "What if" mode | Estimation engine's plan recommendation feature |
| Badges infrastructure | Full gamification layer (seasons, prizes, leaderboards) |
| Leaderboard + opt-in sharing | Data moat, benchmarks, team comparison features |
| Shareable comparison cards | Referral flywheel, community growth |
| Notification infrastructure | Guardian multi-channel alerts, change alerts, team notifications |
| "vs JSONL" narrative | Brand identity, content marketing, trust establishment |

### Success Metrics for Phase 0

- **Week 1:** 500+ installs (npm downloads)
- **Week 2:** 2,000+ installs, 100+ opt-in data sharers
- **Month 1:** 5,000+ installs, 500+ active dashboard users, 30%+ opt-in rate
- **Month 2:** 10,000+ installs, Reddit/HN front page, comparison cards being shared organically
- **Guardian readiness:** Enough per-turn data collected to compute meaningful baselines for anomaly detection

---

*Awaiting additional ideas from Peter. File will be merged to main plan only on explicit instruction.*
