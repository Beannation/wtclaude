# Claude Usage Estimator — Technical Feasibility Report

**Date:** May 24, 2026
**Scope:** Full product vision (MVP through v3), Claude/Anthropic ecosystem only
**Methodology:** Deep technical research across Anthropic APIs, community tools, data availability, and architectural patterns

---

## Executive Summary

**The full product vision is feasible. Nothing is impossible.** Several components are trivially easy, several require creative engineering, and two carry ongoing maintenance risk tied to Anthropic's decisions. The hardest problem isn't technical — it's statistical: generating honest confidence intervals with limited training data in the early months.

The research uncovered one genuinely exciting discovery: a known bug in Claude Code's local JSONL logs means the entire community's understanding of their own usage is built on data that's 100x wrong on input tokens. Your app has the opportunity to be the first to correctly educate users — and to offer the first accurate tracking tool as a wedge.

---

## Classification: Easy / Hard / Creative Solution Required

### EASY (Straightforward implementation, well-supported by existing tools)

| Component | Why it's easy | How to achieve best result |
|---|---|---|
| **Free-text → structured features (Claude API)** | Anthropic ships native Structured Outputs (GA). Schema-constrained token generation — literally cannot produce invalid JSON. Pydantic/Zod SDK helpers. | Define a rich JSON schema for project attributes (type, complexity, features[], codebase_size, team_size, skill_level, mcp_count, agent_use). Use Claude Sonnet for extraction — fast, cheap ($3/MTok input), accurate. Add a "confidence" field to the schema so Claude self-reports extraction certainty. Cost: ~$0.003–0.01 per estimate. |
| **Real-time slider UX** | Pure arithmetic on ~10 variables. Sub-millisecond calculation. Standard React patterns. | React state + useMemo for derived estimates. Debounce slider events at 100ms (not 300ms — sliders feel laggy at 300). No Web Workers needed. Use CSS transitions on the output numbers for polish. Each slider maps to a single multiplier in the formula — trivial to make reactive. |
| **Plan recommendation engine** | Deterministic logic. Input: estimated tokens + sessions + user constraints. Output: which plan(s) fit. | Decision tree, not ML. Map total estimated monthly tokens against known plan ceilings. Factor in: session frequency (many short vs few long), model mix (Opus costs 1.67x Sonnet per token), peak-hour exposure. Output a ranked list with reasoning. |
| **Inline teaching tooltips** | Static content triggered by slider values. No backend needed. | Author ~30 contextual tips keyed to slider states. Store as JSON. Show relevant tip when slider crosses threshold (e.g., MCP count > 3 triggers overhead warning). Calculate personalized savings ("For YOUR project, removing 2 MCP servers saves ~36K tokens/turn"). |
| **Basic data schema for feedback loop** | Standard PostgreSQL/Supabase schema. Well-understood pattern. | Tables: estimates (project_description, extracted_features, slider_values, generated_estimate, confidence, user_id, created_at), actuals (estimate_id, actual_tokens, actual_sessions, plan_used, hit_limits, upgraded, submitted_at), users (id, email_hash, plan_type, skill_level, opt_in_sharing). Supabase Row Level Security for privacy. |
| **Email nudge for actuals** | Standard SaaS pattern. Trigger-based email. | Supabase Edge Function or simple cron. Send at day 7 and day 14 post-estimate. Personalize: "Your [project type] estimate predicted X sessions. How did it actually go?" Link directly to a pre-filled form. |
| **Change detection (Anthropic docs)** | changedetection.io — self-hosted, free, CSS selector targeting, API access | Deploy one Docker container monitoring ~10 Anthropic pages (pricing, rate limits, plan comparison, Claude Code costs, enterprise billing). Use CSS selectors to target specific tables/sections. On change detected → trigger webhook → update your pricing data store → notify affected users. Total cost: $5/month on a small VPS. |

---

### HARD (Requires careful engineering, iteration, or ongoing maintenance)

| Component | Why it's hard | Best approach to solve it |
|---|---|---|
| **Heuristic estimation formula (accuracy)** | No ground truth dataset exists. Public data points are sparse and from heterogeneous sources. User skill variance is 3-10x. You're estimating a distribution, not a point. | **Phase 1:** Build a lookup table of ~50 project archetypes derived from all public data points in the handoff doc. Map extracted features to nearest archetype. Output archetype's known range. **Phase 2:** As actuals accumulate (target: 200+), fit a simple Bayesian regression. Use informative priors from the archetype table. **Phase 3:** At 1000+ actuals, move to gradient-boosted trees with the accumulated data. Key insight: the formula doesn't need to be accurate in absolute terms — it needs to be *more useful than what users have today*, which is nothing. Frame as ranges, not points. |
| **Confidence intervals with limited data** | At launch you have zero actuals. Bayesian methods need priors. How do you generate a "confidence: medium" label honestly? | **Creative solution:** Use a *source-weighted confidence model*. Confidence = f(how many public data points match this archetype, how wide the variance is in those data points, how many user-submitted actuals match). At launch, confidence is always "low" or "exploratory" — be honest. As actuals flow in, confidence mechanically increases. Display as: "Based on [N] similar projects, we estimate..." This is honest AND incentivizes users to submit actuals ("help us improve this estimate"). |
| **Mid-project decision helper** | Requires knowing current usage mid-project. Pro/Max users have NO programmatic API access to their remaining limits. | **Three-tier approach:** (1) **Manual entry** — user types their usage % from claude.ai/settings/usage or /status in Claude Code. Friction-heavy but universal. (2) **Claude Code hooks integration** — HTTP hook sends per-turn token data to your backend automatically. Elegant, real-time, but only works for Claude Code users who install the hook. (3) **Browser extension** — reads the usage % from claude.ai/settings/usage page. Technically feasible but maintenance-heavy (DOM changes break it). **Recommendation:** Ship manual entry at MVP. Ship the hooks integration at v2 (it's the best path — accurate, real-time, no scraping). Browser extension only if demand is massive. |
| **Data moat re-training pipeline** | Need to periodically update the estimator as actuals accumulate. Need to handle concept drift (Anthropic changes invalidate old actuals). | Use a simple versioning system: every estimate is tagged with a "pricing_version" (the state of Anthropic's pricing/limits at that time). When Anthropic changes things, start a new version. Only train on actuals from the current version (or weight recent actuals higher). Monthly re-fit with the latest data. At <500 points: simple regression. At 500-2000: gradient-boosted trees. At 2000+: consider neural approaches. Use cross-validation on held-out actuals to measure improvement. |
| **Team/enterprise seat-mix optimization** | Combinatorial problem (N people × M plan types × variable usage profiles). NP-hard in general but small N makes it tractable. | **Not NP-hard at your scale.** For teams of 5-150 people with 3-5 plan options, brute-force enumeration of all combinations is computationally trivial (even 150 people × 5 plans = 5^150 is too large, BUT the real problem is assigning users to ~4 buckets by usage level, then optimizing which plan each bucket gets). Reduce to: cluster users by estimated usage → assign optimal plan per cluster → calculate total cost. This is a simple linear optimization. Output: "3 heavy users → Max 5x, 8 medium users → Team Premium, 4 light users → Team Standard = $X/mo total, saving $Y vs all-Premium." |

---

### CREATIVE SOLUTION REQUIRED (Initially appears impossible, but solvable with lateral thinking)

| Component | Why it seems impossible | The creative solution |
|---|---|---|
| **Accurate token prediction for Pro/Max subscription users** | Anthropic deliberately does NOT publish exact token limits for subscription plans. They publish multipliers only (5x, 20x). The actual token allocation is dynamic, changes with peak hours (1.3-1.5x burn rate during 5am-11am Pacific), and varies by model selection. You literally cannot tell a user "you have X tokens remaining" because Anthropic won't tell anyone what X is. | **Reframe the problem.** Don't predict remaining tokens — predict remaining *productive sessions*. Users don't think in tokens; they think in "can I finish this feature before I hit the wall?" Your estimation becomes: "For this project on Max 5x, you'll likely get 3-5 uninterrupted working sessions per 5-hour window, each ~45 minutes of active prompting." Derive this from community-reported session lengths and the known multiplier ratios. It's imprecise but 10x more useful than what exists. **Second creative move:** Use the hooks integration to *empirically measure* what a "session" costs for users who opt in. After 100 users with hooks installed, you'll have real data on tokens-per-productive-session that no one else has — including Anthropic. This becomes your moat. |
| **Handling the JSONL accuracy bug for tracking** | The community's primary data source (local JSONL logs) is 100x wrong on input tokens. Every tool building on these logs (ccusage, etc.) gives wrong numbers. You can't build reliable tracking on bad data. | **Don't use JSONL for token accounting.** Use it only for metadata (which model was used, how many turns, timestamps, tool calls made). For actual token counts, use the **hooks system** — the Stop event carries the accurate accumulated totals from Claude Code's internal state. Alternatively, use the `/usage` and `/stats` commands' underlying data (the "statusbar context" which IS accurate). **The exciting opportunity:** You could build the first community tool that gets this right. Market it explicitly: "Unlike other trackers, we use Claude Code's internal counters, not the broken JSONL logs." Instant credibility with power users who've been burned by bad data. |
| **Predicting token cost for projects where user skill is unknown** | User skill is the single largest variance factor (3-10x). A beginner doing the same project as an expert uses 3-10x more tokens. You can't know skill level from a project description alone. | **Three-part solution:** (1) Ask directly — include a skill self-assessment slider (beginner/intermediate/advanced/expert). Map to a multiplier. (2) Use the "transparent assumptions" philosophy — show the user: "We're assuming intermediate skill. If you're a beginner, expect 2-3x this estimate. Tap here to adjust." (3) Over time, as actuals accumulate with self-reported skill levels, build a skill-adjusted model. The key insight: **skill uncertainty is actually your best teaching moment.** Show the user: "An intermediate user would use ~15 sessions. A beginner would use ~40. Here's what separates them: [CLAUDE.md setup, plan mode, compact usage]. Want to learn these before you start?" This turns uncertainty into value. |
| **Keeping estimates valid when Anthropic changes things** | Anthropic changes tokenizer behavior (Opus 4.7: +35% tokens for same text), adjusts rate limits without warning, rolls out peak-hour throttling, and modifies plan structures. Your estimates can become stale overnight. | **Architectural solution:** Every estimate is stored with a "pricing_snapshot_id" — a frozen copy of all Anthropic parameters at estimate time. When changedetection.io detects a change → new snapshot created → all estimates made under old snapshots get flagged → affected users get notified: "Anthropic changed X on [date]. Your estimate from [date] may now be Y% off. [Re-estimate] [See what changed]." **This turns a liability into a content marketing surface.** Each change = a blog post = SEO = newsletter = reason for users to come back. Anthropic's volatility becomes your content strategy. Build the infrastructure to make "re-estimate after change" a one-click action. |

---

## Component-by-Component Technical Approach

### 1. The Estimation Engine

**Architecture:** Three-layer system that evolves over time.

**Layer 1 (MVP): Archetype-based heuristic**
- Claude API extracts structured features from project description
- Features map to nearest project archetype (from a table of ~50 types)
- Each archetype has: base token range, session range, model mix recommendation
- Sliders apply multipliers: skill_level (0.5x to 3x), mcp_servers (+ N×2000 tokens/turn × expected_turns), agent_teams (3-7x), plan_mode (-14%), claude_md (-30% output but +input)
- Output: range (low/mid/high), not point estimate

**Layer 2 (v2, ~500 actuals): Bayesian regression**
- Use actuals as training data
- Informative priors from archetype table
- Features: extracted project features + slider values
- Target: actual tokens used, actual sessions needed
- Posterior predictive distribution gives natural confidence intervals

**Layer 3 (v3, ~2000+ actuals): ML model**
- Gradient-boosted trees or similar
- Feature importance analysis reveals which factors actually matter
- Publishable as industry insights (content marketing + credibility)

**Cost per estimate:** ~$0.003-0.01 (one Sonnet API call for extraction + free token counting)

### 2. The Teaching Layer

**How to generate project-specific advice (not generic tips):**

The key insight is that your estimation formula's *multipliers* ARE the teaching content. Every multiplier that changes the estimate is a lesson:

- User has no CLAUDE.md → formula applies +30% output penalty → tooltip: "For a project this size (~X output tokens), a CLAUDE.md saves you ~Y tokens. Here's a starter template for [their project type]."
- User selected 4 MCP servers → formula adds 4×2000×expected_turns → tooltip: "Your 4 MCP servers add ~Z tokens of overhead per turn. For [their project], the biggest savings come from [specific server type] which you likely don't need for [specific features]."
- User at beginner skill level → formula applies 2.5x multiplier → tooltip: "The gap between beginner and intermediate is worth ~$X/mo for your project. The 3 habits that close the gap fastest: [specific to project type]."

**Implementation:** Author a decision tree for each slider with 3-5 contextual messages per threshold. Total authoring: ~150 messages. Store as JSON. Render inline. Update as you learn which messages drive behavior change (track: did users adjust sliders after reading tooltip? did users who read tooltips submit better actuals?).

### 3. Mid-Project Decision Helper

**The best technical path (Claude Code hooks):**

```json
// .claude/settings.json hook configuration
{
  "hooks": {
    "Stop": [{
      "type": "http",
      "url": "https://your-app.com/api/hooks/session-end",
      "timeout": 5000
    }]
  }
}
```

The Stop event fires after every Claude Code response. Your endpoint receives the session's accumulated token totals. You store these, compare against the user's original estimate, and can now say: "You're 40% through your estimated tokens but only 20% through your project scope. At this rate, you'll exceed your plan's capacity. Options: [switch to Sonnet for routine tasks] [enable plan mode] [upgrade to Max 5x]."

**For claude.ai chat users (no hooks):** Manual entry remains the only reliable path. The usage percentage is visible at claude.ai/settings/usage. A browser extension is technically possible but fragile (DOM changes break it). Recommendation: ship manual entry, add a bookmark/shortcut that opens the settings page alongside your app.

### 4. Change Detection System

**Recommended architecture:**

Deploy changedetection.io (Docker) monitoring these Anthropic pages:
1. platform.claude.com/docs/en/about-claude/pricing
2. support.claude.com/en/articles/11145838 (Pro/Max Claude Code usage)
3. support.claude.com/en/articles/11647753 (usage limits)
4. code.claude.com/docs/en/costs (Claude Code costs)
5. platform.claude.com/docs/en/api/rate-limits
6. anthropic.com/pricing (plan page)
7. support.claude.com/en/articles/12429409 (manage usage credits)
8. Claude Code changelog (releasebot.io/updates/anthropic/claude-code)

Use CSS selectors to target pricing tables and limit sections specifically. On change detected:
1. Webhook fires to your backend
2. AI summarizes the change ("Opus 4.7 pricing unchanged but tokenizer produces 35% more tokens")
3. New pricing_snapshot created
4. Affected estimates flagged
5. Email notifications sent to opted-in users
6. Blog post auto-drafted (you edit and publish)

**Cost:** ~$5/month VPS for changedetection.io + your time reviewing changes (estimate: 30 min/week average, spiky around Anthropic announcements).

### 5. Data Moat Infrastructure

**Schema (Supabase/PostgreSQL):**

Core tables: estimates, actuals, pricing_snapshots, users, projects

Key design decisions:
- All project descriptions encrypted at rest (contain potential IP)
- Anonymous mode: no email, cookie-based only, contributes to aggregate stats but no personal history
- Opt-in levels: (1) anonymous aggregate only, (2) anonymous + contribute actuals, (3) full account with history
- pricing_snapshot_id on every estimate enables time-travel: "re-estimate this project with today's pricing"
- actuals table links back to estimates — this is the training signal

**Privacy architecture:**
- Project descriptions: encrypted, never exposed externally, used only for feature extraction
- Aggregated stats: published openly ("average Sonnet session costs $X for project type Y")
- Individual actuals: visible only to that user unless they opt into community benchmarks
- "Private mode": estimate runs, no data stored server-side (all client-side)

### 6. Team/Enterprise Seat-Mix Optimizer

**Algorithm (simpler than it sounds):**

Input: N team members, each with estimated monthly usage (from the individual estimator run N times, or from a team-level project scope split across members)

Steps:
1. Rank members by estimated monthly token consumption
2. For each available plan tier, calculate: cost + whether it covers that member's usage
3. Find the combination that minimizes total cost while ensuring each member has adequate capacity (with configurable headroom %)
4. Output: recommended plan per member + total cost + comparison to "everyone on the same plan"

This is a simple greedy optimization (sort by usage, assign cheapest adequate plan) that runs in O(N × P) where P = number of plan options (~4-5). For 150 people: ~750 operations. Instant.

**Enterprise integration:** For companies on the Enterprise Analytics API, your app could pull actual per-user usage data and recommend plan changes based on real consumption patterns. This is the killer B2B feature: "Based on your team's actual usage last month, switching 12 people from Premium to Standard saves $1,200/mo with zero risk of limit interruption."

---

## Post-MVP Problems Identified

### Problem 1: Concept drift after Anthropic changes
**Risk:** High (recurring)
**When it hits:** Every time Anthropic changes pricing, tokenizer, or limits
**Impact:** All existing estimates become potentially stale
**Mitigation:** Pricing snapshot system + automated change detection + user notifications. Already designed into the architecture above.

### Problem 2: Gaming/bad actuals data
**Risk:** Medium (after scale)
**When it hits:** Once the app has enough users that gaming could influence estimates
**Impact:** Poisoned training data → worse estimates for everyone
**Mitigation:** Outlier detection on submitted actuals (flag submissions >5 standard deviations from mean for that archetype). Require minimum session data points per submission. Weight actuals by user reputation (users who submit consistently accurate data get higher weight).

### Problem 3: Model versioning complexity
**Risk:** Medium (growing)
**When it hits:** v2/v3 when ML models replace heuristics
**Impact:** Need to A/B test new models, handle rollbacks, avoid regression
**Mitigation:** Shadow mode — new model runs alongside old model for 2 weeks, comparing predictions. Only promote if new model's predictions better match incoming actuals. Simple model registry (not MLOps overkill).

### Problem 4: Enterprise security requirements
**Risk:** Low-medium (Phase 3)
**When it hits:** First enterprise customer asks for SOC 2
**Impact:** 4-6 month delay + $15-30K cost for Type I
**Mitigation:** Use Supabase (already SOC 2 compliant). Use Vercel (SOC 2 compliant). Your app's attack surface is small. Get a pen test ($5-15K) early. Start SOC 2 prep when you have 3 signed enterprise LOIs waiting on it.

### Problem 5: Claude Code hooks adoption friction
**Risk:** Medium
**When it hits:** v2 when hooks integration ships
**Impact:** If users don't install the hook, you don't get real-time data
**Mitigation:** Make installation dead simple (one CLI command). Show immediate value ("see your real-time burn rate in our dashboard"). Make the hook open-source so users can audit it. Consider: could you ship this as a Claude Code skill/plugin rather than a raw hook? Explore the Claude Code plugin ecosystem.

### Problem 6: Anthropic builds this in-product
**Risk:** Medium-high (acknowledged in handoff doc)
**When it hits:** Unknown — could be 6 months or never
**Impact:** Existential if they do it well; opportunity if they do it poorly
**Mitigation:** Move fast, build community, accumulate data they can't replicate (cross-user benchmarks, project-type insights, historical trends). Even if Anthropic ships basic estimation, yours will be: (a) more honest about uncertainty, (b) include the teaching layer, (c) support team optimization, (d) have historical data. Anthropic is unlikely to build the B2B procurement optimization angle.

### Problem 7: Scaling the estimation engine under load
**Risk:** Low (initially)
**When it hits:** If viral moment hits (HN front page, Reddit post blows up)
**Impact:** Claude API rate limits could throttle estimates
**Mitigation:** Claude API rate limits scale with usage tier. At Tier 2 (easy to reach): 2,000 RPM for token counting, separate limits for messages. At peak viral traffic (assume 10,000 simultaneous users): you need ~10,000 estimates in an hour = ~167 per minute. Well within Tier 2 limits. For extreme spikes: queue estimates, show "calculating..." for 2-3 seconds. Not a real concern.

---

## The "Special Thing" Discovered

The JSONL accuracy bug is your hidden advantage. Here's why:

Every Claude Code user who's ever looked at their usage data through community tools (ccusage, claude-usage, Claude-Code-Usage-Monitor, tokscale, CodeBurn) has been looking at numbers that are **100x wrong on input tokens and 10x wrong on output**. The entire community's mental model of "how much does a session cost" is built on broken data.

Your app can be the first to:
1. **Correctly measure** session costs via hooks (using the accurate internal counters, not JSONL)
2. **Educate users** that their previous understanding was wrong ("You thought that session cost X tokens? It actually cost 100X. Here's why.")
3. **Build the first accurate benchmark database** of real session costs across project types

This gives you:
- Instant credibility with power users who discover the discrepancy
- A content marketing angle ("The token tracking tools you're using are 100x wrong")
- A genuine data advantage (you're collecting accurate data while everyone else collects garbage)
- A wedge product: even before the estimator is good, the accurate tracker has standalone value

**Recommendation:** Consider launching the hooks-based accurate tracker as a standalone free tool BEFORE the estimator. It solves an immediate pain, builds trust, and generates the training data your estimator needs. Two birds, one stone.

---

## Final Verdict: Feasibility Matrix

| Component | Difficulty | Feasible? | Timeline to ship |
|---|---|---|---|
| Free-text extraction | Easy | ✅ Yes | Week 1 |
| Plan recommendation | Easy | ✅ Yes | Week 1 |
| Slider UX | Easy | ✅ Yes | Week 1-2 |
| Teaching tooltips | Easy | ✅ Yes | Week 2 |
| Basic estimation (heuristic) | Medium | ✅ Yes | Week 2-3 |
| Feedback loop schema | Easy | ✅ Yes | Week 1 |
| Email nudge system | Easy | ✅ Yes | Week 3 |
| Change detection | Easy | ✅ Yes | Week 2 |
| Mid-project helper (manual) | Easy | ✅ Yes | Week 3-4 |
| Mid-project helper (hooks) | Medium | ✅ Yes | v2 (month 3-4) |
| Confidence intervals | Hard | ✅ Yes (improves with data) | Ongoing |
| Seat-mix optimizer | Medium | ✅ Yes | v2 (month 4-5) |
| Bayesian re-training | Hard | ✅ Yes (needs 200+ actuals) | v2 (month 6+) |
| Enterprise Analytics integration | Medium | ✅ Yes | v3 (month 8+) |
| ML estimation model | Hard | ✅ Yes (needs 1000+ actuals) | v3 (month 12+) |
| Accurate hooks-based tracker | Medium | ✅ Yes | Could ship first |
| Browser extension for usage | Hard (maintenance) | ⚠️ Fragile | Not recommended |

**Nothing is impossible. Everything is feasible. The hardest parts improve automatically as you accumulate data.**

---

## Recommended Build Sequence (Updated)

Based on this research, I'd suggest one modification to the build sequence from the handoff doc:

**Phase 0 (pre-MVP, 1-2 weeks): Ship the accurate tracker as a standalone free tool**
- Build the Claude Code hooks integration that correctly measures session costs
- Release as open-source CLI tool + web dashboard
- Post on r/ClaudeAI with the angle: "Your token tracking tools are 100x wrong. Here's one that isn't."
- This generates: buzz, users, trust, and — critically — the training data your estimator needs

**Phase 1 (MVP, weeks 3-6): The estimator**
- As originally planned, but now with a growing dataset from Phase 0 users
- Free-text input + sliders + heuristic estimate + plan rec + teaching tooltips

**Phase 2+ continues as planned in the handoff doc.**

---

## Sources

### Anthropic Official Documentation
- [Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- [Token Counting API](https://platform.claude.com/docs/en/build-with-claude/token-counting)
- [Pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- [Rate Limits API](https://platform.claude.com/docs/en/api/rate-limits)
- [Usage and Cost API](https://platform.claude.com/docs/en/build-with-claude/usage-cost-api)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks-guide)
- [Claude Code Costs](https://code.claude.com/docs/en/costs)
- [Enterprise Analytics API](https://support.claude.com/en/articles/13703965-claude-enterprise-analytics-api-reference-guide)
- [Session Storage / JSONL Format](https://code.claude.com/docs/en/agent-sdk/session-storage)

### Critical Technical Findings
- [JSONL Token Counts Are 100x Wrong](https://gille.ai/en/blog/claude-code-jsonl-logs-undercount-tokens/)
- [ccusage JSONL undercounting issue](https://github.com/ryoppippi/ccusage/issues/866)
- [Claude Code Usage Monitor (ccusage)](https://github.com/ryoppippi/ccusage)
- [MCP Server Token Overhead](https://www.mindstudio.ai/blog/claude-code-mcp-server-token-overhead)
- [MCP Token Costs Full Breakdown](https://www.jdhodges.com/blog/claude-code-mcp-server-token-costs/)
- [Claude Code Agents Cost Analysis](https://www.cloudzero.com/blog/claude-code-agents/)

### Change Detection Tools
- [changedetection.io](https://github.com/dgtlmoon/changedetection.io)
- [Releasebot - Anthropic Updates](https://releasebot.io/updates/anthropic)

### Usage Tracking Tools (for competitive understanding)
- [ccusage](https://ccusage.com/)
- [Claude-Code-Usage-Monitor](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor)
- [claude-usage dashboard](https://github.com/phuryn/claude-usage)
- [tokscale](https://github.com/junhoyeo/tokscale)
- [SessionWatcher](https://www.sessionwatcher.com/guides/how-to-check-claude-code-usage)

### Pricing & Plan Research
- [Anthropic API Pricing 2026 (Finout)](https://www.finout.io/blog/anthropic-api-pricing)
- [Claude Code Pricing Deep Dive](https://www.verdent.ai/guides/claude-code-pricing-2026)
- [Enterprise Analytics API (Finout analysis)](https://www.finout.io/blog/anthropics-enterprise-analytics)
- [Opus 4.7 Tokenizer Impact](https://www.finout.io/blog/claude-opus-4.7-pricing-the-real-cost-story-behind-the-unchanged-price-tag)

### Statistical Methods
- [Bayesian Statistics for Limited Data](https://accendoreliability.com/leveraging-bayesian-statistics-for-reliability-predictions-with-limited-sample-data/)

---

*End of feasibility report. Log file updated at: feasibility-research-log.md*
