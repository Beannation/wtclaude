---
title: "How to Run a Claude Team Spend Audit (Free, in Your Browser)"
description: "A step-by-step guide to auditing your team's Claude spend: export the Anthropic Spend Report, run 8 checks in your browser, and find over-tiered seats, model-mix waste, and hidden costs — without uploading anything."
pubDate: 2026-07-09
author: "Peter Bean"
readingTime: "6 min read"
faq:
  - q: "How do I audit my team's Claude Code spending?"
    a: "Export your Anthropic Spend Report CSV (Settings → Analytics → Export Spend Report, as an Owner), then run it through a spend audit that reads it locally. WTClaude's free browser-based audit runs 8 checks — over-tiered and idle seats, spend concentration, model mix, hidden metered surfaces, $/request outliers, and more — without uploading your file."
  - q: "Where do I get the Anthropic Spend Report?"
    a: "In claude.ai, go to Settings → Analytics → Export Spend Report, and pick your window (e.g. last 90 days). You need to be an Owner or Primary-Owner on a Team plan. It's a per-user, per-model CSV of usage and spend."
  - q: "Is it safe to upload my Claude spend report to an audit tool?"
    a: "With WTClaude's audit, nothing is uploaded — the whole analysis runs in your browser, so your spend file (which contains employee emails and dollars) never leaves your device. Prefer any tool that's explicit about running client-side."
---

If your Claude bill has quietly grown and you're not sure where the money's going, a spend audit is the fastest way to find out — and you can do it in about a minute, for free, without handing your data to anyone. Here's exactly how.

<p class="rounded-lg border border-amber/30 bg-amber-light/40 px-4 py-3 text-sm"><a href="/business/audit" data-track="cta_spend_audit_blog_how_to_run" class="font-semibold text-amber-deep hover:text-amber">Audit your team's Claude spend, free →</a></p>

## What you'll need

- **Owner (or Primary-Owner) access** on a Claude Team plan.
- Your **Anthropic Spend Report** — the per-user, per-model CSV of usage and spend.

That's it. No install, no signup for the headline result.

## Step 1 — Export your Anthropic Spend Report

In claude.ai:

1. Go to **Settings → Analytics**.
2. Click **Export Spend Report**.
3. Pick a window — **Last 90 Days** is a good default.

You'll get a CSV with one row per person × model: usage volume (requests and tokens) and spend. *(Note: this is the per-user Spend Report from claude.ai — not the API/Console billing export, which doesn't have per-person detail. If you grab the wrong one, the audit will tell you and point you to the right export.)*

## Step 2 — Run the 8 checks (in your browser)

Head to the free audit and drop the CSV in:

→ **[Run the free spend audit](/business/audit)**

The whole thing runs **on your device** — your spend file (which carries employee emails and dollars) **is never uploaded or stored**. It parses locally and runs 8 checks:

1. **Dead-weight seats** — over-tiered and idle seats you could right-size or reclaim.
2. **Spend concentration** — how much of the bill a few people drive (the "your top user costs 7× the median" reveal).
3. **Model mix** — how much is going to expensive models (e.g. Opus running where a cheaper model would do).
4. **Hidden metered surfaces** — line items admins often don't realize are billed.
5. **$/request outliers** — the sessions that cost far more than the team median (often runaway agents or huge context).
6. **Discount / list exposure** — how much of your spend is masked by credits (renewal-relevant).
7. **Allocation by domain** — employees vs contractors at a glance.
8. **Context ratio** — a coarse proxy for prompt-heavy waste.

You'll see an instant headline number first (no email), then the full per-person breakdown.

## Step 3 — Act on it (you're in control)

Everything the audit shows is a **recommendation you confirm** — it never changes anything in your account. The usual moves:

- **Right-size** over-tiered seats (Premium → Standard) and **reclaim** dormant ones. *(To turn "uses Standard-level volume" into a downgrade, pair it with your seat roster — the audit is explicit about that. More on [seat tiers and how to spot the overpay](/blog/claude-team-seat-pricing-premium-vs-standard).)*
- **Nudge model mix** — move cheap tasks off the expensive model.
- **Investigate the $/request outliers** — that's where runaway spend hides.

## Step 4 — Put it on a cadence

Team composition drifts every month, so a one-time cleanup drifts back. The audit takes a minute — re-run it monthly (you can opt in to a figure-free reminder) and the savings stick.

## A couple of honest caveats

- On **seat-based plans**, within-allotment usage is the flat seat fee, so some dollar figures are **overage-only** and every projection is a **labeled estimate** ("should closely match your invoice"). The audit leans on request/token *volume*, which is always present.
- Exact **Premium→Standard** right-sizing needs your seat roster (the CSV gives usage, the roster gives who's on which tier).
- It's a **snapshot**, not monitoring. Catching a spike *as it happens* is a different (paid, coming-soon) job; the free audit is the point-in-time read.

That's the whole process. It's independent (we don't sell Claude seats), free, and your data never leaves your browser.

→ **[Run the free spend audit](/business/audit)** — or see [WTClaude for Business](/business), and the [broader July 2026 pricing picture](/blog/state-of-claude-pricing-july-2026) this audit fits into.

## FAQ

**How do I audit my team's Claude Code spending?**
Export the Anthropic Spend Report CSV (Settings → Analytics, as an Owner), then run it through the free [browser-based audit](/business/audit) — 8 checks, nothing uploaded.

**Where do I get the Anthropic Spend Report?**
claude.ai → Settings → Analytics → Export Spend Report; pick your window. Requires Owner/Primary-Owner on Team.

**Is it safe to upload my Claude spend report?**
With WTClaude's audit nothing is uploaded — it runs entirely in your browser, so the file never leaves your device.

**What does the audit actually check?**
Eight things: dead-weight seats, spend concentration, model mix, hidden metered surfaces, $/request outliers, discount exposure, domain allocation, and context ratio.

---

*WTClaude is a free, open-source, billing-grade Claude Code cost tracker — independent, not affiliated with Anthropic. [Run the spend audit](/business/audit) — 8 checks, in your browser, nothing uploaded.*
