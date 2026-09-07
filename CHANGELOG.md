# Changelog

## 0.3.1 — 2026-09-07

Claude Fable 5.1 support, and the schema change it forced: **cache-read pricing
is now per model**.

### The load-bearing change

Anthropic's pricing page carries this footnote on the model table:

> Cache hits and refreshes on Claude Fable 5.1 and Claude Mythos 5.1 are priced
> at 0.025x the base input price. All other models use the standard 0.1x
> multiplier.

Fable 5 and Fable 5.1 have **identical** $10/$50 base rates. The single thing
that separates them is the price of a cache read — $1.00/MTok against
$0.25/MTok. One global multiplier cannot express both, so the rate sheet now
carries a per-model `cache.read_multiplier` that overrides the global default,
resolved as **model override → global default**.

Left alone, this would have been the quietest kind of wrong: every Fable 5.1
cache read priced 4× too high, in the surface where cache reads dominate the
bill, with nothing throwing and no figure looking obviously off.

### Prices and models

- **Claude Fable 5.1 (`claude-fable-5-1`) added.** It has been Claude Code's
  **default** Fable model since v2.1.257 (2026-09-01) — not an opt-in — so these
  rows have been arriving in local data without users choosing them. In 0.3.0
  the id resolved to nothing.
- **Claude Mythos 5.1 added**, priced and marked not-selectable in Claude Code,
  the same treatment Mythos 5 gets.
- **Claude Fable 5 is unchanged and still fully priced.** It remains Active on
  the Claude API (retirement not sooner than 2027-06-09). It is dropped from the
  three-model comparison, not from the product: historical Fable 5 turns still
  cost correctly.
- Rates re-read from the live pricing table on 2026-09-07 (17 rows). Every rate
  carried forward from the 2026-08-24 sheet was verified unchanged.
- **Sonnet 5 is still $2/$10.** The September 1 increase definitively did not
  occur; the cancellation note is still on the pricing page, re-read that day.

### What this fixes in your numbers

- A Fable 5.1 turn used to resolve to no rate at all. Your **headline cost was
  always right** — it comes from the billing-grade anchor, not from our rate
  table — but `compare-models` dropped those turns from both sides of the
  comparison **and from the baseline**, and only `--json` said so.
- `compare-models` now prints when turns were excluded, which model they were,
  and that your real charge is unaffected. That warning covers any unrecognised
  model, not just this one.
- `wtclaude fable` used to state a flat "$1 cached" rate. On Fable 5.1 that
  overstated cached input 4×. The rate line is now resolved from the rate sheet
  per model, and a window containing both Fable models shows both.
- `wtclaude waste` and the dashboard's context-waste tile price dead weight at
  the **cache-read** rate, so both were overstating a Fable 5.1 user's dead
  weight 4×. Both now resolve the multiplier per model.

### Corrections to things we were saying

- **The Fable caveat carried a countdown that had been false since July.** Both
  the CLI and the dashboard said Fable was included "through ~July 19" / "through
  July 7", then billed usage credits. Fable has been permanent and
  plan-conditional since 2026-07-20 — the plan you are on answers the question,
  not the date. Corrected in both, and the honesty gate now catches the shape of
  a Fable date countdown, not merely the word "cliff", which is how this got
  through. A test that *asserted* the false countdown is inverted into a guard.
- **`compare-models` still described "Opus 4.8 vs Sonnet 5 vs Fable 5"** in its
  help text and header, stale since the 0.3.0 Opus 5 swap. Both strings are
  derived from the comparison set now and cannot drift from it again.
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
