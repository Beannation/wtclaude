# Data notes — what WTClaude knows, what it estimates, and what it cannot see

Last reviewed **2026-08-24**. Every fact below is traceable to an Anthropic
primary read on the date shown, or is explicitly labelled as our own measurement.
Where Anthropic has not stated something, this file says so rather than guessing.

---

## The one number we do not compute

For **terminal Claude Code**, the headline cost is the `cost.total_cost_usd` field
that Claude Code itself puts in the statusline payload. We record it and we never
recompute it, never multiply it, and never adjust it.

That matters because the modifiers are already inside it: data residency, fast
mode, long context and batch are all applied before we see the number. Re-applying
any of them — the 1.1× residency premium in particular — would double-count. (One
version boundary applies: the residency premium entered that figure in v2.1.239,
so records from earlier builds in a residency workspace under-report by ~10%.)

What that figure is *not* is a copy of your invoice. Anthropic describes it as
computed client-side and says it may differ from your actual bill — see [What
Anthropic says the cost field actually is](#what-anthropic-says-the-cost-field-actually-is)
below, which is the precise version of this and should be read before anyone
describes the number in public copy.

Everything else on this page is an estimate, and is labelled as one wherever it is
shown.

## Coverage boundary — sessions we cannot see

> WTClaude tracks local Claude Code sessions on this machine. Sessions that run on
> Anthropic's infrastructure — claude.ai, the desktop and mobile apps,
> `claude --cloud`, and scheduled routines — are not visible to it, and neither
> their cost nor their usage appears in any WTClaude figure.

*Can we at least tell that a cloud session happened?* **No.** The collector is a
statusline hook: it is invoked by a local Claude Code process and sees only what
that process pipes to it. A session that never runs locally never invokes it, and
leaves no trace we can read. We do not attempt to infer one, and no WTClaude
number should be described as covering "all your Claude usage".

*Does `/usage` include cloud sessions?* Unknown to us. We have not found an
Anthropic statement either way, so we do not claim one.

> **Canon note.** The boundary sentence above is drafted here for the PMO to
> cascade into `messaging-foundation.md`. It is not a canon edit; Build does not
> edit canon.

## Estimates and what they are worth

### Credits-denominated figures

Any figure we print in usage credits carries this label:

> at standard API list rates; bundle discounts up to 30% and promos not reflected

That is not boilerplate hedging. Pre-purchased usage bundles change the effective
rate by a user-specific amount — $50 → $45 (10% off), $250 → $200 (20%), $1000 →
$700 (30%) — and nothing in local data reveals which bundle, if any, a user holds.
A figure priced at list can therefore overstate the real cost by up to 30%,
invisibly. Anthropic's own `/usage` carries the same limitation and says so.

Source: Help Center article 14246112 (usage bundles).

### `whatif` and `compare-models`

Both sides of every comparison are priced with the **same** token × rate method on
the **same** turns, so re-pricing a model you already run nets ~$0 rather than
appearing magically cheaper than your bill.

Turns we cannot price at first-party rates are **excluded from both sides and
counted**, and the count is printed. Those are:

- an unresolved model id;
- a partner-platform id (`vertex_ai/…`, `bedrock/anthropic.…` — Amazon Bedrock and
  Google Cloud publish their own rates, and their regional endpoints carry a 10%
  premium over global, so our first-party rate is not authoritative);
- a family-fallback guess (an Opus we do not have an explicit entry for).

Counting these at $0 — which is what used to happen — quietly flattered the
comparison and never told the user a turn had gone missing.

### Token counts are context-window occupancy, not billed tokens

This one is **documented by Anthropic**, and we confirmed it against our own data.
The statusline reference says, verbatim:

> **Combined totals** (`total_input_tokens`, `total_output_tokens`): tokens
> currently in the context window. `total_input_tokens` is the sum of
> `input_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`

and describes `context_window.current_usage` as "Token counts from the last API
call". So these are **current-window and per-request values, not cumulative
counters**, and the input figure already contains cache reads and writes.

Our own corpus agrees: across 24,612 records from 75 sessions, input equals
cache-read plus cache-write to within 1–2 tokens in **99.2%** of records.

The practical consequence: the per-turn token figures we store describe how the
context window grew, not how many tokens were billed, and reading them as
cumulative counters double-counts cached input. Summing them recovers only about a
quarter of the billing-grade cost anchor. **Read token counts as context
occupancy. Read cost from the anchor.** Reshaping the collector's token accounting
is tracked for a later release; the headline cost is unaffected either way,
because it never came from the tokens.

Source: code.claude.com/docs/en/statusline, read 2026-08-24.

### What Anthropic says the cost field actually is

Our headline comes from `cost.total_cost_usd`. The statusline reference describes
that field as:

> Estimated session cost in USD, computed client-side. May differ from your actual
> bill. Resets to $0 when `/clear` starts a new session

That is worth stating plainly. The figure is computed by Claude Code on your
machine from finalized token counts at list rates — it is not retrieved from
Anthropic's billing system, and Anthropic does not promise it equals your invoice.
What it *does* give us, and what the session logs do not, is the correct token
counts: post-finalization, including thinking tokens.

So: our number matches what Claude Code itself reports for the session. Anyone
describing it should be careful not to promise more than Anthropic promises about
its own field.

> **Canon flag.** The product's central claim is worded around this field. The
> wording is locked canon and is not Build's to change — the discrepancy has been
> routed to the PMO with the quote above. This note records the fact, not a
> decision.

Source: code.claude.com/docs/en/statusline, read 2026-08-24.

### The model on a turn is the one you selected, not necessarily the one that answered

Each record's `model` is the session's configured model, taken from the payload's
`model.id` ("Current model identifier and display name"). Every record now also
carries `model_source: 'session_setting'` so this is never mistaken for something
stronger.

Anthropic's Cookbook is explicit that this is the wrong field for attribution:

> Build serving-model analytics from `usage.iterations`, not from the model you
> requested. The response's `model` field is the model that actually answered, so
> a fallback-served turn reports Opus 4.8. Analytics recorded against the
> _requested_ model will be wrong whenever a fallback is used.

The statusline payload carries **no `iterations` field and no serving-model field
of any kind** — verified against the statusline reference on 2026-08-24, where the
string "iterations" does not occur.

So a fallback-served turn is attributed here to the model you selected, and we
cannot see that it happened. Per-model splits should be read as **"attributed by
session model setting"**. We do not know how often this bites: the Cookbook says
server-side fallback is per-request opt-in behind a beta header, and Anthropic has
not stated whether Claude Code sends it, so the exposure is real but unquantified.

Sources: platform.claude.com/cookbook/fable-5-fallback-billing-guide and
code.claude.com/docs/en/statusline, both read 2026-08-24.

### The `compare` gap is not a like-for-like token comparison

`wtclaude compare` puts our input-token figure next to the session logs' and
prints a ratio. Two things about that ratio need saying plainly.

**The two sides are not the same quantity.** Our figure is derived from
`context_window.total_input_tokens`, which Anthropic documents as the sum of
uncached input, cache creation and cache reads. The session-log figure is the
API's `input_tokens`, which is uncached input only. Some of the ratio is the real
session-log undercount the tool exists to show; some of it is the two sides
measuring different things.

**Transcript discovery used to bias it further in our favour.** Until 2026-08-24
the reader walked one directory level and honoured neither `CLAUDE_CONFIG_DIR` nor
nested transcripts, so it read 49 of 621 transcript files on a real machine — 2.4M
of 5.4M session-log input tokens. Under-reading the other side inflates the gap.
That is fixed; the ratio it produces is now smaller and more defensible.

> **Canon flag.** The gap figure appears in public copy and in the claim ledger.
> The first point above is not something Build resolves on its own — it has been
> routed to the PMO together with the cost-field wording. Until it is settled, the
> honest internal reading of the ratio is "our window-growth figure against their
> uncached-input figure", not "they undercount input by N×".

## Cache pricing

| Cache operation | Multiplier on base input |
| :-- | :-- |
| 5-minute cache write | 1.25× |
| 1-hour cache write | 2× |
| Cache read (hit) | 0.1× |

Cache-write tokens are their own billed quantity, charged when content is first
stored — not a premium layered on top of an input charge.

Where a payload does not tell us which TTL was in play, we use the **1-hour** rate.
Two independent reasons: Anthropic's costs doc states that subscription cache
lifetime is 1 hour, and fitting 24 clean local sessions against their own
billing-grade cost anchors implies a multiplier of **2.10** (median), reconstructing
0.991 of the anchor at 2.0× versus 0.899 at 1.25×.

**Caveat we cannot resolve:** once usage credits engage, the cache lifetime
collapses to 5 minutes unless `ENABLE_PROMPT_CACHING_1H=1` is set (default off).
That crossing is not visible in local data, so the 1-hour default is a labelled
assumption about the common case, not a measurement of any individual turn.

Opus 5 has a 512-token cache minimum, so small cache lines on Opus 5 are normal
and are not flagged as anomalies.

## Credits expire

From **2026-09-10**, in certain jurisdictions (the article names Japan as an
example, and does not publish the full set), usage credits expire six months after
purchase, with a 7-day email warning and visible expiry dates in-product.

**"Credits don't expire" is banned copy** — in the CLI, the docs, and on the site.
The jurisdiction set is not published, so the sentence cannot be made safe by
qualifying it.

Fable promotional credits are separate and harder-edged: claiming closed
2026-08-02, and the credits expire **2026-09-17 at 11:59 PM PT regardless of when
they were claimed**. They are spent before other credits, including auto-reload,
and that happens silently.

Source: Help Center articles 12429409 (usage credits) and 15862783 (Fable promo).

## The Agent-SDK credit split is paused

The split announced for 2026-06-15 has never taken effect. Agent SDK usage,
`claude -p`, and third-party integrations draw the subscription's ordinary usage
limits. `isDualPoolActive()` reads `agent_sdk_pool.activated` from the rate sheet —
deliberately not a date, because a date gate cannot be right about an event that
did not happen, and for two months it told users the split was live.

Source: Help Center article 15036540.

## What drives cost up (facts, not advice)

Behaviours that shipped as defaults in Claude Code during 2026 and materially
change consumption:

- **Subagent forking is on by default** (v2.1.232, 2026-08-13).
- **Nested subagent depth went 1 → 3** (v2.1.219).
- **The 200-subagent per-session cap was removed** (v2.1.224).
- **Agent teams cost roughly 7× plan mode**, off by default behind an env var.
- **Auto-memory is sent to subagents**, which inflates their context.
- **Scheduled tasks, cross-session messages and goal check-ins send full context
  on every fire.**
- **`/compact` is itself a large request; `/clear` is free.**
- **Cache TTL collapses to 5 minutes once credits engage**, so cache-heavy work
  gets more expensive exactly when it starts being billed.

We report these as mechanics. We do not tell you which to turn off.

## Unknowns we refuse to assert

Each of these is genuinely undetermined. Where our code has to do *something*, it
does the defensive thing and labels it.

| Question | Status |
| :-- | :-- |
| Do auto-mode **classifier tokens** appear in the local data we read? | Undocumented on Anthropic surfaces (costs, auto-mode-config, permission-modes all checked 2026-08-23). We do not claim an answer in either direction. |
| Do **529 retries / truncated streams** consume limits? | No Anthropic primary exists. Never stated in our copy. |
| Can we tell "long-context tier engaged" from "plan limit reached" from "credits engaged"? | Underlying reports are third-party GitHub issues with no Anthropic admission and no pinnable version. Treated as reports. |
| Were **credits consumed or refunded** during the Fable mis-gating episode? | Never had an Anthropic-primary source. We say nothing about it. |

A third-party bug report is a report. It is never an admission, and it never
becomes a fact in our copy by being repeated.

## Version boundaries that affect stored data

Claude Code read-surface behaviour changes in specific builds, and records we
already stored straddle those changes.

| Build | Change | Why it matters to stored records |
| :-- | :-- | :-- |
| 2.1.211 | `/clear` now resets the session cost counter | Before this, session totals accumulated across `/clear` for the process lifetime |
| 2.1.211 | Gateway trailing-context billing regression fixed | Gateway paths only (Bedrock/Vertex/Mantle/Foundry) |
| 2.1.214 | Session cost/token telemetry double-counting on multi-`message_delta` streams fixed | ≤2.1.213 telemetry could double-count |
| 2.1.216 | Statusline double-invocation on resume fixed | ≤2.1.215 could invoke the collector twice on resume |
| 2.1.217 | Silent transcript loss fixed | ≤2.1.216 could lose transcript data |
| 2.1.222 | `/usage` over-attribution to MCP servers fixed | Anthropic's own attribution defect |
| 2.1.223 | Canonical-ID resolution; provider-prefixed model ids | Introduced the `vertex_ai/…` and `bedrock/anthropic.…` shapes |
| 2.1.228 / 2.1.233 | Auto mode becomes default (mac/Linux/WSL / native Windows) | Classifier fires under every Agent tool call |
| 2.1.234 | `CLAUDE_CODE_PROJECT_DIR_NAME` makes the transcript directory configurable | Affects any reader that assumes a path |
| 2.1.239 | Data-residency premium enters `/cost` and the statusline | Before this, residency workspaces under-reported ~10% |

The collector records `cc_version` on every turn, so these boundaries are
answerable per record rather than guessed at in aggregate.

## Notes for whoever maintains this

- **Version truth** = the npm packument plus `code.claude.com/docs/en/changelog`.
  The `release-notes` path 404s, `whats-new` lags and skips weeks, and **2.1.230
  does not exist**.
- The `stable` and `latest` channels can sit far apart (2.1.231 vs 2.1.241 on
  2026-08-23), so two developers in one workspace can legitimately read ~10%
  differently on residency.
- Anthropic Help Center **visible dates round** ("Updated over 2 months ago") —
  read the embedded `lastUpdatedDate` ISO field instead.
- Rates live in the newest `src/config/pricing-YYYY-MM-DD.json` and nowhere else.
  `src/compare-models/web-parity.test.js` enforces that for the browser dashboard,
  which is where the last silent drift happened.
