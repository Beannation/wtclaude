# Data notes — what WTClaude knows, what it estimates, and what it cannot see

Last reviewed **2026-09-27**. Every fact below is traceable to an Anthropic
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
comparison and never told the user a turn had gone missing. Since 0.3.1 the
exclusion is also stated when it swallows a whole window: a surface whose every
turn was excluded says so, rather than reporting "no usage" — which is what 0.3.0
told a user whose week was all Claude Opus 5.5 before it had a rate for it.

**Since 0.3.2 these surfaces show percentages, not re-priced dollars.** Re-pricing
uses the per-turn tokens we record, and those are context-window occupancy (see
below), so a re-priced "your mix" came out 3.5–7× below the billing-grade total
for the same window. `compare-models` and `whatif --model` (and the dashboard's
/compare-models and /whatif) now print each model's difference as a percentage of
your re-priced mix, next to the real billing-grade total for the window, and
withhold absolute re-priced $/month until the collector records billed tokens
(BUILD-014). Nothing re-priced is labelled billing-grade.

**Cowork rows (0.3.2).** Cowork's `audit.jsonl` echoes the usage snapshot taken at
the START of each streamed reply on every line, so the final output count is not
in it, and it omits most subagent requests. The reader now takes the union of
each run's `audit.jsonl` and its own session transcripts
(`<run>/.claude/projects/**/*.jsonl`, including `subagents/`), keyed by message id,
keeping the record with the largest output (preferring one with `stop_reason` set,
never letting an all-zero record replace a real one). Cowork figures rose about
27% on the machine we measured. They stay labelled estimates (tokens × list rate);
the cost fields Cowork writes on its `result` lines are deliberately not used
(a canon question, E-7), and Haiku helper traffic that appears only in those
result lines is a known gap. Files older than the window are skipped by
modification time, and days are local dates, as for Code.

### A guessed rate is never a figure we present

The rate sheet has one family fallback: an Opus id with no entry resolves to the
newest Opus, flagged `fallback: true` and unpriceable. It fired for real on
2026-09-22, when Claude Opus 5.5 became Claude Code's default model and
`claude-opus-5-5` resolved to Opus 5's rates — cache reads at $0.50/MTok against
a true $0.20. The rule since 0.3.1: a family-fallback rate, a partner-platform id
or an unknown model never produces a dollar figure shown as ours.
`compare-models` and `whatif` exclude and count the turn. From 0.3.2 the same
holds for every total: an unanchored turn on such a model is left out of
`today`/`week`/`month`, `credits`, `forecast`, `readiness`, `fable`, `debrief` and
`leaderboard` and named under "Not priced", and none of them calls a list-rate
estimate billing-grade. `waste` (and the
dashboard's context-waste tile) **withholds** its dollar figure and says why,
because every dollar on that surface is rate × multiplier × tokens, so a guessed
rate is a guessed figure end to end. The item list and token sizes, which do not
depend on the rate, are still shown.

### Token counts are context-window occupancy, not billed tokens

This one is **documented by Anthropic**, and we confirmed it against our own data.
The statusline reference says, verbatim:

> **Combined totals** (`total_input_tokens`, `total_output_tokens`): tokens
> currently in the context window. `total_input_tokens` is the sum of
> `input_tokens`, `cache_creation_input_tokens`, and `cache_read_input_tokens`

and describes `context_window.current_usage` as "Token counts from the last API
call". So these are **current-window and per-request values, not cumulative
counters**, and the input figure already contains cache reads and writes.

Our own corpus agrees: in a large local corpus, input equals cache-read plus
cache-write to within 1–2 tokens in **over 99%** of records. So any share over
the "input side" counts each token once: `debrief`'s cache-read share and the
Cache Champion badge divide cache reads by the stored input where it already
holds the cache fields, and add them only on older rows that stored uncached
input alone (0.3.2; adding them every time counted cache twice and capped the
share at 50%).

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

Re-read 2026-09-27, the same row now reads: "Estimated session cost in USD,
computed client-side at list price unless a `modelPricing` table is in effect.
May differ from your actual bill." — the `modelPricing` qualifier matches the
2.1.243 boundary in the table below.

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

Since 2026-09-07 this cuts one layer finer: Fable 5.1 and Fable 5 are separate
rate-sheet entries with a 4× difference in cache-read price, so "attributed by
session model setting" now carries a price consequence within the Fable family,
not only across families. Since 2026-09-27 the same is true within Opus: Opus
5.5 and Opus 5 differ on every rate, cache reads by 2.5×.

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
nested transcripts, so on a real machine it read fewer than a tenth of the
transcript files and under half the session-log input tokens. Under-reading the
other side inflates the gap.
That is fixed; the ratio it produces is now smaller and more defensible.

> **Canon flag.** The gap figure appears in public copy and in the claim ledger.
> The first point above is not something Build resolves on its own — it has been
> routed to the PMO together with the cost-field wording. Until it is settled, the
> honest internal reading of the ratio is "our window-growth figure against their
> uncached-input figure", not "they undercount input by N×".

**What changed in 0.3.2.** The session-log reader now keeps the FINAL usage record
per response (Claude Code writes one at the start of each streamed reply and one
at the end; the first understated log output 1.5–5×). The log side is priced at
the model each record names, not a pinned Sonnet 4.6 rate, and unpriceable models
are excluded and named. Only sessions the collector also recorded are compared,
over the same local-date window. The "undercounts … N×" headline prints only when
the session-log figure is actually lower and the billing-grade column is fully
anchored; otherwise both figures are shown side by side without a verdict. Each of
these made the gap smaller, and on current data the session-log estimate is often
close to, or above, the billing-grade figure.

## Sync — what goes up, and how it recovers (0.3.2)

- **One manifest.** The payload and every privacy preview (`sync --enable`,
  `share --preview`, `leaderboard`, the README) are built from `SYNC_TURN_FIELDS`
  and `SYNC_SUMMARY_KEYS` in `src/sync/index.js`; a test fails if they drift.
  Git branch names go up as `#` + 12 hex of a salted SHA-256 (the install's
  `edit_hash_salt`), never raw; with no salt they go up as null. Local records keep
  raw names.
- **Estimates for unanchored turns.** A turn without a cost anchor carries
  `cost_estimate_usd` (the list-rate estimate the CLI shows), except turns the CLI
  excludes (family-fallback, partner-platform or unknown models), which carry null.
- **Bounded, resumable uploads.** Requests carry at most 1,000 turns / 1.5 MB;
  progress is the highest turn number the server confirmed per session, saved in
  `sync-state.json` after every request, so a failed or interrupted sync resumes.
  Failures are recorded (`last_sync_error`, `sync_failures`), shown by
  `sync --status`, and autosync backs off 10 → 20 → 40 min … 6 h. One sync runs at
  a time (`sync.lock`).
- **One-time history re-send.** Installs that synced before 0.3.2 can have gaps
  (0.3.1 skipped turns written while a request was in flight) and no estimates in
  the cloud. `sync-state.json` version 2 marks that history as re-sent. While it is
  below 2, the CLI re-sends the full history once — but only after a server reply
  carries `fills_missing` (the 0.3.2 server fills missing fields on known turns and
  ignores duplicates). Until then it syncs incrementally. With nothing else to send,
  `wtclaude sync` sends one empty request to ask (the 0.3.2 server stores nothing
  for it and answers with the marker; an older server's reply lacks it, and sync
  says the re-send is waiting).

## Cache pricing

| Cache operation | Multiplier on base input |
| :-- | :-- |
| 5-minute cache write | 1.25× |
| 1-hour cache write | 2× |
| Cache read (hit) | 0.1× — **except 0.05× on Opus 5.5, and 0.025× on Fable 5.1 and Mythos 5.1** |

Cache-write tokens are their own billed quantity, charged when content is first
stored — not a premium layered on top of an input charge.

### Cache reads are priced per model — three multipliers (2026-09-27)

The cache-read multiplier stopped being one global number when Fable 5.1 shipped
(2026-09-07), and gained a third value with Opus 5.5 (2026-09-27). Anthropic's
pricing page, §Prompt caching, verbatim:

> Cache read (hit): 0.1x base input price (0.025x on Claude Fable 5.1 and Claude
> Mythos 5.1; 0.05x on Claude Opus 5.5)

| Model | Base input | Cache read | Multiplier |
| :-- | --: | --: | --: |
| Claude Opus 5.5 | $4 / MTok | **$0.20 / MTok** | 0.05× |
| Claude Opus 5 | $5 / MTok | **$0.50 / MTok** | 0.1× |
| Claude Fable 5.1 | $10 / MTok | **$0.25 / MTok** | 0.025× |
| Claude Fable 5 | $10 / MTok | **$1.00 / MTok** | 0.1× |
| Claude Sonnet 5 | $2 / MTok | $0.20 / MTok | 0.1× |

Fable 5 and Fable 5.1 are otherwise identically priced, so a cache read costing
**a quarter** on Fable 5.1 is the whole difference between them. Opus 5.5 differs
from Opus 5 on every rate: identical tokens cost 20% less in and out ($4/$20
against $5/$25) and 60% less on cache reads. That arithmetic is ours to state.
Anthropic's own "costs 40% less to run than Opus 5" is their measurement, from
their tests, and includes fewer tokens per task — something re-pricing recorded
tokens cannot show. It is attributed as theirs wherever it appears and never
presented as something measured from your data.

Note that Opus 5.5 and Sonnet 5 share a $0.20 cache read ($4 × 0.05 = $2 × 0.1),
so a test that checks cache reads alone cannot tell them apart; ours assert input
and output rates too.

The rate sheet holds this as a per-model `cache.read_multiplier` that overrides
the global default, and the resolution order is **model override → global
default**. A model with no override inherits 0.1×, which is correct for every
other row. A model missing its override is silently wrong — Fable 5.1 cache reads
over-priced 4×, Opus 5.5 cache reads 2× — and because cache reads dominate agentic
sessions, that is the largest silent error available in this codebase. It is
pinned by tests on the sheet, the resolver, the browser comparison mirror and the
browser context-waste mirror, each mutation-tested.

Source: platform.claude.com/docs/en/about-claude/pricing, model pricing table
footnotes 1–2 and §Prompt caching, read 2026-09-27.

### Fast mode and cache reads

Fast mode exists on Opus 5.5 ($8/$40 per MTok), Opus 5 and Opus 4.8 ($10/$50).
The pricing page states that "Prompt caching multipliers apply on top of fast mode
pricing", so a fast-mode cache read is the model's own cache-read multiplier times
its **fast** input rate: 0.05 × $8 = **$0.40/MTok** on Opus 5.5, 0.1 × $10 =
$1.00 on Opus 5. The page prints the $8/$40 but not the $0.40 — that figure is
**derived** by the stated rule, and is labelled so wherever it appears. On
subscription plans fast mode draws usage credits only, never plan limits.

Source: platform.claude.com/docs/en/about-claude/pricing §Fast mode pricing and
code.claude.com/docs/en/fast-mode, read 2026-09-27.

### Cache-write TTL

Where a payload does not tell us which TTL was in play, we use the **1-hour** rate.
Two independent reasons: Anthropic's costs doc states that subscription cache
lifetime is 1 hour, and fitting 24 clean local sessions against their own
billing-grade cost anchors implies a multiplier of **2.10** (median), reconstructing
0.991 of the anchor at 2.0× versus 0.899 at 1.25×.

**Caveat we cannot resolve:** once usage credits engage, the cache lifetime
collapses to 5 minutes unless `ENABLE_PROMPT_CACHING_1H=1` is set (default off).
That crossing is not visible in local data, so the 1-hour default is a labelled
assumption about the common case, not a measurement of any individual turn.

Opus 5.5 and Opus 5 (and Fable 5.1 / Fable 5) have a 512-token cache minimum, so
small cache lines on them are normal and are not flagged as anomalies (prompt
caching docs, read 2026-09-27).

## Credits expire

Since **2026-09-10**, in certain jurisdictions (the article names Japan as an
example, and does not publish the full set), usage credits expire six months after
purchase, with a 7-day email warning and visible expiry dates in-product. Re-read
by slugged URL on 2026-09-27: in effect, wording unchanged.

**"Credits don't expire" is banned copy** — in the CLI, the docs, and on the site.
The jurisdiction set is not published, so the sentence cannot be made safe by
qualifying it.

Fable promotional credits were separate and harder-edged, and they are now
**expired**: claiming closed 2026-08-02, and the credits expired **2026-09-17 at
11:59 PM PT regardless of when they were claimed** (the article still gives that
date, re-read 2026-09-27). While live they were spent before other credits,
including auto-reload, silently. They covered Fable 5 only — there was never an
equivalent credit for Fable 5.1. `wtclaude fable` speaks of them in the past tense
after that instant, computed against the instant in Pacific time rather than the
calendar date.

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
| 2.1.243 | `modelPricing` managed setting | On an organisation that pins contracted rates, `/cost`, the statusline and telemetry report **contracted** cost, not list price. Our anchor is whatever that figure says, so on a managed org it is not a list-price number. |
| 2.1.252 | `rate_limits.spend_limit` status line field; per-session prompt-cache line in `/cost` plus a `prompt_cache` object for status line scripts | Both are **ignored**, not captured and not a crash. `rate_limits` is extracted whole but flattened to four named columns (`five_hour`/`seven_day` percentage and reset), so `spend_limit` is dropped; `payload.prompt_cache` is never read. Verified by running the collector against a 2.1.260-shaped payload: exit 0, record written, no breadcrumb. Records from 2.1.252 onward therefore carry neither field. |
| 2.1.257 | **Claude Fable 5.1 added and made the default Fable model** | `claude-fable-5-1` rows begin appearing without the user opting in. Records from before wtclaude 0.3.1 had no rate-sheet entry for it. |
| 2.1.260 | Prompt caching on Fable 5.1 fixed — context attached after tool results was being re-sent as uncached input on every tool-call turn | Fable 5.1 turns recorded on 2.1.257–2.1.259 carry genuinely higher uncached input and lower cache reads than the same work would produce today. The cost anchor is correct for what was actually billed; the token *mix* is not representative. |
| 2.1.271 | `modelPricing` multipliers may exceed 1 (up to 10) | A managed org can now pin rates *above* list (the stated purpose is internal chargeback), so on such an org the anchor can read higher than list price, not only lower. |
| 2.1.277 | A headless resume (`claude -p --resume`, the SDK, a VS Code reload) no longer starts the session's cost and usage totals at zero | Before this, a resumed headless session's counter restarted. Up to wtclaude 0.3.1 the collector clamped the drop, so it under-counted until the counter passed its old high-water mark. From 0.3.2 a drop is booked as a **restart** and the new reading counts in full: when `cost.total_duration_ms` fell too, a Claude Code process that started after the last anchored reading is a restart, and the same process means an older payload arriving late, which is skipped; with no duration figures, a drop below 50% of the last anchored total is a restart. Limits: with no duration figures, a restart whose first reading is still at least 50% of the old total is clamped (that reading is lost), a stale payload below 50% is booked as a restart, and the $0 baseline a restart writes counts as a turn. |
| 2.1.280 | **Claude Opus 5.5 added and made the default model on every paid plan** — Pro and Team Standard moved from Sonnet to Opus, and the default Opus became Opus 5.5; Opus 5.5 is also the fast-mode default | `claude-opus-5-5` rows begin appearing without the user opting in. Records from before wtclaude 0.3.1 had no rate-sheet entry for it: the headline was unaffected (it is the anchor), but secondary calculations resolved it to Opus 5's rates by family fallback. From this build, nothing may call Sonnet 5 the Claude Code default. |

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
