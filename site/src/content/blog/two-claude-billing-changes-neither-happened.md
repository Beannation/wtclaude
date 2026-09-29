---
title: "Two Claude Billing Changes Were Announced in Two Weeks. Neither Happened."
description: "The June 15 Agent-SDK credit split was paused before it took effect, and Claude Fable 5 was pulled days after launch. What the whiplash says about building on AI tools — and the one thing you can still control."
pubDate: 2026-06-16
updatedDate: 2026-08-24
author: "Peter Bean"
readingTime: "7 min read"
faq:
  - q: "Did the June 15 Claude billing change happen?"
    a: "No. Anthropic paused it on June 15 before it took effect. Agent SDK, claude -p, and third-party app usage still draw from your subscription's usage limits as before, and there's no separate credit to claim. Anthropic says it will give advance notice before any future change."
  - q: "Is Claude Fable 5 available?"
    a: "Yes. It was suspended on June 12, 2026 under a US export-control directive, days after its June 9 launch, but Anthropic redeployed it on July 1, 2026. Since July 20, 2026 it has been permanent and plan-conditional: on Max, Team Premium and Enterprise Premium it's included up to 50% of your weekly usage limit; on Pro and Team Standard it draws usage credits from the first token; on Enterprise Standard, credits only if your org enables it. There's no cliff and no countdown."
  - q: "Could either change come back?"
    a: "The Agent-SDK split is still paused — Anthropic said it's reworking the plan and will announce before anything takes effect. Fable already did come back: it was redeployed on July 1, 2026 and has been permanent and plan-conditional since July 20, 2026. We're still watching the split."
  - q: "Does WTClaude still work through all this?"
    a: "Yes. It tracks your real Claude Code usage in the terminal — billing-grade — regardless of how subscriptions or credits are structured. If a change does land, the relevant views are already built and ready."
---

> **Update — August 24, 2026:** One of the two came back. Anthropic **redeployed Claude Fable 5 on July 1, 2026**, and since July 20 it has been permanent and plan-conditional: included up to 50% of your weekly usage limit on Max, Team Premium and Enterprise Premium; drawing usage credits from the first token on Pro and Team Standard; on Enterprise Standard, credits only if the org enables it. There's no cliff and no countdown. **The June-15 Agent-SDK credit-pool split is still paused** and has never taken effect. Everything below is the June record, unchanged.

In the span of two weeks, two big changes to how you pay for and access Claude were announced. As of today, **neither one is in effect.** If you've felt a little whiplash trying to keep up, you're not imagining it — and there's a lesson in it worth more than either change would have been.

Here's what actually happened, and what it means for anyone who builds on these tools.

## Change one: the June 15 Agent-SDK billing split — paused

Back on May 14, Anthropic announced that starting June 15, Agent SDK usage, the `claude -p` command, and third-party apps would stop drawing from your subscription's usage limits and move to a separate monthly credit, billed at API rates once it ran out. We covered it in detail — both in a [dedicated explainer on the split](/blog/the-june-15-split/) and a [field guide to both changes](/blog/claude-billing-changes-june-2026/) — it was a real, significant change, especially for anyone running agents.

Then, on June 15, [Anthropic paused it](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan) before it took effect. In their words: "nothing has changed" — the Agent SDK, `claude -p`, and third-party apps still draw from your subscription's usage limits, exactly as before. There's no separate credit to claim. Anthropic said it's reworking the plan "to better support how users build with Claude subscriptions," and that it'll give notice before anything takes effect.

So if you spent the last few weeks bracing for the split: you can exhale. Nothing changed. (It may still return in some form — more on that below.)

## Change two: Claude Fable 5 — launched, then pulled

A few days earlier, on June 9, Anthropic released Claude Fable 5 — its most powerful generally available model. By June 12 it was gone: a US export-control directive required Anthropic to disable Fable 5 (and Mythos 5) for all users worldwide. That one wasn't a pricing decision at all — it was a government order — but the effect on anyone who'd started building around Fable was the same: here today, gone in three days. (We'd [broken down its pricing](/blog/claude-fable-5-pricing-explained/) during its brief free window.)

## We're not here to dunk on anyone

It would be easy to make this a "look at the chaos" post. We're not going to, because honestly, neither reversal is unreasonable. The Fable suspension was a government directive, not a choice. And the billing split addressed a genuine problem — an autonomous agent can burn 15–30× what a human does at the same subscription price, which was never sustainable — but Anthropic listened to a lot of unhappy developers and paused rather than push it through. Pausing in response to feedback is the system working, not failing.

What's striking isn't any single decision. It's the *pace*. In one fortnight: a model launched and vanished, and a billing overhaul was announced and shelved. The ground under AI tooling is moving fast — which models exist, what they cost, what "included" means — and it's moving with very little notice.

If you build or budget on these tools, that's the real headline: **you're building on shifting ground.**

## The one thing you can actually control

You can't control the announcements. You can't make a model stay available or a pricing plan stick. What you *can* control is your own visibility — knowing, at any given moment, what you're actually using and what it's actually costing you.

That number doesn't care which billing model is live this week. Whether your agent usage draws from one pool or two, whether Fable is available or not, whether the rules change again next month — your real, current usage is a fact you can see. And in an era where everything above it keeps shifting, that fact is the stable thing to stand on.

## Where WTClaude fits — including our own pivots

We'll be straight with you, because that's the whole point of this project: we built for both of these changes. We shipped a dual-pool view for the June-15 split and a cost forecast for Fable's pricing. Then both got pulled out from under us, like everyone else.

Here's why it didn't really matter. The core of WTClaude never depended on either change. It reads the statusline — [the same billing-grade source behind your bill](/blog/is-claude-code-cost-accurate/) — so whatever Anthropic ships, pauses, or pulls next, you can still see your actual Claude Code usage, billing-grade, in your terminal, today. The dual-pool view is sitting ready if the split returns. Fable did come back — redeployed July 1, 2026 — and the Fable support is ready. And everything stays labeled for exactly what it is, including the parts that might change again.

That's the posture we'd recommend to anyone right now: track what's real, and stay ready for what's next. You don't have to predict Anthropic's roadmap. You just have to be able to see your own numbers when the dust settles — which, lately, it keeps having to.

## FAQ

**Did the June 15 Claude billing change happen?**
No. Anthropic paused it on June 15 before it took effect. Agent SDK, `claude -p`, and third-party app usage still draw from your subscription's usage limits as before, and there's no separate credit to claim. Anthropic says it will give advance notice before any future change.

**Is Claude Fable 5 available?**
Yes. It was suspended on June 12, 2026 under a US export-control directive, days after its June 9 launch, but Anthropic redeployed it on July 1, 2026. Since July 20, 2026 it has been permanent and plan-conditional: on Max, Team Premium and Enterprise Premium it's included up to 50% of your weekly usage limit; on Pro and Team Standard it draws usage credits from the first token; on Enterprise Standard, credits only if your org enables it. There's no cliff and no countdown.

**Could either change come back?**
The Agent-SDK split is still paused — Anthropic said it's reworking the plan and will announce before anything takes effect. Fable already did come back: it was redeployed on July 1, 2026 and has been permanent and plan-conditional since July 20, 2026. We're still watching the split.

**Does WTClaude still work through all this?**
Yes. It tracks your real Claude Code usage in the terminal — billing-grade — regardless of how subscriptions or credits are structured. If a change does land, the relevant views are already built and ready.

---

*WTClaude is a free, open-source, billing-grade cost tracker for Claude Code — built to show you your real numbers no matter how the rules change. Independent, not affiliated with Anthropic. `npm i -g wtclaude`, then `wtclaude setup`.*
