# Changelog

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
