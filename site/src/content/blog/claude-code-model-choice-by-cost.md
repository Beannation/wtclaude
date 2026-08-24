---
title: "Sonnet 5, Opus 5, or Fable 5? Choosing Your Claude Code Model by Cost"
description: "Sonnet 5 is the Claude Code default, Opus 5 is the default opus, and Fable 5 is now plan-conditional — so your model choice just got harder. Here's the honest, cost-first way to decide, priced from your own real usage."
pubDate: 2026-07-02
author: "Peter Bean"
readingTime: "8 min read"
faq:
  - q: "Is Claude Sonnet 5 cheaper than Opus 5?"
    a: "Per token, yes — Sonnet 5 is $2/$10 per million, permanently (Anthropic cancelled the increase to $3/$15 that had been scheduled for September 1, 2026), versus Opus 5's $5/$25. But it's not a guaranteed saving: Sonnet 5's tokenizer emits more tokens for the same work (often around 30% more), so a raw per-million comparison understates the gap. The only honest answer is to price it against your own real usage."
  - q: "How much does Claude Fable 5 cost?"
    a: "Fable 5 is permanent and plan-conditional — there is no cliff and no countdown. On Max, Team Premium and Enterprise Premium it's included up to 50% of your weekly usage limit: a share OF that weekly limit, not an allowance on top of it and not a credits wallet. On Pro and Team Standard it bills as usage credits from the first token, at $10/$50 per million (cache-read $1) — at standard API list rates; bundle discounts up to 30% and promos not reflected. Enterprise Standard is credits only, and only if the organisation enables Fable. Any 'what Fable will cost me' figure is a labeled estimate — it depends on your plan and your usage."
  - q: "How do I compare Claude models by cost?"
    a: "WTClaude's compare-models re-prices your own recorded, billing-grade usage across Opus 5, Sonnet 5, and Fable 5 and shows what the month would cost on each — split by surface (Code billing-grade, Cowork a labeled estimate, Chat excluded). Every projected number is a labeled estimate, and it compares cost, not model quality."
  - q: "Does WTClaude track Sonnet 5 and Fable 5?"
    a: "It prices both from the model's own reported tokens — Sonnet 5 at $2/$10 (permanently; the increase to $3/$15 that had been scheduled for September 1, 2026 was cancelled) and Fable 5 at $10/$50, at standard API list rates — with billing-grade cost for terminal Code (Anthropic-computed). Desktop-app and Chat usage are labeled estimates."
---

> **Update — August 24, 2026:** Three things below have moved. **Sonnet 5 stays at $2/$10 per million** — Anthropic cancelled the step-up to $3/$15 that had been scheduled for September 1, 2026. **Opus 5** launched July 24 at $5/$25 ($10/$50 in fast mode) and has been Claude Code's default `opus` since v2.1.219, so it's the Opus in this comparison now. And **Fable 5's 50% inclusion is permanent and plan-conditional** as of July 20 — there is no cliff and no countdown. The body has been corrected to match; the July history stays as history.

Two things changed in Claude Code the same week, and together they made a question that used to be easy kind of hard:

- **Claude Sonnet 5 launched (June 30) and is now the default model** in Claude Code (v2.1.197) and on Free/Pro. Most of your fresh sessions are already running on it.
- **Claude Fable 5 is back** (restored July 1 after its export-control suspension) — with a new billing mechanic that depends on your plan.

So now you've got three serious options — **Opus 5, Sonnet 5, and Fable 5** — with different prices, different billing rules, and a tokenizer wrinkle that makes the sticker price misleading. Here's the honest, cost-first way to think about it. (We're a cost tracker, so this is about the dollars — not a claim about which model is "smarter.")

<p class="rounded-lg border border-amber/30 bg-amber-light/40 px-4 py-3 text-sm"><a href="/business/audit" data-track="cta_spend_audit_blog_model_choice" class="font-semibold text-amber-deep hover:text-amber">Audit your team's Claude spend, free →</a></p>

## Sonnet 5: the new default, and cheaper per token — but read the asterisk

Sonnet 5 is **$2/$10 per million tokens** (input/output), and that's the standard price — Anthropic cancelled the step-up to **$3/$15** that had been scheduled for September 1, 2026. That's below Opus 5's $5/$25, and since it's the default, it's already what most of your sessions use.

Here's the asterisk that matters: **a lower per-token price is not the same as a lower bill.** Sonnet 5's tokenizer tends to emit *more* tokens for the same work — often around 30% more. So the same task can use more tokens on Sonnet 5 than the raw "$2 vs Opus" comparison implies, and the real per-task saving is smaller than the rate card suggests. It's still very likely cheaper for most work — just not by as much as the headline number, and not guaranteed on every task.

The good news for tracking: this tokenizer difference doesn't dent your *cost* number at all. WTClaude prices Sonnet 5 off **the model's own reported token counts** (and, in terminal Code, off Anthropic's own computed cost), so more tokens simply show up as more tokens — no re-calibration, no drift. ([Why a cost tracker can still disagree with your bill.](/blog/is-claude-code-cost-accurate))

## Fable 5 is back — and what it costs depends on your plan

Fable 5 returned July 1. The billing works like this:

- It's **included for up to 50% of your weekly usage limit** on Max, Team Premium, and Enterprise Premium — a share *of* that weekly limit, not an allowance on top of it, and not a credits wallet. *(This became permanent and plan-conditional on July 20. The earlier cliff dates — July 7, then ~July 12, then ~July 19 — were superseded; there is no cliff and no countdown.)*
- On **Pro and Team Standard**, Fable bills as **usage credits from the first token** at **$10/$50 per million** (cache-read $1) — at standard API list rates; bundle discounts up to 30% and promos not reflected. On **Enterprise Standard** it's credits only, and only if your organisation enables Fable.
- Requests that get blocked reroute to Opus.

Two honest notes. First, "included" is a **share of your weekly limit, not free-unlimited** — it's up to half of that limit, not an allowance on top of it. Second, any "what Fable will cost me" number is a **labeled estimate**: it depends on your plan and your usage, and it assumes the $10/$50 credit rate holds. We can't see how much of your weekly limit you're burning, so we don't pretend to know exactly how much the 50% share covers — we show *what your Fable usage would cost as credits*, clearly labeled.

(If you're keeping a mental map of Claude's billing changes, this Fable allowance is its own thing — separate from the Agent-SDK pool split that was announced earlier and then paused. Different wallets; don't let anyone blur them. [Here's the plain billing explainer.](/blog/claude-code-billing-explained))

## The choice is now genuinely hard — so price it against *your* usage

Opus 5 for the heavy reasoning, Sonnet 5 as the cheaper default, Fable 5 for the work it's best at (plan-dependent, at 2× Opus 5 rates once it's metered as credits). The rate cards alone won't tell you what *you'd* actually pay, because it depends entirely on how you work — which model you lean on, how much cache you hit, how token-heavy your sessions run.

That's exactly the question WTClaude's `compare-models` answers. It takes your **own recorded, billing-grade usage** and re-prices it across all three models, so you see what this month would have cost on each:

```
npx wtclaude setup
wtclaude compare-models
```

A few things we're careful about, because they're the difference between an honest tool and a misleading one:

- **It re-prices your *recorded* usage — it is not "the same task run on each model."** A different model would emit different token counts for the same work (that tokenizer point again), so the comparison is "your real usage, re-priced," clearly labeled as an estimate — not a lab benchmark.
- **It's split by where you work.** The **Code (terminal) row is billing-grade** — Anthropic's own computed cost, re-priced. The **Cowork row is a labeled estimate**. **Chat is excluded** (there's no local cost data for it, so we say so rather than show a fake zero). Model choice is made per surface anyway, so this is the split that actually helps you decide.
- **Cost, not quality.** We surface what each option costs. Whether Sonnet 5 is "good enough" for your work versus Opus is your call — we're not going to dress a cost tool up as a quality benchmark.

You also get this everywhere you already look: the same three-model comparison renders in the CLI, in the web dashboard tile, and in the desktop companion — driven off one shared calculation so the numbers can't disagree. (Want to see how WTClaude stacks up against the other trackers first? [Here's the honest side-by-side.](/compare))

## The one number you can trust underneath all of it

Model prices change, allowances expire, tokenizers differ — but the anchor doesn't move: WTClaude reads **the same cost number Anthropic's own statusline computes** for terminal Code. It's Anthropic's own figure, not a third-party reconstruction from broken logs (and not a guarantee of your final invoice — it's Anthropic-computed, terminal-Code). Everything else — the Fable forecast, the cross-model comparison, desktop and Cowork estimates — is clearly labeled as an estimate, so you always know which numbers are solid and which are projections.

That's the whole idea: when the model landscape gets confusing, the tracker's job is to make *your* costs legible, honestly. If you want the full picture of how Claude Code billing fits together — pools, credits, and limits — [start here](/developers).

## FAQ

**Is Claude Sonnet 5 cheaper than Opus 5?**
Per token, yes — $2/$10 undercuts Opus 5's $5/$25, and $2/$10 is now the standard price (the increase to $3/$15 scheduled for September 1, 2026 was cancelled). But it's not a guaranteed saving: Sonnet 5's tokenizer emits more tokens for the same work (often ~30% more), so the raw per-million gap overstates the real saving. Price it against your own usage with `wtclaude compare-models`.

**How much does Claude Fable 5 cost?**
Included up to 50% of your weekly limit on Max, Team Premium and Enterprise Premium — a share of that limit, not an allowance on top of it. On Pro and Team Standard it's usage credits from the first token at $10/$50 per million (cache-read $1), at standard API list rates; bundle discounts up to 30% and promos not reflected. Enterprise Standard is credits only if the org enables Fable. There's no cliff. Any figure is a labeled estimate that depends on your plan and your usage.

**How do I compare Claude models by cost?**
`wtclaude compare-models` re-prices your recorded usage across Opus 5, Sonnet 5, and Fable 5 — split by surface (Code billing-grade, Cowork a labeled estimate, Chat excluded), every projection labeled. It compares cost, not quality.

**Does the Sonnet 5 tokenizer make my cost tracking wrong?**
No. WTClaude reads the model's own reported token counts (and Anthropic's computed cost in terminal Code), so more tokens just register as more tokens — no drift. The tokenizer only matters as a caveat on cross-model *projections*.

**Is WTClaude affiliated with Anthropic?**
No — it's an independent, free, open-source project, not affiliated with Anthropic.

---

*WTClaude is a free, open-source, billing-grade Claude Code cost tracker. See what your month would cost on each model: `npx wtclaude setup`, then `wtclaude compare-models`. Numbers are billing-grade for terminal Code (Anthropic-computed) and clearly-labeled estimates everywhere else.*
