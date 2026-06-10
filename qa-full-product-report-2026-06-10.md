# 🔎 WTClaude — Full-Product QA Acceptance Report

**Date:** 2026-06-10 · **Channel:** Full-product QA (test-and-report only) · **Tester:** Claude Code (Opus 4.8)
**Product under test:** `wtclaude@0.1.4` (published latest, installed via npm into a temp prefix — *what users actually get*)
**Verified `--version`:** `0.1.4` (fresh HOME + published artifact) ✅

---

## VERDICT: 🔴 NO-GO — issues found (1 launch-stopper)

The CLI is accurate, fast, robust, and honest almost everywhere — install/first-run, the cost views, the limit gauge, the forecasts (`forecast`/`fable`/`readiness`), output formats, cloud round-trip, and collector robustness are all strong. **But the hero command `compare` reads $0.00 / N/A for the session-log estimate on every real user's data** (it reads the wrong JSONL field). That command *is* the product's headline differentiator and step 3 of the setup CTA, and it also poisons the `--share` viral card — so it blocks launch on its own.

| Severity | Count | IDs |
|---|---|---|
| 🔴 Launch-stopper | 1 | QA-0610-01 |
| 🟡 Degraded | 4 | QA-0610-02, -03, -04, -05 |
| 🟢 Cosmetic | 4 | QA-0610-06, -07, -08, -09 |

---

## Method & personas

- **Artifact:** `npm install wtclaude@latest` into `/tmp/wtclaude-qa-2026-06-10/pkg` → ran `bin/wtclaude.js` and `src/collector/index.js` from the *published* package. Confirmed no test files leaked (`bin/` ships only `wtclaude.js`; `src/` has zero `*.test.js`). Published `jsonl-reader.js` sha-matches repo, so findings are against the shipping artifact.
- **Persona A — fresh install:** clean temp `HOME=/tmp/.../home` (isolates `~/.wtclaude` + `~/.claude/settings.json`).
- **Persona B — returning user:** Peter's real `~/.wtclaude` (sync-enabled, `plan=max_5x`, ~2000 turns, real data today). Empty windows tested on every command.
- **Isolation:** collector torture + fresh-install ran under temp HOME; real-data reads were read-only except `compare --share` (Desktop files written then removed) and one `wtclaude sync` (normal op for this sync-enabled user, to complete the round-trip test).

---

## Per-block results

### Block 1 — Install / first-run (fresh temp HOME) — ✅ PASS
- `--version` → `0.1.4`, exit 0.
- `setup --yes` → exit 0; created `~/.wtclaude/` dirs, wrote per-install **salt + anonymous_id + device_id** (idempotent), wired the Claude Code statusline.
- Collector fires on a real piped payload → exit 0, emits status string (`wtclaude · $0.42 · 27K tok`), writes a correct `sessions/*.ndjson`. Two-turn delta math correct (turn 2 cost Δ = `0.53` = `0.95 − 0.42`; token deltas correct).
- `today` **before** data → honest cold-start: *"You're set up and capturing… your first turn will show up here"* — **NOT** "run setup", no crash. ✅
- `today` **after** data → renders `$0.950 (billing-grade)`, internally consistent.

### Block 2 — Core cost views (real data: today/week/month) — ✅ PASS
- Snapshot: today `$6.40` ⊆ week `$138.18` ⊆ month `$139.68` — **monotonic / internally consistent** (re-checked via `--json`: today `$7.00`/141 ≤ week `$138.79`/1802 ≤ month `$140.29`/1804). Numbers grow across the run only because Peter is actively coding — each snapshot is self-consistent.
- Billing-grade label present; month honestly degrades to `99% billing-grade, rest estimated` (2 anchor-less `sonnet-4-6` turns).
- Model normalization correct: `claude-opus-4-8[1m]` / `claude-fable-5[1m]` display the `[1m]` suffix; `normalizeModel` strips `[1m]` → standard Opus rates (verified: no false long-context premium).
- Empty window (configured user, past dates) → honest cold-start, **not** "run setup". Empty `--json` is valid JSON.

### Block 3 — The hero: `compare` — 🔴 FAIL
- **🔴 QA-0610-01:** Session-log estimate reads **0 / N/A on all real data and all windows** (`--days 1/7/30`). Root cause: `summarizeJsonl` reads `entry.usage`, but real Claude Code JSONL nests usage under `entry.message.usage`. The headline gap never renders. (Detail below.)
- ✅ Empty-window fix (commit 6cb989a) **holds**: configured-but-empty fixture → cold-start copy; unconfigured-empty fixture → "Run: wtclaude setup". Both correct.
- ✅ `compare --share` writes SVG+HTML without throwing (R2-01 guard intact, Desktop write succeeded); card copy is **clean** (no banned phrases, honest "source behind your bill" tagline) — **but** the card broadcasts `Session-log estimate $0.0000/day`, so QA-0610-01 also poisons the share artifact.

### Block 4 — Forecasts — 🔴 FAIL (3 of 4 surfaces excellent; `whatif` is the failure)
- ✅ `forecast` → labeled `(estimate — not plan-fit)`, June-15 countdown `5 days`, pre-flip combined with honest "no agent-pool spend yet" (no fabricated split).
- ✅ `readiness` → `(estimate-labeled)`, data-capture audit, plan tier, "Estimate only… No plan-fit".
- ✅ `fable` → `(estimate — the June-23 "Fable cliff")`, "included until 2026-06-23 — 13 days away", scoped to "if the announced $10/$50 post-June-22 pricing holds", and **explicitly separate from the Agent-SDK pool** ("see `wtclaude forecast`"). Exactly per spec.
- **🟡 QA-0610-03:** `whatif --model` carries **no estimate label** and compares an **anchored** actual to a **token×rate** hypothetical → shows fictitious savings for a model the user already runs.
- **🟢 QA-0610-06:** `whatif --model opus` prints stale **"opus-4-7"** (current is opus-4-8).
- Latent phase-leak in `forecast` ("…engine is Phase 1") — see QA-0610-05 (only shows when agent-pool data exists; Peter's empty-pool path skipped it).

### Block 5 — Remaining commands — ✅ PASS
- `limit` → textbook: `Shared overall plan limit`, `Billing-grade · read from the statusline payload, no OAuth needed`, 5h `13%` / 7d `10%` with reset countdowns, explicit *"the single subscription bucket… (Not a cross-surface view.)"*.
- `session` (list + per-turn detail), `blocks`, `statusline`, `debrief`, `badges` all run, no crash, honest cost-basis labels (estimated turns shown with `~`).

### Block 6 — Output formats — ✅ PASS
- `--json` valid on today/week/month/session/blocks; `--csv` and `--clipboard` work.
- Estimate flags carried in JSON: `fable --json` → `estimate:true` (+ cliff/countdown); `forecast --json` → `estimate:true` (+ activation/countdown).
- `tasks` → honest empty state (captured day-one, null on current payloads, no backfill) — no phase label.

### Block 7 — Sync + dashboard — 🔴 FAIL (round-trip itself passes)
- ✅ **Round-trip cloud == local (exact)** on settled days: after `sync` (pushed 9 sessions / 1156 turns), cloud `get-summary`/`get-dashboard` (`"source":"live"`) returned 2026-06-08 `$42.0743`/691 and 2026-06-09 `$89.7091`/970 — **identical to local to 4 decimals**. (06-10 differs ~$0.41/7 turns only because new turns landed mid-test.)
- **🟡 QA-0610-04:** `sync --enable` flips the flag with **no privacy preview before sending** (spec wants one). *Mitigant:* the leaderboard/share opt-in path **does** show a strong preview, and `export` confirms synced data is counts/hashes only (no prompts/code/paths).
- **🟡 QA-0610-02:** `wtclaude dashboard` opens `https://wtclaude.vercel.app/...` → **HTTP 404** (dead host). Canonical `https://dashboard.wtclaude.com` → 200; site `/dashboard` → 307 → dashboard.wtclaude.com (works). The CLI command is the broken path.
- ⚠️ *Not fully verifiable headlessly:* dashboard.wtclaude.com is a client-rendered SPA; WebFetch sees only the shell. Backend (edge functions) is live and returns correct real numbers; a real-browser pass is still needed to confirm the dashboard *renders* the CLI's numbers + honesty badges + estimate-labeled forecast tile.

### Block 8 — Honesty sweep — 🔴 FAIL (competitive-claim scan clean; phase labels leak)
- ✅ Precise banned-claim scan of **all command output + shipped src/README** is **CLEAN**: no `tokscale`, `$3.42`, `18.70`, `174x`, `100×`, "exact token", "the first/only accurate tracker", "every existing tool/tracker". No `cowork`/`desktop`/`phase` strings in the commands' output.
- ✅ Positive checks: README carries prominent **"independent… not affiliated with, endorsed by, or sponsored by Anthropic"** (×2); `credits` shows proper **"Coming soon — activates 2026-06-15"** (no phase label); `billing-grade` only in real contexts; capture correctly scoped "terminal-CLI only; desktop/Cowork aren't tracked".
- **🟡 QA-0610-05:** Two **phase labels leak into user-facing output**: `report --cost-center` → *"team-wide rollup is Phase 2 SMB."*; `forecast` → *"…engine is Phase 1."* Spec: no phase labels.
- **🟢 QA-0610-09:** README (shipped to npm) names the competitor in a citation: `ryoppippi/ccusage#866`. Neutral (not disparagement), but `ccusage` is on the banned list — PM to rule on citations. (Also 2 non-user-facing code comments mention ccusage.)

### Block 9 — Edge / robustness — ✅ PASS
- **Collector torture (18 payloads): zero crashes, all exit 0.** Survived object/string/number/null model, `[1m]` + fable suffix, unknown model, **non-monotonic cumulative** (turn-2 drop correctly clamped — no negative delta written), **NUL bytes** (logged as unparseable, no write, exit 0), unparseable JSON, empty stdin, missing `session_id`, all-null, huge numbers. Graceful breadcrumbs in `collector.log` throughout.
- CLI on torture data → all commands exit 0, render garbage gracefully with honest "inferred" labels.
- Multi-dimension: group-by **project/branch** work; **cost_center/task/quality** show honest empty states; `devices` rides sync (per-device + combined). Large-data sane (2.2MB `export`, ~2000 turns aggregated, no crash).
- **🟢 QA-0610-08:** group-by `cost_center` empty-state copy says the field is "null on the current Claude Code payloads" — but cost_center is derived from the user's `cost_center_map` (config), not the payload. Slightly misleading.

---

## 🔴 QA-0610-01 — `compare` reads the wrong JSONL field → session-log estimate always $0 (LAUNCH-STOPPER)

**What:** On every real user's machine, `wtclaude compare` shows the session-log column as `0` for all tokens and `$0.0000` for cost, and the gap as `N/A`. The hero comparison — the product's entire reason to exist, and step 3 of the setup CTA ("See how off your old tracker was: `wtclaude compare`") — demonstrates nothing.

**Root cause:** `src/compare/jsonl-reader.js` reads usage from the top level:
```js
const usage = entry.usage || {};            // line 73 — always {} on real CC JSONL
input += usage.input_tokens || 0;           // → 0
```
Real Claude Code JSONL nests usage under **`entry.message.usage`** (confirmed in `~/.claude/projects/**/*.jsonl`: keys `input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens` live under `message.usage`). Top-level `entry.usage` does not exist → every sum is 0. Verified against the **published 0.1.4** file (sha `d880a4b3…`).

**Impact:** Reading `message.usage` for today yields **716 entries / ~$44.76** session-log estimate — i.e. a real, non-zero number that *should* render. Instead users see `$0.0000` and `N/A`. The `compare --share` SVG/HTML card also bakes in `Session-log estimate $0.0000/day`, so the viral artifact is wrong too.

**Repro:** On any machine with real `~/.claude/projects` JSONL: `npx wtclaude@latest compare` → session-log column all zeros, gap `N/A`.

**Fix locus (for the bug-fix channel):** `src/compare/jsonl-reader.js` `summarizeJsonl` (and `readJsonlFile`) — read `entry.message?.usage ?? entry.usage`.

---

## Full bug table (filed to STREAM-INBOX → 📋 PM)

| ID | Sev | Command | One-liner |
|---|---|---|---|
| QA-0610-01 | 🔴 | `compare` (+ `--share`) | Session-log estimate always $0/N/A — reads `entry.usage`, real JSONL is `entry.message.usage`. Hero comparison renders nothing. |
| QA-0610-02 | 🟡 | `dashboard` | Opens `wtclaude.vercel.app` → **404**. Canonical is `dashboard.wtclaude.com` (200). |
| QA-0610-03 | 🟡 | `whatif --model` | No estimate label; compares anchored actual vs token-math hypothetical → fictitious "savings" for the model you already use. |
| QA-0610-04 | 🟡 | `sync --enable` | Enables cloud sync with no privacy preview before sending (sharing/leaderboard path does preview; cloud-sync enable doesn't). |
| QA-0610-05 | 🟡 | `report --cost-center`, `forecast` | Internal phase labels leak to users: "Phase 2 SMB", "…engine is Phase 1". |
| QA-0610-06 | 🟢 | `whatif --model opus` | Prints stale "opus-4-7" (current is opus-4-8). |
| QA-0610-07 | 🟢 | `whatif --model` | Negative diff formats as `$-10.6931` instead of `-$10.69`. |
| QA-0610-08 | 🟢 | group-by `cost_center` | Empty-state says "null on current payloads"; cost_center is config-driven, not payload-driven. |
| QA-0610-09 | 🟢 | README (shipped) | Cites `ryoppippi/ccusage#866`; neutral citation but names a banned competitor. PM to rule. |

**Routing:** All fixes go to the separate bug-fix channel. **Do not ship until QA-0610-01 is fixed and `compare` re-verified on real data.** The four 🟡s are launch-week candidates; the 🟢s are backlog.
