---
title: 'June 15 changes how you pay for Claude. Here’s the plain version.'
description: 'On June 15, Anthropic splits Claude billing into two pools — Interactive and Agent SDK Credits. Here’s what changes, who it hits, and how to stay ahead of it.'
pubDate: 2026-06-05
author: 'Peter Bean'
readingTime: '4 min read'
draftProse: false
---

If you use Claude Code, the way you pay for it changes on **June 15** — and if you run agents, it changes in a way that can bite you mid-month. Here’s what’s actually happening, who it affects, and how to not get surprised. No hype, just the mechanics.

## One pool becomes two

Today, your Claude subscription is basically one bucket of usage. After June 15, it splits into two:

- **The Interactive pool.** This is the everyday stuff — Claude.ai, Claude Code in your terminal, Cowork. It keeps running against your subscription’s usage limits the way you’re used to.
- **The Agent SDK Credit pool.** This is the new one. Programmatic and agentic usage — `claude -p`, the Agent SDK, GitHub Actions, and third-party agents built on Claude — now draws from a separate, **dollar-denominated** budget billed at full API rates. It resets monthly, and it doesn’t roll over.

The short version: interactive use stays on your familiar limits; automated, agentic use moves to a credit budget that’s measured in dollars and can run dry.

## Why this matters (especially if you run agents)

For a lot of developers, the most expensive Claude usage *is* the agentic usage — long agent runs, CI jobs, batch scripts. Until now, that all blurred into one pool. After June 15, it’s a distinct budget with a hard bottom.

That creates a failure mode that didn’t really exist before: **you can exhaust your agent credits in the middle of the month and have your automated workflows stop**, even while your interactive usage is totally fine. If you’ve ever kicked off an agent loop and walked away, you now have a dollar meter running on it that you can’t see.

And here’s the part that makes it worse: most usage trackers can’t show you either pool accurately. They read Claude Code’s local session logs, and those logs record input tokens as `0` or `1` for most entries — they’re written mid-stream, before the response finalizes, and never corrected. So the number you’ve been looking at may be off by a wide margin. (This is documented behavior, reproducible in seconds — it’s not a secret, it’s just rarely talked about.) Going into a billing change, a tracker that undercounts is worse than no tracker at all, because it gives you false confidence.

## The numbers, plainly

The subscription tiers themselves aren’t changing on June 15 — Pro is $20/mo, Max 5× is $100/mo, Max 20× is $200/mo. What’s new is the **Agent SDK Credit** budget that sits alongside them: a monthly dollar allotment for programmatic usage, charged at API rates, with **no rollover**. If you lean on agents, that allotment — not your interactive limit — is the thing most likely to run out first.

## What to actually do about it

You don’t need a new workflow. You need three things, and the earlier you start, the better they work:

1. **Get a real baseline now.** Start tracking your actual Claude Code usage *before* the split, so you know what “normal” looks like when the two pools appear. A week of real data beats a guess.
2. **Watch your projected agent-pool burn.** Once you can see how fast your agentic usage is spending, you can project where the month ends — and whether your credits will cover it. The more days you’ve tracked, the sharper that projection gets.
3. **Get a straight yes/no before the deadline.** The useful question on June 14 isn’t “how many tokens did I use” — it’s “are my included credits enough for how I actually work, yes or no, and if not, what’s the one thing to change.”

## Where WTClaude fits

WTClaude is a free, open-source usage tracker for Claude Code, and it’s built for exactly this moment. A few things worth knowing:

- **It reads the right data.** Instead of the broken session logs, it reads the statusline — the same billing-grade source behind your bill — so your Claude Code numbers are real, not undercounted. *(It tracks Claude Code in your terminal today; Cowork and Chat are on the roadmap, and they’ll be clearly labeled as estimates when they arrive.)*
- **It’s built for both pools.** The dual-pool view lights up automatically on June 15 — no reinstall.
- **It forecasts your agent-pool burn.** A daily projection shows your expected agent-pool spend against your included credits, with a countdown to the 15th. **This is a forecast, not a crystal ball:** the cost math is billing-grade, but classifying which usage lands in which pool is a heuristic, so we label the whole thing an estimate. Install early and every day of real data makes the projection tighter.
- **It gives you the June-14 readiness check.** One line: are your credits enough, yes or no, plus the single thing to do about it. Also clearly labeled as an estimate from your tracked usage — never presented as your guaranteed bill.

Install takes about a minute, in your terminal:

```bash
npx wtclaude setup
```

It’s free and MIT-licensed. The point isn’t to sell you something before June 15 — it’s that the split rewards people who start tracking early, and the tool that does it honestly is free. Start now, watch your forecast build, and walk into June 15 already knowing where you stand.

---

*WTClaude is an independent, open-source project. It is not affiliated with, endorsed by, or sponsored by Anthropic, PBC. Claude is a trademark of Anthropic, PBC. The forecast and readiness figures are clearly-labeled estimates from your tracked usage, not a guaranteed invoice amount.*
