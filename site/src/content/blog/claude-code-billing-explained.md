---
title: "Claude Code Billing, Explained: Pools, Credits, Limits, and What You Actually Pay"
description: "A plain-English guide to how Claude Code billing works — subscriptions vs API, usage limits and windows, the credit pools Anthropic announced (then paused), and how to see where you actually stand."
pubDate: 2026-06-28
author: "Peter Bean"
readingTime: "9 min read"
faq:
  - q: "How does Claude Code billing work?"
    a: "Two models: subscription (Pro/Max) where you pay a flat fee and use within rolling limits, and API/usage-credits where you pay per token. Subscriptions measure usage against time windows; API measures it in dollars."
  - q: "What are the Claude Code credit pools?"
    a: "Anthropic announced a plan to split usage into a separate Interactive pool and Agent-SDK pool, but paused it on June 15, 2026 before it took effect. Today, agentic and SDK usage still draws from your subscription's usage limits as before — there's no separate pool to budget against right now. Anthropic says it's reworking the plan and will give notice before anything changes."
  - q: "What's the difference between a rate limit and cost in Claude Code?"
    a: "A rate limit is how much you can use within a window; cost is what that usage is worth or billed. They're independent — you can hit one without the other."
  - q: "How do I know if I'm close to my Claude Code limit?"
    a: "Use /usage in a session for a snapshot, or a tracker that shows your overall plan limit with reset countdowns continuously (e.g. wtclaude limit)."
  - q: "Is the cost my tracker shows the same as my bill?"
    a: "Only if it reads the billing source. Log-based estimates can drift; statusline-based readings are billing-grade in the terminal."
---

Claude Code billing trips people up because there isn't one model — there are a few, depending on how you pay, and they measure different things. This is the plain-English version: how you're charged, what the limits actually mean, what the credit pools are, and how to see where you stand. (For the specifics that change over time, always check Anthropic's official docs — this is the mental model, not the rate card.)

## Two ways you pay

**Subscription (Pro / Max).** You pay a flat monthly fee and get access within **usage limits**. You're not billed per token; instead your usage is measured against rolling windows, and when you hit a limit you wait for it to reset. For subscribers, "how much am I spending?" is really two questions: how close am I to my limit, and — if I'm curious — what would this usage have cost at API rates.

**API / usage credits.** Here you pay for what you consume. Tokens have a real dollar cost, and that cost is what shows up on your bill. For this group, dollar tracking isn't academic — it's the actual money.

A lot of confusion comes from mixing these up. "I've used 80% of my limit" and "I've spent $40" are different facts, and a good tracker keeps them separate. (We're careful about this: WTClaude shows your plan-limit usage as your *overall plan limit*, and shows cost separately — it never dresses one up as the other.)

## What counts toward your limits

On subscription plans, usage is measured in **windows** — commonly a rolling 5-hour window and a longer weekly window. Heavy work draws down the window; when it's exhausted, you're paused until it resets. This is why two people on the same plan can have very different experiences: it's not about a dollar budget, it's about how much you pack into each window.

The practical move is to see how close you are *before* you hit the wall. Inside a session, `/usage` shows your plan tracking. A tracker can show it continuously — for example:

```
wtclaude limit
```

shows where you stand against your overall plan limit, with reset countdowns, so a hard stop doesn't surprise you mid-task.

## Credits and the pools (the change that was announced, then paused)

Claude Code uses **usage credits** for paid plans. There's also a billing change worth understanding — partly because it's a useful mental model, and partly because of how it played out. Anthropic **announced** a plan to split usage into two separate pools:

- an **Interactive** pool, for the back-and-forth work you do directly, and
- an **Agent-SDK** pool, for agentic / SDK-driven workloads.

**That split was paused on June 15, 2026, before it took effect.** As of now, agentic and SDK usage — `claude -p`, the Agent SDK, third-party apps — still draws from your subscription's usage limits exactly as before. There's no separate Agent-SDK pool to budget against today, and no separate credit to claim. Anthropic has said it's reworking the plan and will give advance notice before anything changes. ([We tracked the whole back-and-forth here.](/blog/two-claude-billing-changes-neither-happened))

It's still worth holding the mental model, because if a revised version returns the reason it matters is simple: if your work leans heavily toward agentic runs, a separate pool would draw down faster than you'd expect, and budgeting against a single combined number would stop working. For now, though, it's one combined picture.

## Rate limits vs cost — don't conflate them

One more distinction worth nailing down: **rate limits** (how fast/much you can use in a window) are not the same as **cost** (what it's worth or what you're billed). You can be nowhere near your dollar spend and still hit a rate limit, or vice versa. Tools that blur the two leave you guessing. When you're reading any tracker, check which one it's actually showing you.

## How to see where you actually stand

Whatever you pay, the useful end-state is the same: a clear, current picture of your usage that you trust. Three things get you there:

1. **A real cost number, not an estimate.** Most trackers reconstruct cost from local logs, which drifts from your bill. Reading the statusline (the billing source) is billing-grade in the terminal — [here's why that distinction matters](/blog/is-claude-code-cost-accurate).
2. **Your limit, with countdowns.** So you see the wall coming.
3. **The pool picture.** Today that's one combined limit; if Anthropic's announced Interactive/Agent-SDK split returns, you'll want to see which budget you're drawing down.

You can get all three for free:

```
npx wtclaude setup
wtclaude today        # real cost, billing-grade in the terminal
wtclaude limit        # your overall plan limit + reset countdowns
wtclaude readiness    # are your credits enough? (a labeled forecast — ready if the pool split returns)
```

`readiness` and `forecast` are **forecasts** — the cost math is billing-grade, the pool classification is a heuristic, so we label them as estimates rather than pretend they're your exact future bill.

## FAQ

**How does Claude Code billing work?**
Two models: subscription (Pro/Max) where you pay a flat fee and use within rolling limits, and API/usage-credits where you pay per token. Subscriptions measure usage against time windows; API measures it in dollars.

**What are the Claude Code credit pools?**
Anthropic announced a plan to split usage into a separate Interactive pool and Agent-SDK pool, but **paused it on June 15, 2026 before it took effect**. Today, agentic and SDK usage still draws from your subscription's usage limits as before — there's no separate pool to budget against right now. Anthropic says it's reworking the plan and will give notice before anything changes. [The full story.](/blog/two-claude-billing-changes-neither-happened)

**What's the difference between a rate limit and cost in Claude Code?**
A rate limit is how much you can use within a window; cost is what that usage is worth or billed. They're independent — you can hit one without the other.

**How do I know if I'm close to my Claude Code limit?**
Use `/usage` in a session for a snapshot, or a tracker that shows your overall plan limit with reset countdowns continuously (e.g. `wtclaude limit`).

**Is the cost my tracker shows the same as my bill?**
Only if it reads the billing source. Log-based estimates can drift; statusline-based readings are billing-grade in the terminal. [Why they disagree.](/blog/is-claude-code-cost-accurate)

---

*WTClaude is a free, open-source, billing-grade Claude Code cost tracker — cost and limits, honestly labeled. `npx wtclaude setup`.*
