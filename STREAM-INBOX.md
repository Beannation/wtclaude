# STREAM-INBOX

Cross-channel inbox. Sections are owned by their lead. Append; don't rewrite others' entries.

---

## 📋 PM

### 2026-06-23 (late) — 🟪 SMB spend-audit: honesty hardening + monthly-rerun capture → 🟢 LIVE

✅ Two post-launch changes to the free spend-audit, per Peter. **(1) Stop transmitting the aggregate numbers.** The audit lead POST no longer carries the computed `audit` aggregate at all — `toLeadAggregate` was removed from the client and is now **tree-shaken out of the live bundle** (verified 0 hits in the deployed JS via import-graph crawl), so the figures are never even assembled for sending. The lead body is now strictly `{ email, tag, source, consent, monthly_rerun }`. The email-gate **privacy line was rewritten** to match: *"No spend data ever leaves your browser … the only thing we receive is your email address …"* (old "contains aggregate totals" copy gone — 0 live hits). Rationale (Peter): storing/sending a customer's aggregate spend numbers undercuts the "your data never leaves your browser" promise that is the product's differentiator; benchmarking — the only real upside — doesn't need per-lead linkage and would be a separate anonymous event if ever built. **(2) Capture the monthly re-run opt-in.** The `email-signup` edge fn now persists the spend-audit "email me a monthly reminder" checkbox into `email_signups.meta.monthly_rerun` (+ backfills it if a returning visitor ticks it later); aggregate numbers still deliberately NOT stored. Query opt-ins with `where meta->>'monthly_rerun' = 'true'`. Commit **`5a88299`** (`2332249..5a88299` on `main`; `app.ts`, `render.ts`, `supabase/functions/email-signup/index.ts`). Two deploys: site → **`dpl_8sRpAgzLymxufVLNnMJkRRZbZrwA`** (Vercel, READY, aliased wtclaude.com); edge fn → **`email-signup` v2** (Supabase, 2026-06-23 13:23 UTC) — first 3 deploy attempts hit a transient Supabase platform **504** (asset uploaded, auth OK; activation step timed out), cleared on the 4th. Build GREEN. ⚠ **Not yet black-box-verified:** the `meta.monthly_rerun` row write — `email_signups` is deny-all RLS and this channel has no service_role key; logic is code-reviewed + the fn is live (honeypot smoke test 200). Suggest 🟦/PMO confirm one real signup's `meta` in the Supabase Table editor.

---

### 2026-06-23 (mid) — 🟪 SMB spend-audit: drop "hooks" jargon from public copy → 🟢 LIVE

✅ Per Peter: the internal term **"hooks" must never appear in public copy** (marketing jargon). Audited the whole experience — only 3 user-visible strings said it ("all 8 hooks" / "reveal all 8 hooks"): the email-gate sub, the blurred-preview overlay, and the report meta line. All → **"8 checks"** (plain audit language). Internal code identifiers (`hooks.ts`, the `Hooks`/`HookH1..8` types, `computeHooks`, the `hooks` var, the site-wide `HookBand` component, comments) left intact — never rendered; renaming them is a ~90-ref refactor with zero user benefit. Verified on the **built output**: `8 hooks` → 0, `8 checks` → 4; pre-rendered sample report + tool page (incl. `HookBand`) show **0 visible "hook"**. Commit **`2332249`** (`a85a0bd..2332249`; `app.ts` + `render.ts`), prod deploy **`dpl_Hur5467LQRooT7r8wbYsbHC2bvgh`** (Vercel, READY, aliased wtclaude.com). Live confirmed: `/business/audit/sample` shows 0× "8 hooks", 1× "8 checks".

---

### 2026-06-23 — 🟪 SMB free spend-audit: rename + route + teaser-flip → 🟢 LIVE

✅ **SMB-V2-AUDIT-NAMING closed — and the free spend-audit tool is LIVE.** Renamed the free tool **"seat audit" → "spend audit"** and moved its route **`/business/seat-audit` → `/business/audit`**, broadened the seat-only copy to the multi-hook framing (idle/over-tiered seats + who's driving the bill + Opus/model mix + $/request outliers), and **flipped the `/business` teaser live**. Per Peter's "combined push" GO, this shipped **in the same commit as the tool itself** (built by 🟦 Build, untracked in the working tree) so the live teaser/blog links never 404. Commit **`a85a0bd`** (10 files — the `business/audit` + `business/audit/sample` pages, `lib/audit/*.ts`, `business.astro`, the SMB blog; pushed `203ec86..a85a0bd` to `main`), prod deploy **`dpl_4fqhxFcJomgAW3JQKE2QxWo1YBxT`** (READY, aliased to **wtclaude.com**) via explicit `vercel --prod` from `site/`. Build **GREEN** (`astro build`, 19 pages); seat-audit grep **clean** (0 hits in `business.astro` + the SMB blog).

**Live-link check (all 200 — both audit routes were 404 before this deploy):**
- `/business/audit` → https://wtclaude.com/business/audit — **200** (was 404) · `/business/audit/sample` → **200** (was 404).
- `/business` → teaser **live**: "Start free: the 30-second spend audit" + **Run the free audit →** linking to `/business/audit` (no more coming-soon/no-link).
- SMB blog → **11× "spend audit", 0× "seat audit"**; 4 tool links resolve to `/business/audit`; the **team-product** waitlist mention correctly stays at `/business`.

**Teaser-went-live-only-with-the-tool, confirmed:** the teaser flip + blog "live now" copy and the tool page are in the **same commit (`a85a0bd`)** — there was no window where the live link 404'd. Closes the prior "free seat-audit = coming-soon, page not built" item.

**Outside the git push:** `smb-copy-v1.12.md` §3 was synced (retitled "Free spend-audit funnel — `/business/audit`", naming + path updated, no claim changes) but that doc lives in `Build Files/` **outside the repo**, so it's a local source-of-truth update only. Unrelated working-tree WIP (`web/.gitignore`, `web/vercel.json`, prior `STREAM-INBOX.md` edits) left **untouched**.

---

### 2026-06-22 (later) — 🟪 SMB blog pubDate bump → 🟢 LIVE

✅ Pushed commit **`203ec86`** (blog file only — `what-your-team-is-spending-on-claude-code.md`, pubDate `2026-06-14 → 2026-06-22`; `e31dbad..203ec86` on `main`), prod deploy **`dpl_2t5U8ZGmdN7W9C7r3G8uWXCT4gDY`** (READY, aliased to wtclaude.com) via explicit `vercel --prod` from `site/`. **Live confirmed** (cache-busted, 200): https://wtclaude.com/blog/what-your-team-is-spending-on-claude-code shows **June 22, 2026** (old June 14 gone; JSON-LD `datePublished` = `2026-06-22`), title still "…and Where You're Overpaying for It". Stale `.git/HEAD.lock` + `.git/objects/maintenance.lock` cleared cleanly. Working-tree WIP (`STREAM-INBOX.md`, `web/.gitignore`, `web/vercel.json`) **untouched** — push was the existing blog commit only.

---

### 2026-06-22 — 🟪 SMB site v1.12 ("the bundle") launch → 🟢 LIVE

✅ **SMB-V2-WEB shipped.** Replaced the v1.11 SMB copy with **Messaging v1.12 ("the bundle")** verbatim, added the `/compare` OAuth-edge block, published the v1.12 SMB blog rewrite, and took **/complete** live — all in one deploy. Commit **`e31dbad`** (site-only — 5 files, pushed `c183c0a..e31dbad` to `main`), prod deploy **`dpl_28AZ4GWFmmQ5QjfA4w2GBs2gnW2S`** (READY, aliased to **wtclaude.com**) — **NOT** push-to-deploy; shipped via explicit `vercel --prod` from `site/`. Inspector: https://vercel.com/beannations-projects/wtclaude-site/28AZ4GWFmmQ5QjfA4w2GBs2gnW2S · Peter GO given 2026-06-22 ("go, no need to change blog"). Build GREEN (`astro build`, 17 pages, `/dashboard` excluded; `astro check` not wired — wants an interactive `@astrojs/check` install, so the build is the gate).

**Live (all 200, cache-busted):**
- `/business` → https://wtclaude.com/business — H1 **"Run your team's Claude spend — in one independent place."** + the **3 hero cards** (see-under-the-cap-real-time w/ the collector/OTel footnote · never-pay-for-an-unused-seat · delegated team-lead views), package line, 3-collection-paths, positioning/honesty line.
- `/business/finance` → https://wtclaude.com/business/finance — title+H1 **"Close the month on Claude, to the dollar."**, co-heroes (allocation/chargeback + pre-invoice accrual `estimate` badge), **4 support cards** (budget-vs-actual + **invoice-reconciliation check** + attributed **$400K→$1.4M** cliff + **scoped finance view**), honesty block incl. the OTel caveat ("…the same OTel caveat applies on Cowork").
- `/compare` → https://wtclaude.com/compare — added §4 **"The blind spot in FinOps tools — and why ours isn't"** as proof directly under the comparison table. **API-scoped** ("only returns API-key users"; no "can't see your users"). No competitor rows added (Competitive owns the named row incl. Lineman).
- SMB blog → https://wtclaude.com/blog/what-your-team-is-spending-on-claude-code — **v1.12 swap done**: title now **"…Where You're Overpaying for It"** (old "…the Cap That's Right" gone), drop-in note stripped, `BlogPosting`+`FAQPage`(8 Q/A)+`BreadcrumbList` JSON-LD, in the **live sitemap** + `/blog` index, slug unchanged.
- `/complete` → https://wtclaude.com/complete — finalized page **live + clean** (coming-soon present; Code-terminal billing-grade + Code-desktop estimate + Cowork billing-grade-where-logged (Anthropic-computed) + Chat no $; **no "unified", no Fable, no DraftNote**). Not rewritten.

**Gate checks:**
- **Honesty grep clean** (source + live HTML). Every hit reconciled: ordinary-prose `only`/`first`; **negated** enforce/cap disclaimers (`we don't enforce it`, `we never cap or cut off your team`, `we never enforce or cap`); `access-only` = Anthropic Enterprise-seat fact; **$400K→$1.4M** = the one allowed attributed figure. **No** `unified`, **no** competitor names on /business or /finance, **no** "conflict of interest", **no** "can't see your users", **no** `/mo`, **no** false "Anthropic is barred" *assertion*. The struck-moat guardrail holds.
- **Free seat-audit = COMING-SOON, NO link.** `/business` free hook renders as a non-clickable "Coming soon" teaser (kept the §1 60-second-seat-audit framing/body, no button, no link) with the `<!-- TODO SMB-V2: …flip this teaser to a live CTA linking /business/seat-audit -->` flip comment. **Zero `/business/seat-audit` links anywhere on the site** (the only occurrence is that TODO comment). The `/business/seat-audit` **page is not built** — owned by 🟦 Build; ships shortly.
- **Waitlist forms render + POST:** `/business` `tag="smb"`, `/business/finance` `tag="smb_finance"`; both carry the **consent checkbox** (PM-WEB-014, unticked-by-default) and the **live capture endpoint is wired** in prod (`data-endpoint="https…"`), so submissions post with tag + consent.

**⚠ Didn't map cleanly (smb-copy / staging → components):**
1. **Blog free-seat-audit references** — the staging blog framed the audit as a *live "today"* tool with `/business/seat-audit` CTAs. Per the no-link / coming-soon rule (§3b + Peter), I converted those to coming-soon framing pointing to the `/business` waitlist and trimmed the section heading "Start free — two ways**, today**" → "Start free — two ways." This is a deviation from verbatim, driven by the scope rule. **Peter reviewed pre-GO and said keep the blog as-is.**
2. **Blog "barred" debunk line** — the GTM independence paragraph keeps "…not that Anthropic is somehow **barred** from helping you spend less. It isn't." (negates the struck moat, doesn't assert it). Flagged pre-GO; **Peter: keep as-is.** It's the one grep hit the gate doesn't pre-clear, retained intentionally because it *debunks*.
3. **Blog `faq` frontmatter** — staging had none; I added a `faq:` block mirroring the body FAQ (link-free, no new Q&As authored) to preserve the FAQPage JSON-LD per the existing post's shape.
4. **/compare placement** — §4 says "proof under Hero 1"; the compare page's hero is the intro+table, so the block sits immediately after the comparison table (before "When to use which") as proof beside the comparison content.

**Remaining site item (1):** the **free seat-audit tool + `/business/seat-audit` page** (🟦 Build, §3) is not yet built. When it ships, flip (a) the `/business` teaser → live CTA at the TODO marker, and (b) the blog's coming-soon seat-audit references → links to the tool. Until then everything points to coming-soon/waitlist.

Concurrent working-tree edits (`web/.gitignore`, `web/vercel.json`, this `STREAM-INBOX.md`) left untouched/uncommitted for their owners — commit was site-files-only.

---

### 2026-06-21 — 🟪 SMB site launch (v1.11 smart-guardrails) → 🟢 LIVE

✅ **PM-SMB-GATE launch step shipped.** Applied Messaging **v1.11** copy verbatim to the SMB pages and published SEO blog #8. Commit **`c183c0a`** (site-only, pushed `3dfdd4b..c183c0a` to `main`), prod deploy **`dpl_BAqAWb2bANVvaY7c6XbCcHXAkJkh`** (READY, aliased to **wtclaude.com**) — **NOT** push-to-deploy; shipped via explicit `vercel --prod` from `site/`. Inspector: https://vercel.com/beannations-projects/wtclaude-site/BAqAWb2bANVvaY7c6XbCcHXAkJkh

**Live (all 200, cache-busted):**
- `/business` → https://wtclaude.com/business — H1 **"Right-size the cap — without throttling your best engineers."** + smart-cap-tuning / coaching-as-dollars / cliff-management cards + peace-treaty + positioning/honesty lines.
- `/business/finance` → https://wtclaude.com/business/finance — title+H1 **"Close the month on Claude, to the dollar — and right-size the cap."**, allocation/chargeback + pre-invoice accrual (`estimate` badge), budget-vs-actual + attributed **$400K→$1.4M** cliff, honesty block incl. the **OTel caveat** ("billing-grade on Code where your admin enables OTel, otherwise a clearly-labeled estimate").
- Blog #8 → https://wtclaude.com/blog/what-your-team-is-spending-on-claude-code — `BlogPosting`+`FAQPage`(7 Q/A)+`BreadcrumbList` JSON-LD, in the **live sitemap**, in `/blog` index. `/dashboard` excluded from the build.

**Gate checks:**
- **DraftNotes removed** from both SMB pages (import + usage stripped; **0** "Draft — copy gap" in live HTML on both). Coming-soon/waitlist kept; **no pricing**.
- **Honesty grep clean** (source + live HTML). Every hit reconciled: `access-only` = Anthropic Enterprise-seat fact; `enforcement` = attributed to Anthropic ("hard enforcement is Anthropic's admin tier") + "we don't impose"; `we don't enforce it` / `we never cap or cut off` = negated disclaimers; **$400K→$1.4M** = the one allowed attributed figure ("his figure, not Anthropic's"). No `first`/`only`-as-claim, no `/mo`, **no competitor names** (CloudEagle/Larridin/Mavvrik/Torii/Zylo). `uncontested` appears **once**, `/business` only, scoped to **smart-cap-tuning + coaching + cliff-management** — never visibility, never allocation/chargeback. (Live grep's extra `only` = Tailwind `sr-only` utility class on the form label, not copy.)
- **Waitlist forms render + POST:** `/business` `tag="smb"`, `/business/finance` `tag="smb_finance"`; both carry the **consent checkbox** (PM-WEB-014, unticked-by-default) and the **live capture endpoint is wired** in prod (`…/functions/v1/email-signup`) — the prod build injects `PUBLIC_CAPTURE_ENDPOINT`, so submissions post (local build shows it empty = the safe local-confirm path).

**⚠ Didn't map cleanly (1):** the drop-in note for blog #8 listed the **"billing-explained pillar"** (`/blog/claude-code-billing-explained`) as an internal link, but that post **isn't published** in the content dir (would 404 — same pre-existing dead-link as the Fable post). Per the author-nothing/no-dead-links rule I wired only the live links: `/business`, `/business/finance`, and the cornerstone accuracy post (`/blog/is-claude-code-cost-accurate`). Pillar link can be added once that post ships. Everything else in `smb-copy-v1.11.md` §1/§2 mapped to components 1:1.

**Note:** `/complete` (Complete-User copy, authored + ready) was **not** included — left out pending an explicit Peter GO (offered; no go given). Concurrent working-tree edits `STREAM-INBOX.md` / `site/src/pages/complete.astro` / `web/*` left untouched for their owners.

---

### 2026-06-19 — 🟪 Weekly-limit cliff blog → 🟢 LIVE

✅ Published `/blog/claude-code-weekly-limit-cliff-july-13` — **live: https://wtclaude.com/blog/claude-code-weekly-limit-cliff-july-13 (200)**, commit **`3dfdd4b`** (blog-only, pushed to `main`), prod deploy **`dpl_Fxn3dkeR94Kh63KskLvb8rCTmHwr`** (READY, aliased to wtclaude.com). Verbatim GTM copy (drop-in note stripped, nothing authored); honesty grep-gate **clean**; `BlogPosting`+`FAQPage`(5 Q/A)+`BreadcrumbList` JSON-LD; in the live sitemap; `/dashboard` excluded. Framed usage-not-price, hedged "unless Anthropic extends it", existing `wtclaude limit` gauge only. **⚠ Internal links:** authored body carries **1** (`/blog/two-claude-billing-changes-neither-happened`, resolves 200), not the 3 the drop-in note anticipated — `/blog/claude-code-billing-explained` isn't a published post (would 404; already dead-linked from the Fable post), so none were added (author-nothing rule). Closes the web half of **PM-GTM-044**. Concurrent `STREAM-INBOX.md` / `site/complete.astro` / `web/*` working-tree edits left untouched for their owners.

---

### 2026-06-17 (later) — 🟪 Badge-sync gap fixed → 🟢 0.1.8 PUBLISHED (CLI + edge fn + migration)

Fixes the bug Channel A/B flagged: the dashboard Badges tab showed **0** despite locally-earned badges, because the CLI computed badges but never sent them to the cloud `badges` table. **`wtclaude@0.1.8` is live on npm (`latest`)** — registry version `0.1.8`, 60 files, shasum `3256a8b7…`. Commit **`a3a40cb`** (pushed to `main`), tag **`v0.1.8`** (pushed to origin). Honesty/privacy posture unchanged; opt-in respected; Phase-C deny intact.

**CLI + edge fn + DB (the fix):**
- **CLI** (`src/sync/index.js`): `syncToCloud()` now includes earned badges (`badge_type` + a **stable, persisted `earned_at`** in new config `badge_earned_at`) in the sync-data payload, behind the same opt-in gate as the rest of the batch. A new `synced_badge_types` marker pushes badges that were **earned-locally-but-never-uploaded even when there are no new turns** (exactly the already-synced-user case). It returns `new_badges` so `src/cli/sync.js` still announces newly-earned ones (duplicate local badge logic removed).
- **Edge fn** (`supabase/functions/sync-data`): passes a `badges` array to the RPC. **🔧 REDEPLOYED.**
- **Migration 008** (`sync_user_batch` → gains `p_badges jsonb default '[]'`, backward-compatible): upserts badges `ON CONFLICT (user_id, badge_type) DO NOTHING` inside the same transaction; `earned_at` set once, never rewritten. Daily recompute now guarded on `v_session_count > 0` (a badges-only push is a no-op for summaries). **🔧 APPLIED to prod DB** (`db push`, 008 was the only pending migration).

**✅ Round-trip PROVEN on Peter's machine (the acceptance gate):** baseline `get-dashboard` badges = **0**; after `wtclaude sync` → **6** (`first_session`, `100k_club`, `million_club`, `10m_club`, `efficient_day`, `model_mixer`, all `earned_at` 18:24:26Z). Re-sync → still **6**, single unchanged `earned_at` (idempotent, no dupes/churn). Direct anon read of `badges` → **401** before and after (Phase-C deny intact). Dashboard reads badges via `get-dashboard`, which now returns all 6 → the live Badges tab has data to render (was empty).

**Ship checklist (all green):** `npm test` **60 pass / 0 fail** (+2 new badge regression tests: payload includes badges w/ stable earned_at; not re-sent / no churn) · `npm pkg fix` clean · `publish --dry-run` warning-free · published tarball verified: `synced_badge_types`/`payload.badges`/`new_badges` present, **0** `*.test.js`, **0** secret-key literals (publishable key only) · cold `npx wtclaude@0.1.8 --version` = **0.1.8**.

**🔴 Ops/PMO — npm 2FA (third recurrence, 0.1.6/0.1.7/0.1.8):** publish again needed the interactive **web-auth** flow from Peter's native terminal (the headless channel can't drive the browser; I prepped the commit + ran every check, Peter ran `npm publish`). **Strongly recommend an npm Automation token** before the next release so publishes don't require a browser approval each time.

**Notes:** committed **code-only** (CLI + edge fn + migration + tests + version bump, 7 files); the concurrent `STREAM-INBOX.md` / `site/complete.astro` / `web/*` working-tree edits were left untouched for their owners. The **`v0.1.7` tag is still local-only** (never pushed to origin) — optional hygiene: `git push origin v0.1.7`.

---

### 2026-06-17 (later) — 🟪 Site docs: drop stale `sync --configure` → ✅ wtclaude-site redeployed

0.1.7 removed the public `--configure` flag (hosted sync, no key pasting — see Channel A entry below), but `/docs` still listed it. Fixed and shipped. Commit **`c8cc244`** (site-only, `docs.astro` only), **pushed to `main`** (`2db6643..c8cc244`); prod deploy **`dpl_4h7nbRrX2hDPGUk14NidVWWVQQoD`** (READY, aliased to **wtclaude.com**) — inspector: https://vercel.com/beannations-projects/wtclaude-site/4h7nbRrX2hDPGUk14NidVWWVQQoD

**DONE:**
- `site/src/pages/docs.astro` sync entry: removed the `--configure` `<code>` chip, fixed trailing punctuation → now reads *"…multi-device totals. `--enable` / `--disable` / `--status`. Local-first — nothing leaves your machine until you enable it, and you preview exactly what syncs first."* Rest of sync copy (opt-in/preview/`--enable` on `/developers`) left as-is.
- **Verified live (cache-busted):** `wtclaude.com/docs` → `--configure` count **0**; three flags render clean. `grep -rni configure site/src` → only remaining hit is `setup`'s "configure tracking" description (English word, not the flag). Build green (15 pages).
- **Scope/honesty:** committed **site-only**, one file. **prod == git HEAD** — stashed the concurrent uncommitted `site/src/pages/complete.astro` draft-persona edit out of the build, deployed, then restored it to the working tree (still uncommitted for its owner). Fable / June-15 content untouched. `STREAM-INBOX.md` + `web/*` working-tree edits left for their owners.

---

### 2026-06-17 (later) — 🟪 Channel A: hosted sync + enable/disable UX + consent fix → 🟢 0.1.7 PUBLISHED

Per `sync-feature-audit.md` (HOSTED model, per Peter June 17). Cloud sync now works out-of-the-box with **no key pasting**, and the audit's consent gap (#4) is closed. **`wtclaude@0.1.7` is live on npm (`latest`)** — commit **`21590ba`**, tag **`v0.1.7`** (⚠️ **local only — NOT yet pushed to `main`**). Edge-function path untouched as instructed; publishable-key-only + the opt-in preview preserved.

**DONE (A1–A4):**
- **A1 hosted defaults baked in** — `getSupabaseConfig()` falls back to `HOSTED_SUPABASE_URL` + the browser-safe `HOSTED_PUBLISHABLE_KEY` (`sb_publishable_n_tD9…`, the same project key used in live testing). User config still overrides (advanced/self-host) but is no longer required. **No secret key ships:** `npm pack` scan — the only `sb_secret_`/`service_role` hits are the legacy-key-**stripping** name lists + comments; publishable key appears once; 0 `.test.js` packed.
- **A2 UX** — bare `wtclaude sync` = manual push that uploads **only if `sync_enabled===true`**, else prints *"Cloud sync is off. Run wtclaude sync --enable…"* and exits (no upload, no silent enable). `--enable` → privacy preview → opt-in (keeps `--yes`; refuses on non-TTY without it) → flips on + one initial push. `--disable` → off, local data/config kept. `--status` reworded (no dev-speak). **Public `--configure` removed** (self-host documented in the README instead). **Auto-sync** = opportunistic, debounced (~10 min), fully-detached background push on the **next CLI invocation** when enabled + local data changed — never on the collector path, never blocking (respects the D-6 budget; `WTCLAUDE_NO_AUTOSYNC=1` opts out).
- **A3 consent fix (audit #4)** — removed both `config.sync_enabled = true` side-effects from `syncToCloud()`. Net invariant: **data leaves the machine only after an explicit `--enable` opt-in**, whether the trigger is manual or auto.
- **A4 tests/ship** — 12 new tests (hosted defaults, no-opt-in→no-upload, `syncToCloud` non-mutation, enable/disable state, preview/`--yes`/non-TTY refusal). **`npm test`: 58 pass / 0 fail.** README sync section rewritten (opt-in flow + one advanced/self-host note, honesty wording intact). Bumped to 0.1.7 and dropped an erroneous `"wtclaude": "^0.1.6"` self-dependency sitting in `package.json`/lock.

**✅ Closes the 🟥 REMAINING — Channel A items from Channel B's 2026-06-17 note** (all verified): fresh `sync` (no enable) → "off, run --enable" + uploads nothing ✅ (cold-install: no config file even written) · `sync --enable --yes` → preview → push to hosted backend, **no key pasting** ✅ · `sync --disable` respected ✅ · tarball clean ✅. **Live cloud round-trip verified** (throwaway anon id, real POST to hosted `sync-data`): **`Synced 1 session(s), 1 turn(s)`**, and `get-summary` read-back returned the row exact (1200/800 in/out, cache 4000/500, $0.0123 billing-grade, model `claude-opus-4-8`). **Cold-install verify (registry 0.1.7):** `--version`=0.1.7 ✅ · ships `src/sync/autosync.js` ✅ · `sync --help` has **0** `--configure` matches ✅.

**🐛 STILL OPEN — badge sync gap (Channel B's 2026-06-17 item): NOT fixed in 0.1.7 (out of scope for this brief).** Confirmed during the round-trip — local earns print ("First Steps", "Cache Champion") but `get-summary` read-back shows `"badges":[]`. Cause: the sync payload is `{session_id, summary, turns}` only — `earned_badges` is never sent, so `sync_user_batch` can't populate the `badges` table. **Needs a dedicated change** (CLI sends `earned_badges` in the batch + the RPC writes `badges`, OR the dashboard derives badges from synced turns). PM to route as its own ticket.

**🔴 Ops/PMO — npm 2FA again forced web-auth for 0.1.7** (recurrence of the 0.1.6 note): `npm publish` hit `EOTP`; shipped only via `npm publish --auth-type=web` from a native terminal (the non-TTY shell can't drive the browser flow). **Recommend adding an npm Automation token** (bypasses 2FA) before the next publish / any CI release — otherwise every patch needs an interactive browser approval.

**Outstanding (small — need Peter/PMO):**
- **Push `main` + tag `v0.1.7`** — committed locally only (`21590ba`); I did not push (not requested). Staged **CLI files only**; the concurrent `STREAM-INBOX.md` / `site/complete.astro` / `web/` working-tree edits were left untouched for their owners.
- **Purge the throwaway smoke row** from prod if desired: anon `71b1dec7-b581-4c98-b71f-35084ad1ecc9` → internal user `22d4b44c-6569-43fc-96f1-da16d20ce239`, session `0fa2f0ca-4beb-41ae-bfc8-d3a1e07c72c5`.
- **🟧 GTM / 🟦 Strategy FYI:** hosted sync now works for a normal user with **no creds** → the "sync across machines / your dashboard" story is truthful on the CLI side (satisfies the audit's cross-lane honesty flag). New behavior to be aware of: once enabled, the CLI pushes opportunistically in the background (debounced, non-blocking).

---

### 2026-06-17 — 🟪 Channel B: dashboard flipped to LIVE → ✅ redeployed + verified end-to-end

The dashboard showed nothing because it was pinned to **mock** data. Phase C is deployed, so I flipped `wtclaude-dashboard` to **live** and redeployed. Prod deploy **`dpl_EpmJCQuWLvJF2VFSmNB2r8H5FvUB`** (READY, aliased to **dashboard.wtclaude.com**, bundle `index-q5dGZVMF.js`) — inspector: https://vercel.com/beannations-projects/wtclaude-dashboard/EpmJCQuWLvJF2VFSmNB2r8H5FvUB · URL: https://wtclaude-dashboard-23zawynzs-beannations-projects.vercel.app

**DONE (channel B — UX/hosted-default; edge-function path untouched as instructed):**
- **`VITE_DATA_MODE=live`** set in `web/.env` **and** in **Vercel Production**. The three `VITE_*` vars were stale Sensitive vars (created Jun-9 mock era, `env pull` returns them empty / write-only), so rather than guess I reset **all three** to the known-good `web/.env` values (`VITE_DATA_MODE=live`, the Supabase URL, the **publishable** key) — so future git/remote builds stay live too.
- **Live read path verified end-to-end** (against prod): direct anon table read (`/rest/v1/daily_summaries` w/ publishable key) → **401 permission denied** (RLS/grant deny, migration 002 intact) ✅ · `get-dashboard` **without** `x-anonymous-id` → **400** ✅ · **with** the real anon id → **200, `meta.source:"live"`**, 9 daily / 20 sessions / 2 devices / rate_limits present ✅ · `get-leaderboard` → **200** ✅.
- **Shipped bundle is the ground truth:** config region baked `` Qn=`live` `` + Supabase URL + publishable key; **0 secret-key matches** in bundle or repo (only hits are a legacy-key-**stripping** list in `src/sync/index.js` + a `sb_secret_should_be_gone` test fixture). `/settings` SPA route serves the new bundle (200) — the exact target of `wtclaude dashboard`.
- **Closes most of the QA-0610 "⚠️ not fully verifiable headlessly" note:** backend + the *shipped* live bundle are now confirmed correct; only a **real-browser visual pass** of `dashboard.wtclaude.com` (renders the user's rows + honesty badges) remains unverifiable headlessly.
- Tidied the now-stale `web/.env` comment. Local `web/dist/` is stale (Jun-9) but irrelevant — prod built remotely.

**🟥 REMAINING — Channel A (npm CLI, 0.1.7), not yet verified by me:** the hosted-sync acceptance items: fresh `wtclaude sync` (no enable) → "sync is off, run --enable" + uploads nothing · `wtclaude sync --enable` → preview → `y` → initial push to hosted backend with **no key pasting** · `wtclaude sync --disable` stops auto-sync & is respected · `npm pack` tarball clean. (Publishable-key-only + the opt-in preview must stay; never a secret key in the CLI.)

**🐛 REMAINING — badge sync gap (CLI/channel A):** live `get-dashboard` returns **0 badges** for my anon id even though `~/.wtclaude/config.json` lists 6 earned (`first_session`, `100k_club`, `million_club`, `10m_club`, `efficient_day`, `model_mixer`). The CLI isn't pushing rows to the `badges` table → the dashboard **Badges tab renders empty** until that syncs. Dashboard side is correct; this is a CLI push gap.

---

### 2026-06-15 — "Split is live" copy flip + Peerlist badge → ✅ site redeployed (one deploy)

Two folded jobs, **ONE redeploy**. The June-15 dual-pool split fired today, so the site now reads **live**, not "coming." Commit **`0d2c6d7`** (site-only, 8 files), pushed to `main`; prod deploy **`dpl_8bMtiMLyxz5vB9LW5B3NBDkykkqr`** (READY, aliased to **wtclaude.com**) — inspector: https://vercel.com/beannations-projects/wtclaude-site/8bMtiMLyxz5vB9LW5B3NBDkykkqr · URL: https://wtclaude-site-xjouip3tp-beannations-projects.vercel.app

**JOB 1 — June-15 copy now present-tense (verified live, cache-busted):**
- **Homepage banner:** no-JS default flipped to the **post-split** variant → *"The billing split is live — Interactive and Agent SDK Credits. WTClaude tracks both."* (pre-split now `hidden`; the client island still date-gates). No "coming" state renders.
- **Homepage `/developers` card** → "…track the June 15 billing split, **now live**."
- **`/developers` meta description** → "…tracks the June 15 Agent-SDK billing split, **now live**."
- **`/blog/claude-billing-changes-june-2026` Change #1** → reframed upcoming→live ("**June 15 — live now**"; "As of June 15, Claude Code usage is split…"). **Change #2 (Fable) untouched** — "withdrawn"/suspended-June-12 note intact. The `the-june-15-split` post is present-tensed too (added a "now live" update box).
- **Honesty:** no "only/first" superiority claim about WTClaude; Fable surfaces untouched; independence disclaimer intact on every page.

**JOB 2 — Peerlist "Live on Launchpad" badge embedded + flagged (verified live):**
- New `PeerlistBadge.astro` (exact embed URL/IDs unchanged; only `theme=` swaps), gated on **`SHOW_PEERLIST_BADGE = true`** in `site/src/config.ts`.
- Homepage **hero** strip ("As featured on", `theme=dark`) + **footer** (`theme=light`, every page). `target=_blank rel=noreferrer`.
- ⏳ **Voting ends Jun 21** — pull = flip `SHOW_PEERLIST_BADGE = false` + redeploy (one-line removal, every placement at once).

**🔴 PMO / 🟧 GTM — blog product claim to investigate (flagged per Peter):** the Job-1 copy edits added a **new product claim beyond a tense-flip** — *"`wtclaude today` now shows your spend **per-pool**, billing-grade in the terminal"* — in **both** `claude-billing-changes-june-2026.md` and `the-june-15-split.md`. It is **live now**. `docs.astro` says the `today`/summary splits per-pool after June 15, so it's *plausibly* accurate, but **I could not verify the shipped CLI actually emits per-pool today** (last CLI re-test was a NO-GO on other commands). **PMO: please confirm `wtclaude@latest today` actually renders per-pool spend** — if not, soften to a plain tense-flip. Kept as-is for now per Peter.

**Scope notes:** committed **site-only**, 8 files. Deliberately **left the draft persona page `/complete` alone** — a concurrent process had an unrelated "Wave 2 / Phase 0" working-tree edit there; I excluded it from the commit **and** stashed it out of the prod build so **prod == git HEAD**, then restored it to the working tree (still uncommitted for its owner). The per-pool blog wording above also came from that concurrent process, not re-authored here. Unrelated non-site changes (`package*.json`, `web/*`) untouched.

---

### 2026-06-15 — Fable suspension → ✅ site redeployed + 🟢 0.1.6 PUBLISHED (reversible, nothing removed)

Per `fable-suspension-cleanup-prompt.md` (supersedes `fable-site-copy.md`'s "remove" spec — **relabel, don't delete**). Claude Fable 5 + Mythos 5 were suspended worldwide June 12 (US export-control directive). Everything Fable-facing is now gated behind **one reversible switch per surface**; no strings, cards, commands, or rate entries were deleted.

**PART 1 — SITE ✅ live on wtclaude.com** (commit `f832e0a`, site-only; prod deploy `dpl_6V1gnntJkcEp9zLuAYuxX7DRXSCD`, READY, aliased)
- Master gate **`FABLE_AVAILABLE = false`** added to `site/src/config.ts` (+ shared `FABLE_SUSPENDED_NOTE`).
- **Home banner:** renders only when `SHOW_FABLE_BANNER && FABLE_AVAILABLE` → gone now; `FABLE_BANNER` string + post-cliff comment kept. *(Verified live: banner `<aside>` absent.)*
- **`/features` "Tracks Claude Fable 5" card:** kept; pill → **Unavailable** + the suspension note (new `unavailable` `FeaturePill` state); original body preserved in source. *(Verified live: "Unavailable" + note render; no live "June-23 cliff" body.)*
- **`/developers`:** "Just shipped: tracks Fable" line relabeled to suspension copy; original line kept in the `FABLE_AVAILABLE` branch. *(Verified live.)*
- **Both blogs:** applied GTM's authored dated update boxes verbatim (drop-in editorial notes stripped, not published); pulled the now-false **`faq` JSON-LD** from both so the free-window/$10-$50/cliff Q&As can't surface as context-free FAQ rich results; posts stay live as dated records. *(Verified live: update boxes render, FAQPage JSON-LD = 0, "withdrawn" note present.)*
- **Honesty grep** (`free through june 22|june.?23 .*(cliff|fable)|\$10.*\$50` over `site/src`): every remaining hit is either a **gated, non-rendered** config/source string or **dated-record blog body** — no live present-tense Fable claim renders on a non-blog surface.
- **(Batched) PM-WEB-014 consent checkbox:** unticked-by-default checkbox added to `CaptureForm.astro` ("Email me about Guardian and WTClaude updates"); posts `consent:true/false`, submit works either way. *(Verified live: `name="consent" data-consent` renders unticked.)*

**PART 2 — CLI 🟢 `wtclaude@0.1.6` (npm `latest`)** (commit `b278f99`, tag `v0.1.6`, both pushed to `main`)
- **`FABLE_SUSPENDED = true`** added to `src/utils/config.js` (+ `FABLE_SUSPENDED_NOTICE`). `wtclaude fable` now prints a suspension notice (text + `--json` `suspended:true`) instead of the forecast; the command, the `fable-5` rate entry, and **all** the forecast logic are untouched — only the output is gated.
- Full checklist green: `npm pkg fix` clean · publish/pack dry-runs warning-free, no test-file leak (59 files) · honesty grep (no live forward claim printed) · **`npm test` 43 pass / 0 fail**.
- **Cold `npx wtclaude@0.1.6` smoke:** `--version`=0.1.6 ✅ · `fable` → suspension notice (text + JSON) ✅ · `today`/`compare` normal, **zero** suspension leakage ✅.

**⤺ TWO restore flip-points (the "when Fable returns" play — replaces the moot June-23 banner-swap):**
1. **Site:** flip `FABLE_AVAILABLE = true` in `site/src/config.ts` → redeploy `wtclaude-site`. Banner, `/features` "Available", and the `/developers` line all restore to original copy in one edit.
2. **CLI:** flip `FABLE_SUSPENDED = false` in `src/utils/config.js` → patch-republish (0.1.7). `wtclaude fable` forecast restores.
3. **Blogs (manual, not flag-gated):** edit the dated update boxes in both Fable posts + restore the `faq` blocks if rich results are wanted again.

**🟧 GTM** — (a) refine the suspension copy (`FABLE_SUSPENDED_NOTE` on site, `FABLE_SUSPENDED_NOTICE` in CLI) + the neutral pullback messaging; (b) **two GTM-owned blog-copy items I deliberately did NOT re-author** (per the "apply GTM's edits, don't re-author" instruction) still frame the June-23 cliff **context-free** on `/blog` + SERP: the `claude-billing-changes-june-2026` **meta `description`** and the "Further reading" **link title** inside `is-claude-code-cost-accurate.md`. GTM's call whether to soften.

**🟦 Strategy** — the "tracks Fable" claim is **paused, not retired** (held behind `FABLE_AVAILABLE`/`FABLE_SUSPENDED`, fully reversible). Update STRAT canon so it isn't scrubbed as a dead claim.

**Ops FYI (npm):** 0.1.6 went out after an npm-auth detour (account had a security-key 2FA; published via web auth). If 2FA was left **disabled** on the npm account to get this out, recommend re-enabling it and/or adding an **Automation token** (bypasses 2FA) for future CI publishes.

---

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
