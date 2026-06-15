---
title: 'June 15 changed how you pay for Claude. Here’s the plain version.'
description: 'On June 15, Anthropic split Claude billing into two pools — Interactive and Agent SDK Credits. Here’s what changed, who it hits, and how to stay on top of it.'
pubDate: 2026-06-05
author: 'Peter Bean'
readingTime: '4 min read'
draftProse: false
---

> **Update — June 15: this is now live.** The split described below is in effect as of June 15. This post explains what changed and what to do now.

If you use Claude Code, the way you pay for it **changed on June 15** — and if you run agents, it changed in a way that can bite you mid-month. Here’s what actually happened, who it affects, and how to not get surprised. No hype, just the mechanics.

## One pool becomes two

Your Claude subscription used to be basically one bucket of usage. As of June 15, it’s split into two:

- **The Interactive pool.** This is the everyday stuff — Claude.ai, Claude Code in your terminal, Cowork. It keeps running against your subscription’s usage limits the way you’re used to.
- **The Agent SDK Credit pool.** This is the new one. Programmatic and agentic usage — `claude -p`, the Agent SDK, GitHub Actions, and third-party agents built on Claude — now draws from a separate, **dollar-denominated** budget billed at full API rates. It resets monthly, and it doesn’t roll over.

The short version: interactive use stays on your familiar limits; automated, agentic use moves to a credit budget that’s measured in dollars and can run dry.

## Why this matters (especially if you run agents)

For a lot of developers, the most expensive Claude usage *is* the agentic usage — long agent runs, CI jobs, batch scripts. Until June 15, that all blurred into one pool. Now it’s a distinct budget with a hard bottom.

That creates a failure mode that didn’t really exist before: **you can exhaust your agent credits in the middle of the month and have your automated workflows stop**, even while your interactive usage is totally fine. If you’ve ever kicked off an agent loop and walked away, you now have a dollar meter running on it that you can’t see.

And here’s the part that makes it worse: most usage trackers can’t show you either pool accurately. They read Claude Code’s local session logs, and those logs record input tokens as `0` or `1` for most entries — they’re written mid-stream, before the response finalizes, and never corrected. So the number you’ve been looking at may be off by a wide margin. (This is documented behavior, reproducible in seconds — it’s not a secret, it’s just rarely talked about.) Going through a billing change, a tracker that drifts from your bill is worse than no tracker at all, because it gives you false confidence.

## The numbers, plainly

The subscription tiers themselves didn’t change on June 15 — Pro is $20/mo, Max 5× is $100/mo, Max 20× is $200/mo. What’s new is the **Agent SDK Credit** budget that sits alongside them: a monthly dollar allotment for programmatic usage, charged at API rates, with **no rollover**. If you lean on agents, that allotment — not your interactive limit — is the thing most likely to run out first.

## What to actually do about it

You don’t need a new workflow. You need three things:

1. **Get a real baseline.** Track your actual Claude Code usage so you can see how the two pools behave for the way you really work. A few days of real data beats a guess.
2. **Watch your agent-pool burn.** Now that the pool is live, see how fast your agentic usage is spending — and whether your credits will cover the month. The more days you track, the sharper the projection gets.
3. **Get a straight yes/no.** The useful question isn’t “how many tokens did I use” — it’s “are my included credits enough for how I actually work, and if not, what’s the one thing to change.”

## Where WTClaude fits

WTClaude is a free, open-source usage tracker for Claude Code, and it’s built for exactly this moment. A few things worth knowing:

- **It reads the right data.** Instead of the broken session logs, it reads the statusline — the same billing-grade source behind your bill — so your Claude Code numbers are real, not drifting. *(It tracks Claude Code in your terminal today; Cowork and Chat are on the roadmap, and they’ll be clearly labeled as estimates when they arrive.)*
- **It’s built for both pools.** The dual-pool view lit up automatically on June 15 — no reinstall. `wtclaude today` now shows your spend **per-pool**, billing-grade in the terminal.
- **It projects your agent-pool burn.** A daily projection shows your expected agent-pool spend against your included credits. **This is a forecast, not a crystal ball:** the cost math is billing-grade, but classifying which usage lands in which pool is a heuristic, so we label the whole thing an estimate. Every day of real data makes the projection tighter.
- **It gives you a credits-enough check.** One line: are your credits enough, yes or no, plus the single thing to do about it. Clearly labeled as an estimate from your tracked usage — never presented as your guaranteed bill.

Install takes about a minute, in your terminal:

```bash
npx wtclaude setup
```

It’s free and MIT-licensed. The point isn’t to sell you something — it’s that the split rewards people who track honestly, and the tool that does it is free. Start now, and you’ll always know where each pool stands.

---

*WTClaude is an independent, open-source project. It is not affiliated with, endorsed by, or sponsored by Anthropic, PBC. Claude is a trademark of Anthropic, PBC. The forecast and readiness figures are clearly-labeled estimates from your tracked usage, not a guaranteed invoice amount.*
