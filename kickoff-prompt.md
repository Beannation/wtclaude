# Kickoff Prompt for Code Chat

Copy and paste the text below (between the --- lines) as your first message in the new Claude Code chat.

---

I'm building WTClaude — the first accurate Claude Code usage tracker. I have a complete project plan, CLAUDE.md, and extensive research documents ready in this project folder. Here's what I need you to do:

**First, read these files in this order to understand the full context:**

1. `CLAUDE.md` — project overview, architecture constraints, tech stack, what NOT to build
2. `research-context/phase-0-build-plan.md` — the complete stage-by-stage build plan with data models, file structure, and build order
3. `research-context/jsonl-bug-opportunity-deep-dive.md` — deep technical research on the JSONL accuracy bug (the reason this product exists)

These three files contain everything you need to start building. The other files in `research-context/` are background research — read them if you need context on specific decisions, but they're not required to start coding.

**What you're building:**

A CLI tool + web dashboard that reads Claude Code's accurate statusline data (instead of the broken JSONL logs every other tool uses). The statusline data matches Anthropic's billing exactly. JSONL undercounts input tokens by 100x.

**Build approach:**

Follow the 5-stage build plan in `research-context/phase-0-build-plan.md` exactly. Start with Stage 1 (collector + CLI). Each stage builds on the previous one. Do not skip ahead or combine stages — I want to test each stage before moving to the next.

**Key constraints (from CLAUDE.md):**
- Never read JSONL for actual usage data (only for the comparison view)
- Store per-turn data, not just summaries (future features need this granularity)
- Anonymous by default, no email/OAuth required
- Collector must be <50ms per invocation
- Pricing in versioned config, never hardcoded
- MIT license

Start with Stage 1: scaffold the npm package and build the statusline collector script. Before writing any code, confirm you've read the three files above and summarize your understanding of the collector's job (what it receives, how it computes deltas from cumulative totals, and where it writes).

---
