---
title: "Two Claude Billing Changes in Two Weeks: A Plain-English Field Guide"
description: "The June 15 Claude Code pool split and the June 23 Fable cliff were announced eight days apart and both involved 'credits' — so they were easy to confuse. Neither took effect: a dated field guide to what was announced, with the current facts up top."
pubDate: 2026-06-11
updatedDate: 2026-09-27
author: "Peter Bean"
readingTime: "8 min read"
---

> **Update — September 27, 2026: the current Opus has moved.** The August 24 note below names Opus 5 as the current Opus. Anthropic has since released **Claude Opus 5.5** (`claude-opus-5-5`, September 22, 2026) at $4/$20 per million input/output tokens, and since Claude Code v2.1.280 it has been the default model on every paid plan. Opus 5 is still Active at $5/$25. The usage-credit expiry noted below is now in effect: in certain jurisdictions such as Japan, usage credits expire six months after purchase, starting September 10, 2026.

> **Update — August 24, 2026: where both changes stand now.** Change #1, the Agent-SDK pool split, is **still paused** and has never taken effect — Claude Code usage is not split into two pools. Change #2 has no cliff at all: Fable 5 was **redeployed on July 1**, and since **July 20** it has been a permanent, plan-conditional model — included up to 50% of the weekly usage limit on Max, Team Premium, and Enterprise Premium (a share *of* that weekly limit, not an allowance on top of it, and not a credits wallet), and billed from usage credits from the first token on Pro and Team Standard; on Enterprise Standard only if the organization enables it. There is no free window, no June-23 cliff, and no countdown. Two other things have moved since June: the current Opus is **Opus 5** (launched July 24, $5/$25 per million input/output tokens), and usage credits **do** expire — jurisdiction-scoped, six months after purchase, beginning September 10, 2026. The guide below is preserved as a record of what was announced.

> **Update — June 15, 2026: neither change below took effect.** Change #1 (the June-15 Agent-SDK split) was **paused** by Anthropic on June 15, before it took effect — nothing changed, and there's no credit to claim. Change #2 (the Fable cliff) never arrived — Fable 5 was suspended June 12. Both could return with advance notice; we're watching. The guide below is preserved as a record of what was announced.

> **⚠ Update — June 14, 2026: Change #2 below (the June-23 Fable cliff) no longer applies.** Claude Fable 5 was **suspended on June 12** under a US Commerce Department export-control directive — Anthropic disabled Fable 5 and Mythos 5 for all users; other Claude models are unaffected. There is no longer a Fable free window or a June-23 cliff. **Change #1 — the June-15 Claude Code pool split — was paused before it took effect** (see the note above), and the rest of this guide (keeping two billing ideas separate) holds up. We've left Change #2 below as a dated record. (Source: [Anthropic's statement](https://www.anthropic.com/news/fable-mythos-access).)

A lot changed in how Claude bills over a single fortnight in June, and it changed fast. **Two separate changes** were announced — and because they were dated eight days apart and both involve the word "credits," they're remarkably easy to blur into one. They aren't one. Conflating them is the only real way to get tripped up here.

So here's a clear, no-drama map: what each change actually is, when it lands, which wallet it touches, and what — if anything — you should do. Each change is sensible on its own. This guide isn't a complaint; it's a map.

## The two changes at a glance

| | **Change #1** | **Change #2** |
|---|---|---|
| **What** | Claude Code usage was to split into two credit pools | Claude Fable 5's free window was to end |
| **When** | **June 15 — announced, then paused** | **June 23 — withdrawn; never arrived** |
| **Touches** | How your Code usage is *bucketed* (Interactive vs Agent-SDK) | One *model* moving from free to pay-per-token |
| **Who** | Claude Code users | Anyone using Fable 5 |

Keep those two rows separate in your head and you've basically got it. Now the detail.

## Change #1 — June 15: the Claude Code pool split (paused)

**What was announced:** Starting June 15, Claude Code usage was to split into a **two-pool model** — an **Interactive** pool (your hands-on, back-and-forth work) and an **Agent-SDK** pool (agentic / SDK-driven workloads), with usage attributed to one or the other and tracked separately. Anthropic paused this before it took effect — nothing changed.

**Why it mattered:** if a lot of your work is agentic, you'd have drawn down the Agent-SDK pool faster than a single combined number would ever suggest. Budgeting against one lumped figure quietly stops working the moment your usage leans one way.

**What to do:** nothing today — the split was paused. If a revised version lands, see which pool your usage actually falls into — a good tracker shows the split automatically, no reinstall. (We wrote a [dedicated explainer on the split](/blog/the-june-15-split/) if you want the full version.) Either way `wtclaude today` shows your spend billing-grade in the terminal — and would break it out **per-pool** automatically if the split ever activates — so instead of forecasting whether your credits would cover you, you can see exactly where you stand.

## Change #2 — June 23: the Fable cliff *(withdrawn — Fable suspended June 12)*

> *Kept as a dated record. Fable 5 was suspended on June 12 (see the update note up top), so the free window and June-23 cliff described here never arrived. The distinction it illustrates — a model's price changing vs. how usage is bucketed — still holds, which is why we left it.*

**What's happening:** Claude Fable 5 (launched June 9) is **included free** on Pro, Max, Team, and seat-based Enterprise plans **through June 22**. On **June 23**, it's removed from those plan limits, and continued use draws **usage credits** billed at API rates — **$10 per million input tokens, $50 per million output** (roughly double Opus 4.8).

**Why it matters:** two free weeks is exactly long enough to make Fable your default — to wire it into your daily flow and your agent loops — and then on June 23 that same default starts metering at the highest rate Anthropic charges. The trap isn't the price; it's the habit. (Full breakdown in the [Fable pricing post](/blog/claude-fable-5-pricing-explained/).)

**What to do:** enjoy the free window, but notice if Fable is quietly becoming your default. Before the 23rd, decide consciously whether it stays there once it costs real credits. `wtclaude fable` projected what your usage would cost after the window — a **labeled estimate** ("if the announced $10/$50 holds"), with a countdown to the cliff. The command no longer works that way: since Fable became plan-conditional it reports what Fable costs on your plan, with no cliff and no countdown.

## The thing people will conflate — and why they're different

Both changes involve "usage credits," so it's tempting to file them as one event. They're not, and the distinction is worth holding onto:

- **June 15 is about *organization*.** It re-buckets how your Claude Code usage is counted — two pools instead of one. Nothing about a price changes; the *shape* of the accounting does.
- **June 23 is about *one model's price*.** Fable 5 simply stops being free and starts billing per token. Nothing about the pools changes; one new option gets a price tag.

A clean way to remember it: **June 15 rearranges the room; June 23 puts a price tag on one new piece of furniture.** Two separate countdowns, and — importantly — you keep two separate forecasts. Don't let a tracker blur "your Agent-SDK pool projection" together with "your Fable cliff projection," because they answer different questions about different things.

(One genuine point of overlap, stated carefully: Fable usage was to be attributed through whichever pool the work fell in — interactive terminal work vs agentic work — and after June 23 that usage was to bill from your usage credits. So the two changes would have *touched*, but they were still two distinct things, not one.)

## The plan we gave for those two weeks

- **Track your real numbers:** run a readiness check so you know which pool you lean on and whether your credits hold. (Labeled estimate.)
- **June 15:** the split was paused — nothing changed; if a revised version lands, a good tracker shows your spend per-pool automatically, no reinstall.
- **June 9 → 22:** use free Fable freely, but keep half an eye on whether it's becoming your default.
- **Before June 23:** run a Fable forecast and make the default a *decision*, not an accident.
- **June 23:** Fable starts metering; switch from forecast to watching your real, billing-grade cost.

*The last three bullets never applied: Fable was suspended on June 12, redeployed July 1, and has been plan-conditional since July 20 — there was no June-23 metering date. See the August 24 note up top.*

The throughline is boring and it works: **know your real numbers, keep the two countdowns separate, and nothing surprises you.**

## A note on tone

It's worth saying plainly: each of these changes is reasonable. Splitting Code usage into pools makes agentic spend visible, which is genuinely useful. Releasing a frontier model free for two weeks is generous. The only friction is that they're close together and share a word. None of this needs to be confusing — it just needs a map. Now you have one.

## FAQ

**Were the June 15 split and the June 23 Fable change the same thing?**
No — and neither took effect. June 15 was to re-bucket Claude Code usage into two credit pools (Interactive and Agent-SDK), an organizational change; Anthropic paused it before it landed and it is still paused. June 23 was to be the day Claude Fable 5 stopped being free; that cliff never arrived. Fable 5 has been permanent and plan-conditional since July 20 — included up to 50% of the weekly usage limit on Max, Team Premium, and Enterprise Premium, and billed from usage credits from the first token on Pro and Team Standard.

**Does using Fable draw from the new pools?**
There are no new pools — the Agent-SDK split is still paused and has never taken effect. What Fable costs depends on your plan instead: on Max, Team Premium, and Enterprise Premium it's included up to 50% of your weekly usage limit; on Pro and Team Standard it draws usage credits from the first token (Enterprise Standard only if the organization enables it).

**Is there anything to do about either date now?**
No. Neither date did anything: the June 15 split was paused before it took effect, and the June 23 Fable cliff was withdrawn. The one thing worth knowing is which side of the Fable plan rule you're on — included up to 50% of the weekly usage limit, or billed from usage credits from the first token.

**Is Claude getting more expensive?**
Not as a blanket statement. The June 15 split never took effect, and it wouldn't have changed prices anyway — only how usage is counted. Fable's cost now depends on your plan rather than on a date: included up to 50% of the weekly usage limit on Max, Team Premium, and Enterprise Premium, usage credits from the first token on Pro and Team Standard. One thing did change since June: usage credits now expire — jurisdiction-scoped, six months after purchase, beginning September 10, 2026. The honest move isn't to panic; it's to know your own numbers.

---

*WTClaude tracks your real Claude Code spend — billing-grade in your terminal. `npm i -g wtclaude`, `wtclaude setup`, then `wtclaude readiness` (the Agent-SDK pool picture, if the paused split ever returns) and `wtclaude fable` (what Fable costs on your plan). Both clearly labeled for what they are.*
