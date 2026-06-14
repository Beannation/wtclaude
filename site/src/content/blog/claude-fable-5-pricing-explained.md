---
title: "Claude Fable 5 Pricing Explained: The Free Window, Usage Credits, and the June 23 Cliff"
description: "Claude Fable 5 launched June 9, 2026 and was suspended June 12 under a US export-control order. Here's the cost picture from its brief availability — and what the suspension means."
pubDate: 2026-06-09
author: "Peter Bean"
readingTime: "7 min read"
---

> **⚠ Update — June 12, 2026: Claude Fable 5 has been suspended.** Following a US Commerce Department export-control directive citing national security, Anthropic disabled Claude Fable 5 — and its sibling Mythos 5 — for all users on June 12, just three days after launch. Other Claude models are unaffected. **The free window and the "June 23 cliff" described below no longer apply:** there is currently no Fable 5 to use or be billed for, and whether or when it returns is unclear. We've kept this page up as a factual record of the model's brief availability, and we'll update it if it comes back. (Source: [Anthropic's statement](https://www.anthropic.com/news/fable-mythos-access).)

On June 9, 2026, Anthropic released **Claude Fable 5** — a Mythos-class model it describes as its most powerful generally available model, state-of-the-art across coding, science, and knowledge work. It's free for everyone to try for about two weeks. It's also the most expensive model Anthropic has ever put on general release. Both of those things are true at once, and the gap between them is the part worth understanding before you build a habit around it.

Here's the cost picture, plainly.

## What Claude Fable 5 is (briefly)

Fable 5 is a "Mythos-class" model made safe for general availability. On a small share of queries — Anthropic says under 5% of sessions, in high-risk areas like cybersecurity and biology — it routes the answer to Claude Opus 4.8 instead. (There's a sibling, **Mythos 5**, that's the same underlying model with some safeguards lifted, initially deployed more narrowly.) For most everyday coding and knowledge work, you're using Fable 5 directly. Source: [Anthropic's announcement](https://www.anthropic.com/news/claude-fable-5-mythos-5).

The capability isn't really in question. The cost is what people are missing.

## The pricing

On the API, Claude Fable 5 runs:

- **$10 per million input tokens**
- **$50 per million output tokens**
- with the usual **90% discount on cached input tokens**

That's roughly **double the price of Claude Opus 4.8** (about $5 / $25 per million), which makes Fable 5 the most expensive generally available model Anthropic ships. For a frontier model that's not unreasonable — but it means the cost math is different from what you're used to, especially on output-heavy work like long agent runs.

## The free window: June 9–22

Here's the part that's easy to enjoy without reading the fine print. **From June 9 through June 22, 2026, Fable 5 is included at no extra cost** on Pro, Max, Team, and seat-based Enterprise plans. During that window it counts against your normal plan limits like any other model — no separate charge.

So for about two weeks, the most expensive model Anthropic makes is, effectively, free on your subscription. Naturally, people are switching everything to it.

## The June 23 cliff

This is the line to circle on your calendar. **On June 23, Anthropic removes Fable 5 from those plan limits.** After that, continuing to use it draws from **usage credits** — the pay-as-you-go balance that sits on top of your subscription — billed at the API rates above ($10 / $50 per million).

And usage credits don't discriminate by surface: once you're past your plan limit, **every token counts** — chat messages, Claude Code in your terminal, Research-mode sessions, project file content — all drawing down at the same per-token prices. (Anthropic's [usage-credits docs](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans) spell this out.)

The trap isn't the price. It's the *habit*. Two free weeks is exactly long enough to make Fable 5 your default — to wire it into your agent loops and your daily flow — and then on June 23 that same default starts metering against credits at the highest rate Anthropic charges, often on the output side where it hurts most.

## Why this collides with the June 15 billing split

The timing here is genuinely awkward, and worth saying out loud. The Fable free window straddles **[the June 15 dual-pool billing change](/blog/the-june-15-split)**, when Claude Code usage splits into Interactive and Agent-SDK credit pools. So in the same two-week stretch you're (a) learning a new, pricier default model and (b) moving to a new two-pool credit model — and then (c) the free window ends and Fable starts drawing real credits.

If you only loosely know what you're spending now, that's three moving parts stacked on top of each other. The way through it is boring and effective: understand how [Claude Code billing actually works](/blog/claude-code-billing-explained), and know your real numbers before June 23 rather than after.

## What to actually do

- **Use the free window — deliberately.** Two weeks of a frontier model for free is a real gift. Try Fable 5 on the work where its capability matters.
- **Notice what you're defaulting to.** If you switch everything to Fable and forget, June 23 is a surprise. If you switch consciously, it's a decision.
- **Know your real spend before the cliff.** Whatever you use to track Claude Code cost, make sure it's giving you a number you trust — [an estimate that drifts from your bill is worse than useless right before a price change](/blog/is-claude-code-cost-accurate). Going into June 23 knowing your actual usage is the whole game.

Fable 5 is an excellent model. Just go in with your eyes open: free until the 22nd, then the most expensive model Anthropic ships, metering against your credits. Enjoy the window — and don't let the habit bill you in July.

## See your Fable spend — and the cliff — coming

*(Note, June 14: with Fable 5 suspended, there's no live Fable usage to track right now — the section below describes what WTClaude did during the model's brief availability and what it will do again if Fable returns.)*

Since I build a Claude Code cost tracker, I added Fable support to WTClaude the day the model launched. Here's what it does, with the honest scope.

WTClaude recognizes Fable 5 in your terminal and reads its cost the same billing-grade way it reads the rest of your Claude Code usage — from the statusline, the source behind your bill. (As always, that's billing-grade for Claude Code **in the terminal**; the desktop app and Chat stay honest estimates.) Even during the free window, the statusline reports Fable's cost as a real notional dollar figure — which is essentially what it will start charging you on June 23.

So there's a command built for the cliff:

```
wtclaude fable
```

It projects what your current Fable usage would cost once the free window ends, with a countdown to June 23. Two honesty notes, because they're the point: it's a **labeled estimate** — "if the announced $10/$50 pricing holds," since Anthropic may extend or change it — and it's kept **separate** from the June-15 Agent-SDK forecast, because those are two different countdowns drawing on two different wallets. WTClaude won't blur them together.

It's not there to scare you off a good model. It's there so you walk into June 23 already knowing the number, instead of meeting it on your July statement.

## FAQ

**Is Claude Fable 5 free?**
Yes, temporarily — from June 9 through June 22, 2026, it's included at no extra cost on Pro, Max, Team, and seat-based Enterprise plans. On June 23 it's removed from plan limits, and continued use draws from usage credits at API rates.

**How much does Claude Fable 5 cost?**
On the API, $10 per million input tokens and $50 per million output tokens, with a 90% discount on cached input — roughly double the price of Claude Opus 4.8, making it the most expensive generally available Anthropic model.

**What happens to Claude Fable 5 after June 22?**
Starting June 23 it no longer counts against your plan limits. Continuing to use it consumes usage credits (your pay-as-you-go balance) billed at the per-token API prices, across chat, Claude Code, and other surfaces.

**Is Fable 5 the same as Mythos 5?**
They're the same underlying model. Mythos 5 has some safeguards lifted and is deployed more narrowly; Fable 5 is the general-availability version that falls back to Opus 4.8 on a small share of high-risk queries.

**How do I avoid a surprise bill when the free window ends?**
Know your real Claude Code spend before June 23, and decide consciously whether Fable stays your default once it starts drawing credits. Going in with accurate numbers — not an estimate — is what keeps July boring.

**Can I track what Fable 5 is costing me?**
Yes. WTClaude recognizes Fable 5 in terminal Claude Code and reads its cost billing-grade from the statusline. The `wtclaude fable` command projects what your usage would cost after the free window ends, with a countdown to June 23 — a labeled estimate ("if the announced $10/$50 holds"), kept separate from the June-15 Agent-SDK forecast.

---

*WTClaude is a free, open-source, billing-grade cost tracker for Claude Code. Whatever you run — and whatever Anthropic ships next — see your real number: `npx wtclaude setup`, then `wtclaude compare`.*
