# Changelog

## 0.3.1 — 2026-09-27

Two new default models, and the schema change they forced: **cache-read pricing
is now per model, with three multipliers.**

- **Claude Opus 5.5 (`claude-opus-5-5`)** has been Claude Code's **default model
  on every paid plan** since v2.1.280 (2026-09-22). Pro and Team Standard moved
  from Sonnet to Opus that day, and the default Opus became Opus 5.5.
- **Claude Fable 5.1 (`claude-fable-5-1`)** has been Claude Code's **default
  Fable model** since v2.1.257 (2026-09-01).

Neither is an opt-in, so both have been arriving in local data without users
choosing them. 0.3.0 knew neither.

### The load-bearing change

Anthropic's pricing page, §Prompt caching:

> Cache read (hit): 0.1x base input price (0.025x on Claude Fable 5.1 and Claude
> Mythos 5.1; 0.05x on Claude Opus 5.5)

| Model | In / out per MTok | Cache read per MTok |
| :-- | --: | --: |
| Opus 5.5 | $4 / $20 | **$0.20** (0.05×) |
| Opus 5 | $5 / $25 | $0.50 (0.1×) |
| Fable 5.1 | $10 / $50 | **$0.25** (0.025×) |
| Fable 5 | $10 / $50 | $1.00 (0.1×) |
| Sonnet 5 | $2 / $10 | $0.20 (0.1×) |

One global multiplier cannot express this. Fable 5 and Fable 5.1 differ **only**
in the price of a cache read, and Opus 5.5 is 0.05× where every other Opus is
0.1×. So the rate sheet carries a per-model `cache.read_multiplier` that
overrides the global default, resolved as **model override → global default**.
Left alone, this is the quietest kind of wrong: cache reads priced 4× too high on
Fable 5.1 and 2× too high on Opus 5.5, in the surface where cache reads dominate
the bill, with nothing throwing and no figure looking obviously off.

### Prices and models

- **Claude Opus 5.5 added:** $4/$20, cache reads $0.20, cache writes $5
  (5-minute) / $8 (1-hour), fast mode $8/$40. Caching multipliers apply on top of
  fast mode, so a fast Opus 5.5 cache read is $0.40 per MTok — derived by that
  stated rule, since the pricing page does not print the figure.
- **Claude Fable 5.1 and Claude Mythos 5.1 added.** Mythos 5.1 is priced and
  marked not-selectable in Claude Code, the same treatment Mythos 5 gets.
- **Opus 5 and Fable 5 are unchanged and still fully priced.** Both remain Active
  on the Claude API (retirement not sooner than 2027-07-24 and 2027-06-09). Both
  leave the three-model comparison, not the product: historical turns on them
  still cost correctly.
- **The comparison set is now Opus 5.5, Sonnet 5 and Fable 5.1** — Claude Code's
  current default in each family.
- Rates re-read from the live pricing table on 2026-09-27 (18 rows). Every rate
  carried forward from the previous sheet was verified unchanged by script.
- **Sonnet 5 is still $2/$10.** The September 1 increase did not occur; the
  cancellation note is still on the pricing page.

### What this fixes in your numbers

Your **headline cost was unaffected** throughout: it is the cost figure Claude
Code itself reports, not a figure from our rate table. What 0.3.0 got wrong was
the secondary calculations.

- **Opus 5.5 resolved to Opus 5's rates.** `claude-opus-5-5` matched no entry and
  fell to the Opus family fallback, which is flagged as a guess:
  - `compare-models` dropped those turns from the comparison **and from the
    baseline**, and only `--json` said so. A user whose window was all Opus 5.5
    was told **"No usage data found"**.
  - `waste` priced Opus 5.5 dead weight at $0.50 per million cache-read tokens
    instead of $0.20, and labelled the rate billing-grade.
  - The dashboard's model comparison priced every Opus 5.5 turn at Opus 5's
    rates, with no mark at all.
- **Fable 5.1 resolved to nothing.** `compare-models` dropped those turns the same
  way, and `wtclaude fable` stated a flat "$1 cached" rate — 4× too high on Fable
  5.1.
- **Excluded turns are now always stated.** Any turn we cannot price at
  first-party rates — a model not in this version's rate sheet, a partner-platform
  id, or a family-fallback guess — is left out of both sides of a comparison and
  **named**, in the CLI and on the dashboard. When that empties a whole window, it
  says so instead of reporting no usage. Your headline cost is unaffected.
- **A guessed rate never produces a figure shown as ours.** `waste` and the
  dashboard's context-waste tile now withhold their dollar figure for a
  family-fallback, partner-platform or unknown model, and say why. The next model
  we have not added yet lands on this path on day one.
- `waste`, the dashboard's context-waste tile and `wtclaude fable` resolve the
  cache-read multiplier per model, and name it — the hard-coded "10%" is gone.
- The dashboard's **What If** page kept its own hand-typed price table (Opus 4.8,
  Sonnet 4.6 and Haiku 4.5, no cache writes, compared against your billed cost
  rather than on the same basis). Its model comparison now runs on the same
  shared calculation as `compare-models`.

### Dates that passed while this release was being prepared

- **Fable 5 promotional credits expired** on 2026-09-17 at 11:59 PM PT.
  `wtclaude fable` now speaks of them in the past tense, and shows nothing about
  them when your Fable usage is Fable 5.1 only — they never applied to Fable 5.1.
- **Usage-credit expiry is in effect** (since 2026-09-10) in certain
  jurisdictions, Japan among them.
- The Max 20x price ($200 a month) is now verified against Anthropic's Help
  Center rather than carried forward.

### Corrections to things we were saying

- **The Fable caveat carried a countdown that had been false since July.** Both
  the CLI and the dashboard said Fable was included "through ~July 19" / "through
  July 7", then billed usage credits. Fable has been permanent and
  plan-conditional since 2026-07-20 — the plan you are on answers the question,
  not the date. Corrected in both, and the honesty gate now catches the shape of
  a Fable date countdown, not merely the word "cliff".
- **Sonnet 5 has not been the Claude Code default since v2.1.280.** The honesty
  gate now catches any current-facing description of it as the default.
- **`compare-models` described "Opus 4.8 vs Sonnet 5 vs Fable 5"** in its help
  text and header, and the dashboard tile named Opus 4.8. Both are derived from
  the comparison set now and cannot drift from it again.
- Fable copy throughout is **family-scoped**: the plan mechanic attaches to
  Fable, not to one Fable model, so Fable 5.1 inherits it and so will the next.

### Notes

- Fable 5.1 turns recorded on Claude Code **2.1.257–2.1.259** carry an unusually
  high share of uncached input: prompt caching did not cover context attached
  after tool results, and it was re-sent uncached on every tool-call turn
  (fixed in 2.1.260). Those turns were billed as recorded, so the cost is right;
  the token *mix* is not representative. See `docs/DATA-NOTES.md`.
- The `rate_limits.spend_limit` and `prompt_cache` fields added in 2.1.252 are
  **ignored** by the collector, not captured and not a crash.
- Anthropic says Opus 5.5 "costs 40% less to run than Opus 5". That is their
  measurement from their tests, and it includes using fewer tokens per task.
  `compare-models` re-prices your recorded tokens at fixed counts, so it shows
  the rate difference only.

## 0.3.0 — 2026-08-24

Model and price accuracy pass. Rates are rebuilt from the live Anthropic pricing
table read on 2026-08-24, Fable 5 is handled as the plan-conditional offering it
became in July, and several surfaces stopped stating things that are not true.

### Prices and models

- **Claude Sonnet 5 stays $2/$10.** The increase to $3/$15 that Anthropic had
  scheduled for September 1 was cancelled, and the shipped rate sheet no longer
  carries it. Previous versions encoded it as a dated change that would have
  applied itself on August 31 without an update.
- **Claude Opus 5 is priced directly** — $5/$25, fast mode $10/$50 — instead of
  resolving through the Opus family fallback. It has been Claude Code's default
  `opus` since 2.1.219.
- **Every model on the pricing table now has its own entry.** Opus 4.7, 4.6 and
  4.5, Sonnet 4.5, Mythos 5, and the retired Opus 4.1, Opus 4, Sonnet 4 and
  Haiku 3.5. Retired models price at their real historical rates, so old sessions
  summarise correctly — Opus 4.1 records were being costed at $5/$25 against a
  real $15/$75, and Sonnet 4 and Haiku 3.5 were costing nothing at all.
- **Fast mode is Opus 5 and Opus 4.8 only.** Opus 4.7 and 4.6 no longer inherit
  fast-mode rates; on Opus 4.7 the option errors, and on Opus 4.6 it runs at
  standard rates.
- **Cache writes are priced correctly** at 1.25× base input for the 5-minute
  cache and 2× for the 1-hour cache, replacing a single 0.25× multiplier that
  under-priced them substantially. Where the data does not say which cache
  lifetime applied, the 1-hour rate is used and labelled.
- Model ids that name a cloud provider (`vertex_ai/…`, `bedrock/anthropic.…`)
  resolve to the right model instead of costing nothing. Because those platforms
  publish their own rates, such turns are marked and left out of `whatif`
  comparisons rather than compared at first-party prices.

### Fable 5

- **`wtclaude fable` now answers the question your plan actually asks.** Fable 5
  has been permanent since July 20, and what it costs depends on the plan, not on
  a date: included on Max, Team Premium and Enterprise Premium up to 50% of the
  weekly usage limit, and billed as usage credits on Pro and Team Standard. The
  old countdown to an allowance deadline is gone.
- If no plan is set, both readings are shown side by side rather than one being
  assumed — they differ by the entire bill.
- Usage in a window is broken out by how it actually billed, so usage from before
  July 20 is not relabelled under today's rule.
- Promotional credit facts are surfaced: claiming closed August 2, credits expire
  September 17 at 11:59 PM PT regardless of when they were claimed, and they are
  spent ahead of other credits, including auto-reload.

### Credits and limits

- **`credits`, `forecast` and `readiness` no longer describe the Agent-SDK credit
  split as being in effect.** It was announced for June 15 and paused, and these
  commands had been reporting it as live, including a balance against an
  allowance that does not exist.
- Figures denominated in usage credits carry the note that they are at standard
  list rates, since pre-purchased bundles change the effective rate by an amount
  local data cannot see.

### Elsewhere

- `whatif` reports how many turns it could not price and why, instead of counting
  them as zero.
- `compare-models` compares Opus 5, Sonnet 5 and Fable 5. The dashboard's copy of
  the rate table is now checked against the shipped one on every test run.
- New `docs/DATA-NOTES.md` covers what is billing-grade, what is estimated, what
  WTClaude cannot see, and the questions it deliberately does not answer.

## 0.2.3 — 2026-07-13

Fable allowance date re-anchored.
