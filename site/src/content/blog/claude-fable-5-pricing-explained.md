---
title: "Claude Fable 5 Pricing Explained: The Free Window, Usage Credits, and the June 23 Cliff"
description: "Claude Fable 5 launched June 9, 2026, was suspended June 12, and returned July 1. A record of its brief free window — and how Fable bills now that its pricing is permanent and plan-conditional."
pubDate: 2026-06-09
author: "Peter Bean"
readingTime: "7 min read"
---

> **Update — September 7, 2026: Claude Fable 5.1 has launched, and Fable 5 is still here.** Anthropic released **Claude Fable 5.1** (`claude-fable-5-1`) on September 1, 2026. It has been Claude Code's **default** Fable model since v2.1.257, so terminal sessions that select Fable now get 5.1 unless you pin otherwise. It carries the same **$10 / $50 per million** base rates as Fable 5 and the same plan rules — Anthropic's Help Center states that Fable 5 and Fable 5.1 work the same way on your plan. The difference that matters for cost is cached input: cache reads are **$0.25 per million on Fable 5.1** versus **$1.00 on Fable 5**, priced at 0.025× base input rather than the standard 0.1×. Two clarifications on the promotional credits described below: they applied to **Fable 5 only** — Anthropic states there is no equivalent credit for Fable 5.1 — and their September 17, 2026 expiry is unchanged. **Fable 5 has not been deprecated or retired.** It is listed as Active on Anthropic's model-deprecations page with a retirement date no sooner than June 9, 2027; some pricing pages group it under a "Legacy models" heading, which is a marketing grouping and not its lifecycle state. Everything below remains a dated record of Fable 5's launch period.

> **Update — August 24, 2026: Fable 5 is back, and its pricing is permanent and plan-conditional — there is no cliff.** Anthropic redeployed Claude Fable 5 on **July 1, 2026**, and since **July 20** how it bills depends on your plan, not on a date. On **Max, Team Premium and Enterprise Premium**, Fable 5 is included **up to 50% of your weekly usage limit** — a share *of* that weekly limit, not an allowance on top of it, and not a credits wallet. On **Pro and Team Standard**, it draws **usage credits from the first token**. On **Enterprise Standard**, it draws credits only if the organization enables Fable. API rates are unchanged at **$10 / $50 per million**. The promotional Fable credits closed to new claims on **August 2, 2026** and expire **September 17, 2026 at 11:59 PM PT** regardless of when they were claimed. The June 9-22 free window and the "June 23 cliff" described below never took effect — everything from here down is kept as a dated record.

> **⚠ Update — June 12, 2026: Claude Fable 5 has been suspended.** Following a US Commerce Department export-control directive citing national security, Anthropic disabled Claude Fable 5 — and its sibling Mythos 5 — for all users on June 12, just three days after launch. Other Claude models are unaffected. **The free window and the "June 23 cliff" described below no longer apply:** there is currently no Fable 5 to use or be billed for, and whether or when it returns is unclear. We've kept this page up as a factual record of the model's brief availability, and we'll update it if it comes back. (Source: [Anthropic's statement](https://www.anthropic.com/news/fable-mythos-access).)

On June 9, 2026, Anthropic released **Claude Fable 5** — a Mythos-class model it describes as its most powerful generally available model, state-of-the-art across coding, science, and knowledge work. It was free for everyone to try for about two weeks. It was also priced at the top of Anthropic's generally available range. Both of those things were true at once, and the gap between them is the part worth understanding before you build a habit around any model.

Here's the cost picture, plainly.

## What Claude Fable 5 is (briefly)

Fable 5 is a "Mythos-class" model made safe for general availability. On a small share of queries — Anthropic says under 5% of sessions, in high-risk areas like cybersecurity and biology — it routes the answer to another Claude model instead (Claude Opus 4.8, at launch). (There's a sibling, **Mythos 5**, that's the same underlying model with some safeguards lifted, initially deployed more narrowly.) For most everyday coding and knowledge work, you're using Fable 5 directly. Source: [Anthropic's announcement](https://www.anthropic.com/news/claude-fable-5-mythos-5).

The capability isn't really in question. The cost is what people are missing.

## The pricing

On the API, Claude Fable 5 runs:

- **$10 per million input tokens**
- **$50 per million output tokens**
- with the usual **90% discount on cached input tokens**

That's roughly **double the base price of Claude Opus 4.8** (about $5 / $25 per million), putting Fable 5 at the top of Anthropic's generally available price range — where Opus 5's fast mode now sits too, at $10 / $50. For a frontier model that's not unreasonable — but it means the cost math is different from what you're used to, especially on output-heavy work like long agent runs.

## The free window: June 9–22

Here's the part that's easy to enjoy without reading the fine print. **From June 9 through June 22, 2026, Fable 5 was to be included at no extra cost** on Pro, Max, Team, and seat-based Enterprise plans. During that window it counted against your normal plan limits like any other model — no separate charge.

So for about two weeks, Anthropic's priciest generally available model was, effectively, free on your subscription. Naturally, people switched everything to it.

## The June 23 cliff *(withdrawn — it never took effect)*

> *Kept as a dated record. Fable 5 was suspended on June 12, before this date arrived, and when it returned on July 1 Anthropic replaced the dated-cliff model entirely: since July 20 Fable's billing is permanent and plan-conditional. See the August 24 update at the top.*

This was the line to circle on your calendar. **On June 23, Anthropic was to remove Fable 5 from those plan limits.** After that, continuing to use it would have drawn from **usage credits** — the pay-as-you-go balance that sits on top of your subscription — billed at the API rates above ($10 / $50 per million).

And usage credits don't discriminate by surface: once you're past your plan limit, **every token counts** — chat messages, Claude Code in your terminal, Research-mode sessions, project file content — all drawing down at the same per-token prices. (Anthropic's [usage-credits docs](https://support.claude.com/en/articles/12429409-manage-usage-credits-for-paid-claude-plans) spell this out.)

The trap was never the price. It's the *habit*. Two free weeks is exactly long enough to make a model your default — to wire it into your agent loops and your daily flow — and then have the billing rule change underneath it. That is still the right thing to watch for; it just arrived as a plan condition rather than a date.

## Why this collides with the June 15 billing split

The timing looked genuinely awkward at the time, and it is worth recording why it did not play out. The Fable free window straddled **[the announced June 15 dual-pool billing change](/blog/the-june-15-split)**, which would have split Claude Code usage into Interactive and Agent-SDK credit pools. Neither change landed: the pool split was paused and has never taken effect, and Fable was suspended before its cliff date.

The underlying advice outlasted both. Understand how [Claude Code billing actually works](/blog/claude-code-billing-explained), and know your real numbers before a billing rule changes rather than after.

## What to actually do

- **Notice what you're defaulting to.** If you switch everything to Fable and forget, the billing rule is a surprise. If you switch consciously, it's a decision. That held then and it holds now — the rule is just your plan rather than a date.
- **Know your real spend.** Whatever you use to track Claude Code cost, make sure it's giving you a number you trust — [an estimate that drifts from your bill is worse than useless right before a price change](/blog/is-claude-code-cost-accurate).

Fable 5 is an excellent model. Go in with your eyes open: on Max, Team Premium and Enterprise Premium it is included up to 50% of your weekly limit; on Pro and Team Standard it draws usage credits from the first token.

## See what your Fable usage costs

Since I build a Claude Code cost tracker, I added Fable support to WTClaude the day the model launched. Here's what it does, with the honest scope.

WTClaude recognizes Fable 5 in your terminal and reads its cost the same billing-grade way it reads the rest of your Claude Code usage — from the statusline, the source behind your bill. (As always, that's billing-grade for Claude Code **in the terminal**; the desktop app and Chat stay honest estimates.) Even where Fable is included, the statusline reports its cost as a real notional dollar figure — which is what the same usage would cost in credits on a plan that bills it.

So there's a command for it:

```
wtclaude fable
```

It tells you what your Fable usage costs on your plan — included usage on Max, Team Premium and Enterprise Premium, or usage credits on Pro and Team Standard — and shows both readings if it doesn't know your plan, because the two answers differ by the entire bill. It's a **labeled estimate**, at standard API list rates; bundle discounts up to 30% and promos not reflected.

It's not there to scare you off a good model. It's there so you already know the number, instead of meeting it on a statement.

## FAQ

**Is Claude Fable 5 free?**
It depends on your plan, and it is not a temporary window. On Max, Team Premium and Enterprise Premium, Fable 5 is included up to 50% of your weekly usage limit — a share of that limit, not an allowance on top of it. On Pro and Team Standard, it draws usage credits from the first token. On Enterprise Standard, only if your organization enables it.

**How much does Claude Fable 5 cost?**
On the API, $10 per million input tokens and $50 per million output tokens, with cached input at 10% of the input rate — roughly double the base price of Claude Opus 4.8, at the top of Anthropic's generally available range.

**What happened to the June 23 cliff?**
It never took effect. Fable 5 was suspended on June 12, and when Anthropic redeployed it on July 1 the dated-cliff model was replaced: since July 20, Fable's billing is permanent and depends on your plan rather than on a date.

**Is Fable 5 the same as Mythos 5?**
They're the same underlying model. Mythos 5 has some safeguards lifted and is deployed more narrowly; Fable 5 is the general-availability version that falls back to another Claude model on a small share of high-risk queries.

**How do I avoid a surprise Fable bill?**
Know which side of the plan rule you're on. On Pro and Team Standard, Fable draws usage credits from the first token, so know your real Claude Code spend before you make it your default. On Max, Team Premium and Enterprise Premium it's included up to 50% of your weekly limit.

**Can I track what Fable 5 is costing me?**
Yes. WTClaude recognizes Fable 5 in terminal Claude Code and reads its cost billing-grade from the statusline. The `wtclaude fable` command shows what your Fable usage costs on your plan — included usage, or usage credits — and shows both readings if it doesn't know your plan. A labeled estimate, at standard API list rates.

---

*WTClaude is a free, open-source, billing-grade cost tracker for Claude Code. Whatever you run — and whatever Anthropic ships next — see your real number: `npx wtclaude setup`, then `wtclaude compare`.*
