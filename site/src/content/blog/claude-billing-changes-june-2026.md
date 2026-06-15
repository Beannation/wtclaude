---
title: "Two Claude Billing Changes in Two Weeks: A Plain-English Field Guide"
description: "The June 15 Claude Code pool split and the June 23 Fable cliff land eight days apart and both involve 'credits' — so they're easy to confuse. Here's a clear, no-drama map of what changes, when, and what to do."
pubDate: 2026-06-11
author: "Peter Bean"
readingTime: "8 min read"
---

> **⚠ Update — June 14, 2026: Change #2 below (the June-23 Fable cliff) no longer applies.** Claude Fable 5 was **suspended on June 12** under a US Commerce Department export-control directive — Anthropic disabled Fable 5 and Mythos 5 for all users; other Claude models are unaffected. There is no longer a Fable free window or a June-23 cliff. **Change #1 — the June-15 Claude Code pool split — still stands**, and the rest of this guide (keeping two billing ideas separate) holds up. We've left Change #2 below as a dated record. (Source: [Anthropic's statement](https://www.anthropic.com/news/fable-mythos-access).)

A lot is changing in how Claude bills, and it's changing fast. Inside a single fortnight there are **two separate changes** — and because they land eight days apart and both involve the word "credits," they're remarkably easy to blur into one. They aren't one. Conflating them is the only real way to get tripped up here.

So here's a clear, no-drama map: what each change actually is, when it lands, which wallet it touches, and what — if anything — you should do. Each change is sensible on its own. This guide isn't a complaint; it's a map.

## The two changes at a glance

| | **Change #1** | **Change #2** |
|---|---|---|
| **What** | Claude Code usage is now split into two credit pools | Claude Fable 5's free window ends |
| **When** | **June 15 — live now** | **June 23** |
| **Touches** | How your Code usage is *bucketed* (Interactive vs Agent-SDK) | One *model* moving from free to pay-per-token |
| **Who** | Claude Code users | Anyone using Fable 5 |

Keep those two rows separate in your head and you've basically got it. Now the detail.

## Change #1 — June 15 (now live): the Claude Code pool split

**What happened:** As of June 15, Claude Code usage is split into a **two-pool model** — an **Interactive** pool (your hands-on, back-and-forth work) and an **Agent-SDK** pool (agentic / SDK-driven workloads). Your usage is attributed to one or the other, and they're tracked separately.

**Why it matters:** if a lot of your work is agentic, you'll draw down the Agent-SDK pool faster than a single combined number would ever suggest. Budgeting against one lumped figure quietly stops working the moment your usage leans one way.

**What to do:** now that it's live, see which pool your usage actually falls into — a good tracker shows the split automatically, no reinstall. (We wrote a [dedicated explainer on the split](/blog/the-june-15-split) if you want the full version.) `wtclaude today` now shows your spend **per-pool**, billing-grade in the terminal — so instead of forecasting whether your credits would cover you, you can see exactly where each pool stands.

## Change #2 — June 23: the Fable cliff *(withdrawn — Fable suspended June 12)*

> *Kept as a dated record. Fable 5 was suspended on June 12 (see the update note up top), so the free window and June-23 cliff described here never arrived. The distinction it illustrates — a model's price changing vs. how usage is bucketed — still holds, which is why we left it.*

**What's happening:** Claude Fable 5 (launched June 9) is **included free** on Pro, Max, Team, and seat-based Enterprise plans **through June 22**. On **June 23**, it's removed from those plan limits, and continued use draws **usage credits** billed at API rates — **$10 per million input tokens, $50 per million output** (roughly double Opus 4.8).

**Why it matters:** two free weeks is exactly long enough to make Fable your default — to wire it into your daily flow and your agent loops — and then on June 23 that same default starts metering at the highest rate Anthropic charges. The trap isn't the price; it's the habit. (Full breakdown in the [Fable pricing post](/blog/claude-fable-5-pricing-explained).)

**What to do:** enjoy the free window, but notice if Fable is quietly becoming your default. Before the 23rd, decide consciously whether it stays there once it costs real credits. `wtclaude fable` projects what your current usage would cost after the window — a **labeled estimate** ("if the announced $10/$50 holds"), with a countdown to the cliff.

## The thing people will conflate — and why they're different

Both changes involve "usage credits," so it's tempting to file them as one event. They're not, and the distinction is worth holding onto:

- **June 15 is about *organization*.** It re-buckets how your Claude Code usage is counted — two pools instead of one. Nothing about a price changes; the *shape* of the accounting does.
- **June 23 is about *one model's price*.** Fable 5 simply stops being free and starts billing per token. Nothing about the pools changes; one new option gets a price tag.

A clean way to remember it: **June 15 rearranges the room; June 23 puts a price tag on one new piece of furniture.** Two separate countdowns, and — importantly — you keep two separate forecasts. Don't let a tracker blur "your Agent-SDK pool projection" together with "your Fable cliff projection," because they answer different questions about different things.

(One genuine point of overlap, stated carefully: Fable usage is attributed through whichever pool the work falls in — interactive terminal work vs agentic work — and after June 23 that usage bills from your usage credits. So the two changes *touch*, but they're still two distinct things to track, not one.)

## A simple plan for the next two weeks

- **Now → June 15:** run a readiness check so you know which pool you lean on and whether your credits hold. (Labeled estimate.)
- **June 15:** the split goes live; a good tracker starts showing your spend per-pool automatically — no reinstall.
- **June 9 → 22:** use free Fable freely, but keep half an eye on whether it's becoming your default.
- **Before June 23:** run a Fable forecast and make the default a *decision*, not an accident.
- **June 23:** Fable starts metering; switch from forecast to watching your real, billing-grade cost.

The throughline is boring and it works: **know your real numbers, keep the two countdowns separate, and nothing surprises you.**

## A note on tone

It's worth saying plainly: each of these changes is reasonable. Splitting Code usage into pools makes agentic spend visible, which is genuinely useful. Releasing a frontier model free for two weeks is generous. The only friction is that they're close together and share a word. None of this needs to be confusing — it just needs a map. Now you have one.

## FAQ

**Are the June 15 split and the June 23 Fable change the same thing?**
No. June 15 re-buckets Claude Code usage into two credit pools (Interactive and Agent-SDK) — an organizational change. June 23 is when Claude Fable 5 stops being free and starts billing per token. Two separate changes, two separate countdowns.

**Will using Fable draw from the new pools?**
Fable usage is attributed through whichever pool your work falls in (interactive vs agentic), and after June 23 that usage bills from your usage credits at API rates. The two changes touch, but you still track them as two distinct things.

**What should I do before each date?**
Before June 15, check whether your credits cover the pool you actually use (a readiness check). Before June 23, forecast what Fable would cost you and decide consciously whether to keep it as your default.

**Is Claude getting more expensive?**
Not as a blanket statement. The June 15 split doesn't change prices — it changes how usage is counted. Fable is a new, premium option that's free for two weeks and then priced like the frontier model it is. The honest move isn't to panic; it's to know your own numbers.

---

*WTClaude tracks both changes — separately and honestly — billing-grade in your terminal. `npx wtclaude setup`, then `wtclaude readiness` (for June 15) and `wtclaude fable` (for June 23). Both clearly labeled for what they are.*
