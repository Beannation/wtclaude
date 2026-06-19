---
title: "Claude Code's +50% Weekly Limits Expire July 13. Here's What Changes."
description: "The temporary 50% boost to Claude Code weekly limits ends July 13, 2026 — unless Anthropic extends it. It's a usage change, not a price change. Here's who it affects and how to know where you stand."
pubDate: 2026-06-19
author: "Peter Bean"
readingTime: "6 min read"
faq:
  - q: "When do Claude Code's higher weekly limits end?"
    a: "The +50% weekly-limit boost is set to expire July 13, 2026 at 6 PM PDT, unless Anthropic extends it. The permanent May changes (doubled 5-hour caps, peak-hour removal) don't carry an expiry — only the May-13 weekly boost does."
  - q: "Is this a price increase?"
    a: "No. Subscription prices aren't changing. This is a usage-limit change — how much you can do per week — not what you pay."
  - q: "How much will my weekly limit drop?"
    a: "If the boost lapses to the prior level, it's roughly a third less than the boosted ceiling you've had since May. The exact number depends on your plan; check `/usage` for your current ceiling."
  - q: "Could the boost be extended?"
    a: "Possibly — Anthropic hasn't said what happens after July 13, and recent changes have been fluid. Treat the date as one to watch. We're monitoring it."
  - q: "How do I see where I stand?"
    a: "`/usage` inside a session shows your current ceiling. WTClaude's `wtclaude limit` shows it continuously with reset countdowns, reading Anthropic's own rate-limit data — so it reflects whatever the limit is, before or after July 13."
---

If you've felt like Claude Code has been more generous since May, you're right — and one part of that generosity has an end date. The **+50% boost to Claude Code weekly limits expires July 13, 2026 (6 PM PDT)**, unless Anthropic extends it. Here's what's actually changing, who it touches, and the calm way to handle it.

## What's happening

Back in mid-May, Anthropic raised Claude Code's **weekly usage limits by 50%** for all paid plans — Pro, Max, Team, and seat-based Enterprise — across the CLI, IDE, desktop, and web ([ClaudeDevs announcement](https://x.com/ClaudeDevs/status/2054639777685934564)). It was the third wave of limit relaxation in quick succession (after the 5-hour caps doubled on May 6 and peak-hour throttling was removed), and it was explicitly framed as a limited-time boost running **through July 13**.

Two things to be clear about:

- **This is a usage-limit change, not a price change.** Pro is still $20/mo, Max 5× $100, Max 20× $200. Nothing about what you pay is moving. What's moving is how much you can *do* per week before you hit a wall.
- **It may be extended.** Anthropic hasn't said what the ceiling becomes after July 13. Given how fluid Claude's limits and billing have been lately (the June-15 Agent-SDK change was [announced and then paused](/blog/two-claude-billing-changes-neither-happened)), "July 13" is a date to watch, not a certainty. We're watching it; we'll update if it changes.

## What it means if it does lapse

If the boost simply ends and weekly limits return to their pre-May-13 level, affected subscribers lose roughly **a third of the extra weekly headroom** they've had since May (a +50% boost reverting is about a 33% drop from the boosted ceiling). In practice: you'd hit your weekly wall sooner than you've gotten used to — especially if your habits crept up to fill the extra room over the last several weeks.

The people most likely to feel it are heavy daily Claude Code users who've been comfortably *inside* the boosted ceiling and have stopped thinking about limits at all. That's the trap with a temporary increase: it quietly becomes your normal, and then normal moves.

## The calm way to handle it (no panic, no new tool)

You don't need to do anything dramatic. You need one thing: **know where you actually stand against your weekly limit** — before July 13, not after.

You can check it right now inside a session with `/usage`, which shows your current ceiling and how much of it you've used. If you want it continuously, WTClaude's limit view shows the same thing, reading Anthropic's own rate-limit data:

```
wtclaude limit
```

It shows how close you are to your overall plan limit, with reset countdowns — sourced from the rate-limit data Anthropic reports, so **whatever the ceiling is this week (or after July 13), the gauge reflects it.** We don't set or change your limit; we just show you Anthropic's number clearly, so a tighter ceiling shows up as a fact you can see rather than a wall you walk into.

## If you manage a team

If you administer a Team or Enterprise plan, this is worth a heads-up to your developers now rather than a surprise in mid-July. The boost applied per the plans above; if it lapses, the people running the heaviest weekly workloads are the ones who'll notice first. A quick "the extra headroom may end July 13 — check your `/usage`" note saves a round of confused Slack messages later.

## The bigger picture

This is the third limit change in about six weeks, on top of a billing overhaul that was announced and paused and a model that launched and was pulled. The ground keeps moving. None of it is a reason to panic — most of these moves have been *generous* (more headroom, not less) — but it's a good reminder that the one stable thing is your own visibility. If you can always see your real usage against whatever the current limits are, the announcements stop being scary and just become information.

That's the whole idea behind tracking honestly: you can't control the ceiling, but you can always know where you are under it.

## FAQ

**When do Claude Code's higher weekly limits end?**
The +50% weekly-limit boost is set to expire July 13, 2026 at 6 PM PDT, unless Anthropic extends it. The permanent May changes (doubled 5-hour caps, peak-hour removal) don't carry an expiry — only the May-13 weekly boost does.

**Is this a price increase?**
No. Subscription prices aren't changing. This is a usage-limit change — how much you can do per week — not what you pay.

**How much will my weekly limit drop?**
If the boost lapses to the prior level, it's roughly a third less than the boosted ceiling you've had since May. The exact number depends on your plan; check `/usage` for your current ceiling.

**Could the boost be extended?**
Possibly — Anthropic hasn't said what happens after July 13, and recent changes have been fluid. Treat the date as one to watch. We're monitoring it.

**How do I see where I stand?**
`/usage` inside a session shows your current ceiling. WTClaude's `wtclaude limit` shows it continuously with reset countdowns, reading Anthropic's own rate-limit data — so it reflects whatever the limit is, before or after July 13.

---

*WTClaude is a free, open-source, billing-grade Claude Code cost tracker. It shows your real usage against your plan's limits, reading Anthropic's own data — independent, not affiliated with Anthropic. `npx wtclaude setup`.*
