# STREAM-INBOX

Cross-channel inbox. Sections are owned by their lead. Append; don't rewrite others' entries.

---

## 📋 PM

### 2026-06-10 — Bug-fix pass → 🟢 0.1.5 PUBLISHED · launch-stopper CLEAR

All 9 QA findings resolved in one pass and **`wtclaude@0.1.5` is live on npm** — https://www.npmjs.com/package/wtclaude/v/0.1.5 (registry shasum `000a98a5…` matches the dry-run tarball exactly). Commit `3bfe4a4`, tag `v0.1.5`, pushed to `main`. **🔴 launch-stopper is cleared — the marketing compare-CTA push can resume** (read the GTM flag below before finalizing copy; reframe is GTM's ticket PM-GTM-039, not this stream).

**Launch-stopper re-verified LIVE** (freshly-installed 0.1.5 vs Peter's real data): `compare` now renders a real session-log estimate + gap (was $0 / N/A) — input **531K vs 71K = 7.5×**, "undercounts input tokens by 8×" fires; billing-grade **$27.10** vs session-log **$35.24**. `--share` card shows real numbers.

| QA-ID | Sev | Fix | Status |
|---|---|---|---|
| 01 | 🔴 | `compare` reads `message.usage` + dedups by `message.id:requestId` | ✅ fixed + regression tests |
| 02 | 🟡 | `dashboard` → dashboard.wtclaude.com (was vercel.app 404) | ✅ |
| 03 | 🟡 | `whatif --model` labeled `(estimate)`, like-for-like token×rate baseline | ✅ no phantom savings |
| 04 | 🟡 | `sync --enable` privacy preview + opt-in confirm before any upload | ✅ |
| 05 | 🟡 | phase labels removed (`report --cost-center`, `forecast`) | ✅ |
| 06 | 🟢 | `whatif` uses current `opus-4-8` from pricing config | ✅ |
| 07 | 🟢 | negative costs → `-$10.69` in both `formatCost`/`formatMoney` | ✅ |
| 08 | 🟢 | `cost_center` empty-state points at `cost_center_map` | ✅ |
| 09 | 🟢 | KEEP (neutral ccusage citation) per PM ruling | ✅ no change |

**Regression (QA-0610-01):** `src/compare/jsonl-reader.test.js` (nested read, dedup, no-over-dedup, flat fallback, gap-computes) + an end-to-end gap test in `compare.test.js`. **npm test: 43 pass (6 new), 0 fail.** Honesty grep clean (`Phase \d` + banned terms). No regressions in the PASS-block commands.

**Smoke (clean temp HOME, live 0.1.5):** `--version`=0.1.5 ✅ · `setup` exit 0 ✅ · `dashboard` → dashboard.wtclaude.com ✅ · `compare` on real data → real gap ✅.

**🟦 GTM flag — action before resuming the compare-CTA:** on cache-heavy Opus usage the session-log estimate now comes out *higher* than the bill ($35.24 vs $27.10) because session-log trackers sum per-call cache reads. The command stays honest — it scopes the undercount claim to **input tokens** (true at 7.5×) and says cost "can drift from your bill." But the compare-CTA is premised on "undercounts your **cost**." Recommend framing the push as "**disagrees with / drifts from your bill**" (and/or "undercounts your input tokens N×"), not strictly "undercounts your cost" — direction is user-data-dependent.

**Note (FYI, no GTM action):** `sync --enable` now shows a short functional privacy-disclosure built by reusing the vetted leaderboard/export privacy phrases ("counts/flags + salted hashes… no prompts, code, file names, or project paths, ever"). No new marketing copy; flag if GTM wants to wordsmith the disclosure.

---

### 2026-06-10 — Full-product QA acceptance (wtclaude@0.1.4, live) → 🔴 NO-GO

Source: `qa-full-product-report-2026-06-10.md` (full report). Test-and-report only; no code changed in the QA channel. Published `0.1.4` exercised end-to-end on two personas (fresh temp HOME + Peter's real sync-enabled install). `--version` = `0.1.4` confirmed.

**Per-block PASS/FAIL**

| Block | Area | Result |
|---|---|---|
| 1 | Install / first-run (fresh HOME) | ✅ PASS |
| 2 | Core cost views (today/week/month) | ✅ PASS |
| 3 | **Hero: `compare`** | 🔴 **FAIL** (QA-0610-01) — empty-window fix + `--share` pass |
| 4 | Forecasts | 🔴 FAIL — `forecast`/`fable`/`readiness` ✅; `whatif` fails (QA-0610-03/-06) |
| 5 | Remaining commands | ✅ PASS |
| 6 | Output formats | ✅ PASS |
| 7 | Sync + dashboard | 🔴 FAIL (QA-0610-02/-04) — round-trip cloud==local ✅ exact |
| 8 | Honesty sweep | 🔴 FAIL (QA-0610-05) — banned-claim scan ✅ clean; phase labels leak |
| 9 | Edge / robustness | ✅ PASS — collector survives all 18 torture payloads |

**Overall verdict: 🔴 NO-GO.** One launch-stopper. The hero `compare` shows `$0.00 / N/A` for the session-log estimate on every real user's data — it must be fixed and re-verified before launch. Everything else is shippable-or-cosmetic; the cost engine, limit gauge, forecasts (forecast/fable/readiness), round-trip, and collector robustness are strong and honest.

---

#### 🔴 Launch-stoppers

**QA-0610-01 — `compare` session-log estimate is always $0 / N/A (hero command broken on real data)**
- `compare` (and the `--share` card) read JSONL usage from `entry.usage`, but real Claude Code JSONL nests it under `entry.message.usage` → every token/cost sum is 0, gap renders `N/A`. The headline differentiator (and step 3 of the setup CTA) demonstrates nothing; the shareable card broadcasts `Session-log estimate $0.0000/day`.
- **Repro:** `npx wtclaude@latest compare` on any machine with real `~/.claude/projects` JSONL → all-zero session-log column. Today's correct value reading `message.usage` ≈ **$44.76** (716 entries).
- **Locus:** `src/compare/jsonl-reader.js` `summarizeJsonl`/`readJsonlFile` (line 73 `entry.usage`). Confirmed against published 0.1.4 (sha-matches repo).

#### 🟡 Degraded

**QA-0610-02 — `wtclaude dashboard` opens a 404.** Command opens `https://wtclaude.vercel.app/settings?link=…` → HTTP **404**. Canonical dashboard is `https://dashboard.wtclaude.com` (200); site `/dashboard` correctly 307-redirects there. Only the CLI command is broken. **Repro:** `wtclaude dashboard`. **Locus:** `src/cli/dashboard.js:11` (`baseUrl`, still the "Update when deployed" placeholder).

**QA-0610-03 — `whatif --model` is misleading and unlabeled.** Output has no "estimate" label (Block 4 requires every forecast labeled) and compares an **anchored** actual (`computeTurnCost` → `cost_usd`) to a **token×rate** hypothetical (`expectedCost`). Because `opus-4-8[1m]` resolves to the same rates as the model the user already runs, it shows e.g. `Actual $11.60 → If all opus: $4.65 (-60%)` — a fictitious saving driven by the very token-undercount the product exists to expose. **Repro:** `wtclaude whatif --model opus`. **Locus:** `src/cli/whatif.js` `showModelComparison`.

**QA-0610-04 — `sync --enable` has no privacy preview before sending.** Flips `sync_enabled=true` and saves with no "here's exactly what gets sent" preview (Block 7 expects one). *Mitigant:* the leaderboard/share opt-in path **does** show a strong preview, and `export` confirms synced data is counts/flags + salted hashes only (no prompts/code/paths). **Repro:** `wtclaude sync --enable`. **Locus:** `src/cli/sync.js:23-28`.

**QA-0610-05 — Internal phase labels leak into user-facing output.** `report --cost-center` → *"(Individual view — team-wide rollup is Phase 2 SMB.)"*; `forecast` → *"The predictive/plan-fit engine is Phase 1."* (latter only when agent-pool data exists). Block 8 requires no phase labels. **Repro:** `wtclaude report --cost-center`. **Locus:** `src/cli/report.js:88`, `src/cli/forecast.js:85`.

#### 🟢 Cosmetic

**QA-0610-06 — Stale model id.** `whatif --model opus` prints "All opus-4-7"; current Opus is opus-4-8 (resolves to correct rates via alias, but the label is wrong/implies a downgrade). **Locus:** `src/cli/whatif.js:62` (`modelMap`).

**QA-0610-07 — Negative-cost formatting.** `whatif --model` difference renders `$-10.6931` (4-dp, `$-` prefix) instead of `-$10.69`. **Locus:** `src/utils/cost.js` `formatCost` negative branch.

**QA-0610-08 — `cost_center` empty-state copy.** group-by `cost_center` says the field is "null on the current Claude Code payloads", but cost_center is derived from the user's `cost_center_map` (config), not the payload — a user can populate it. **Locus:** empty-state copy in `src/utils/group.js` / `src/cli/_summary.js`.

**QA-0610-09 — README names a banned competitor.** Shipped README cites `ryoppippi/ccusage#866` (neutral citation, not disparagement). `ccusage` is on the banned list — PM to rule on whether citations are allowed. (Also 2 non-user-facing code comments mention ccusage.) **Locus:** `README.md:20`.

#### ⚠️ Not fully verifiable headlessly (no bug filed)
- `dashboard.wtclaude.com` is a client-rendered SPA; automated fetch sees only the shell. The **backend is live and correct** (edge functions returned real, exact numbers), but confirming the dashboard *renders* the CLI's numbers + honesty badges + estimate-labeled forecast tile needs a real-browser pass.

---
