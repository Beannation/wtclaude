---
title: "Why Your Claude Code Cost Tracker Disagrees With Your Bill"
description: "Your Claude Code tracker says one number; your bill says another. Here's exactly why session-log estimates drift from billing-grade cost — and how to see your real number."
pubDate: 2026-06-09
author: "Peter Bean"
readingTime: "8 min read"
faq:
  - q: "Is Claude Code's /cost command accurate?"
    a: "It's a client-side estimate, computed locally from a bundled price table — Anthropic says so directly. It's useful for a rough sense of usage, but it's not authoritative billing data, and it can drift from your actual bill depending on caching, token-counting edge cases, and pricing changes."
  - q: "Why does my Claude Code cost tracker not match my bill?"
    a: "Because most trackers reconstruct cost from local session logs (token counts × a price table), and that reconstruction can drift — stale price tables, cache pricing it doesn't model, and known token-counting issues in the logs. The billing-grade source is the Claude Code statusline."
  - q: "What's the most accurate way to track Claude Code cost?"
    a: "Read the statusline (the source behind your bill) rather than reconstructing from logs. In the terminal, that's billing-grade. wtclaude compare shows your statusline number next to the log-based estimate so you can see the difference on your own usage."
  - q: "Is WTClaude affiliated with Anthropic?"
    a: "No. It's an independent, free, open-source (MIT) project. Being independent is part of the point — it's on your side, not selling you a plan."
---

If you use Claude Code seriously, you've probably had this moment: you glance at a usage tracker — or run the built-in `/cost` — and the number doesn't match what you expected to be billed. Sometimes it's close. Sometimes it's not close at all.

You're not imagining it, and you're not doing anything wrong. The number is off because of *where it comes from*. Once you understand that, the fix is simple.

## The short version

Most Claude Code trackers — and the built-in cost estimate — reconstruct your cost from local **session logs**. Those logs don't carry billing-grade cost, so the total is an estimate. A different source, the Claude Code **statusline**, reflects the cost computed the same way your bill is. Read that instead, and the number stops drifting.

That's the whole idea behind the tool I build, [WTClaude](/developers) — but the explanation is useful whether or not you ever install it, so let's actually walk through it.

## Where the numbers come from

Claude Code writes a record of your sessions to local log files (JSONL). They're easy to find, easy to parse, and they contain token counts. So it's natural for a tracker to read those logs, multiply tokens by a price table, and show you a cost. Almost every tracker works this way. So does the convenient `/cost` estimate.

The problem is that **token-counts-times-a-price-table is a reconstruction, not the real cost.** Anthropic is explicit about this for the SDK: the `total_cost_usd` and per-model `costUSD` values are *client-side estimates*, computed locally from a price table bundled into the tool — not authoritative billing data. The official guidance is that for the real figure you use the Console / the Usage and Cost API.

So when a log-based tracker shows you "$X," it's showing you its best reconstruction. A good one gets close. But several things make reconstructions drift:

- **Token counts in the logs can be wrong or incomplete.** There are documented issues where streaming responses record input tokens as a `0`/`1` placeholder, and where duplicated request IDs cause the same usage to be counted more than once (see, for example, the open reports `anthropics/claude-code#28197` and `ryoppippi/ccusage#866`). If the token numbers feeding the estimate are off, the estimate is off.
- **Pricing has structure the table may miss.** Cache reads and cache-creation are priced differently from normal input; tiers exist; a flat token×rate misses these.
- **The price table goes stale.** It's bundled at build time. When pricing changes, every reconstruction made against the old table is wrong until the tool updates.

None of this means the tools are badly made. It means they're working from a source that was never meant to be the source of truth for cost.

## What the statusline knows that the logs don't

Claude Code also surfaces a **statusline**, and the cost in it is computed from the same source that produces your bill. It isn't a reconstruction — it's the authoritative number, surfaced to you live.

If a tracker reads *that*, it isn't estimating anymore. That's the difference between "probably about $X" and "$X." We call numbers read this way **billing-grade**, and — being precise, because precision is the whole point — billing-grade applies to **Claude Code running in your terminal**, where the statusline is available. (For Claude in the desktop app, Cowork, or Chat, that source isn't exposed locally, so any honest tracker should label those as estimates, not billing-grade. We do.)

## See your own gap in about ten seconds

Here's the part you can check for yourself. WTClaude reads the statusline, so `today` / `week` / `month` are billing-grade in the terminal. And there's one command built specifically for this question:

```
npx wtclaude setup
wtclaude compare
```

`compare` shows your real, billing-grade number next to the number a session-log tracker would show you, and the gap between them. I won't quote you a universal multiple, because the gap depends entirely on how you use Claude Code — your model mix, how much caching you hit, how much of your work is streamed. For some people it's small. For some it's surprising. The point isn't a scary stat; it's that **you get to see *yours*** instead of trusting that an estimate is close.

## Why this matters even more around billing changes

It's always nicer to know your real number than a guess. And it matters even more around billing changes — like the [announced-then-paused June 15 split](/blog/the-june-15-split), which would have moved Claude Code usage into two separate credit pools (Interactive and Agent-SDK). If your tracker is already drifting, a change like that splits the drift across two buckets and makes "about right" a lot less comfortable. Knowing which pool your usage actually lands in — from the real source — is worth the ten seconds.

## So, is `/cost` "wrong"?

Not exactly — it's an *estimate*, and it's labeled as one if you read the fine print. The trouble is that an estimate shown without that context gets treated as exact, and then the mismatch with your bill feels like a bug. It isn't a bug. It's a reconstruction doing its best. If you want the number that matches your bill, read the source your bill is computed from.

## FAQ

**Is Claude Code's `/cost` command accurate?**
It's a client-side *estimate*, computed locally from a bundled price table — Anthropic says so directly. It's useful for a rough sense of usage, but it's not authoritative billing data, and it can drift from your actual bill depending on caching, token-counting edge cases, and pricing changes.

**Why does my Claude Code cost tracker not match my bill?**
Because most trackers reconstruct cost from local session logs (token counts × a price table), and that reconstruction can drift — stale price tables, cache pricing it doesn't model, and known token-counting issues in the logs. The billing-grade source is the Claude Code statusline.

**What's the most accurate way to track Claude Code cost?**
Read the statusline (the source behind your bill) rather than reconstructing from logs. In the terminal, that's billing-grade. `wtclaude compare` shows your statusline number next to the log-based estimate so you can see the difference on your own usage.

**Is WTClaude affiliated with Anthropic?**
No. It's an independent, free, open-source (MIT) project. Being independent is part of the point — it's on your side, not selling you a plan.

---

*WTClaude is a free, open-source, billing-grade cost tracker for Claude Code. See your real number: `npx wtclaude setup`, then `wtclaude compare`. [How it compares to other trackers →](/compare)*

*Further reading: [Claude Fable 5 Pricing Explained: The Free Window, Usage Credits, and the June 23 Cliff →](/blog/claude-fable-5-pricing-explained)*
