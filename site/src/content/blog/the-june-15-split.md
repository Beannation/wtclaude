---
title: 'June 15 changes how you pay for Claude. Here’s the plain version.'
description: 'On June 15, Anthropic splits Claude billing into two pools — Interactive and Agent SDK Credits. Here’s what changes, who it hits, and how to stay ahead of it.'
pubDate: 2026-06-05
author: 'Peter Bean'
readingTime: '4 min read'
draftProse: true
---

<!--
  COPY BOUNDARY NOTE (Build → GTM, via Peter):
  The Wave-1 copy spec (website-copy-wave1.md §3) gives this post as an OUTLINE
  ("write to ~900–1,200 words, plain + helpful"), not finished prose. The Build lane
  is code-only and does not author marketing copy. Below is the route + template +
  every VERBATIM string the spec provides (headline, the factual points, the honesty
  note, the soft CTA), laid out section by section. The connective ~900–1,200-word
  prose is GTM's to write/approve. `draftProse: true` flags this state.
  DO NOT ship to production until GTM supplies/approves the full body.
-->

## What’s changing

One usage pool becomes two:

- **Interactive** — Claude.ai, Claude Code in the terminal, and Cowork. This draws on your subscription limits, the same as today.
- **Agent SDK Credits** — `claude -p`, the Agent SDK, GitHub Actions, and third-party agents. This draws on a separate dollar budget at full API rates, resets monthly, and does not roll over.

## Why it matters

If you run agents or `claude -p`, you now have a second, dollar-denominated budget that can run out mid-month. Tracking one pool was already opaque; now there are two.

## The numbers

Included monthly credits by plan: **Pro $20 · Max 5× $100 · Max 20× $200.** Credits reset monthly. No rollover.

## The trap

Most trackers read broken session logs and undercount your usage — so you can’t see either pool accurately. The problem isn’t any one tool; it’s the data source.

## What to do

- Start tracking now, so you have a baseline before the split.
- Watch your projected agent-pool burn.
- Get a yes/no on whether your included credits are enough.

> The forecast is a labeled estimate — billing-grade math, heuristic pool split — not a guaranteed bill.

## Get ready

WTClaude is a free, open-source tracker built on billing-grade data and ready for both pools — including a daily Agent-pool forecast and a June-14 readiness check.

```bash
npx wtclaude setup
```
