---
title: 'June 15 was going to change how you pay for Claude. Here’s the plain version.'
description: 'Anthropic announced a June 15 split of Claude billing into two pools — Interactive and Agent SDK Credits — then paused it before it took effect. Here’s what was announced, who it would have hit, and where it stands.'
pubDate: 2026-06-05
updatedDate: 2026-08-24
author: 'Peter Bean'
readingTime: '4 min read'
draftProse: false
---

> **Update — August 24, 2026: still paused.** More than two months on, the Agent-SDK billing split has not taken effect. Agent SDK, `claude -p`, and third-party apps continue to draw from your subscription’s usage limits, and there is no separate credit pool to run dry. Anthropic has said it will give advance notice before any revised version takes effect. Everything below is the original announcement, kept as a record.

> **Update — June 15, 2026: this change was PAUSED. It did not take effect.** Anthropic paused the Agent-SDK billing split on June 15, before it took effect — Agent SDK, `claude -p`, and third-party apps still draw from your subscription's usage limits, exactly as before, and there's no credit to claim. Anthropic says it's reworking the plan and will give advance notice before anything takes effect. We've kept this post as a record of what was announced, and we're watching for if/when a revised version returns. ([Anthropic's note](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan).)

If you use Claude Code, the way you pay for it **was set to change on June 15** — and if you run agents, it would have changed in a way that can bite you mid-month. Here’s what was announced, who it would have affected, and how to not get surprised if a revised version returns. No hype, just the mechanics.

## One pool becomes two

Your Claude subscription is basically one bucket of usage. As announced, from June 15 it would have been split into two:

- **The Interactive pool.** This is the everyday stuff — Claude.ai, Claude Code in your terminal, Cowork. It keeps running against your subscription’s usage limits the way you’re used to.
- **The Agent SDK Credit pool.** This was the new one. Programmatic and agentic usage — `claude -p`, the Agent SDK, GitHub Actions, and third-party agents built on Claude — would have drawn from a separate, **dollar-denominated** budget billed at full API rates, resetting monthly with no rollover.

The short version, as announced: interactive use would have stayed on your familiar limits; automated, agentic use would have moved to a credit budget measured in dollars that can run dry.

## Why this matters (especially if you run agents)

For a lot of developers, the most expensive Claude usage *is* the agentic usage — long agent runs, CI jobs, batch scripts. Today that all draws from one pool. Under the announced split it would have become a distinct budget with a hard bottom.

That would create a failure mode that doesn’t exist today: **exhausting your agent credits in the middle of the month and having your automated workflows stop**, even while your interactive usage is totally fine. If a revised version lands, kicking off an agent loop and walking away means a dollar meter running on it that you can’t see.

And here’s the part that makes it worse: most usage trackers can’t show you your real usage accurately. They read Claude Code’s local session logs, and those logs record input tokens as `0` or `1` for most entries — they’re written mid-stream, before the response finalizes, and never corrected. So the number you’ve been looking at may be off by a wide margin. (This is documented behavior, reproducible in seconds — it’s not a secret, it’s just rarely talked about.) Going through a billing change, a tracker that drifts from your bill is worse than no tracker at all, because it gives you false confidence.

## The numbers, plainly

The subscription tiers themselves were never part of the change — Pro is $20/mo ($17/mo billed annually), and Max starts at $100/mo. What was announced alongside them is the **Agent SDK Credit** budget: a monthly dollar allotment for programmatic usage, charged at API rates, with **no rollover**. If a revised version lands and you lean on agents, that allotment — not your interactive limit — is the thing most likely to run out first.

## What to actually do about it

You don’t need a new workflow. You need three things:

1. **Get a real baseline.** Track your actual Claude Code usage so you can see how the two pools behave for the way you really work. A few days of real data beats a guess.
2. **Watch your agent-pool burn.** If a revised split lands, see how fast your agentic usage is spending — and whether your credits will cover the month. The more days you track, the sharper the projection gets.
3. **Get a straight yes/no.** The useful question isn’t “how many tokens did I use” — it’s “are my included credits enough for how I actually work, and if not, what’s the one thing to change.”

## Where WTClaude fits

WTClaude is a free, open-source usage tracker for Claude Code, and it’s built for exactly this moment. A few things worth knowing:

- **It reads the right data.** Instead of the broken session logs, it reads the statusline — the same billing-grade source behind your bill — so your Claude Code numbers are real, not drifting. *(It tracks Claude Code in your terminal today; Cowork and Chat are on the roadmap, and they’ll be clearly labeled as estimates when they arrive.)*
- **It’s built for both pools.** The dual-pool view is built and ready — if a revised split lands, it would switch on with a WTClaude update, and `wtclaude today` would then split your spend **per pool**.
- **It projects your agent-pool burn.** If a revised split lands, a daily projection shows your expected agent-pool spend against your included credits, at standard API list rates; bundle discounts up to 30% and promos not reflected. **This is a forecast, not a crystal ball:** the cost math is billing-grade, but classifying which usage lands in which pool is a heuristic, so we label the whole thing an estimate. Every day of real data makes the projection tighter.
- **It gives you a credits-enough check.** If and when there is a pool to check against, one line: are your credits enough, yes or no, plus the single thing to do about it. Clearly labeled as an estimate from your tracked usage — never presented as your guaranteed bill.

Install takes about a minute, in your terminal:

```bash
npm i -g wtclaude
wtclaude setup
```

It’s free and MIT-licensed. The point isn’t to sell you something — it’s that a split like this rewards people who track honestly, and the tool that does it is free. Start now and you’ll have the baseline ready if a revised version lands.

---

*WTClaude is an independent, open-source project. It is not affiliated with, endorsed by, or sponsored by Anthropic, PBC. Claude is a trademark of Anthropic, PBC. The forecast and readiness figures are clearly-labeled estimates from your tracked usage, not a guaranteed invoice amount.*
