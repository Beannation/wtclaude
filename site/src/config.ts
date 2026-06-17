/**
 * Launch gates for the Wave-1 site. These are the load-bearing switches the
 * reconciliation audit + kickoff call out. Change here, not in page copy.
 */

/** The single flag that drives the June-15 dated banner + forecast variants. */
export const DUAL_POOL_ACTIVATION_DATE = '2026-06-15T00:00:00-04:00';

/**
 * JUNE-15 BANNER GATE (PM, June 16, 2026). Anthropic PAUSED the Agent-SDK billing
 * split before June 15 — it did not take effect (Help Center art. 15036540). The
 * June15Banner auto-flips to "the split is live," which is now false, so it must not
 * render. Mirrors the Fable pattern: the component + both span variants are kept intact
 * for a one-line restore (flip to true + redeploy) if a revised split lands.
 * While SHOW_JUNE15_BANNER is false the banner does not render anywhere.
 */
export const SHOW_JUNE15_BANNER = false;

/**
 * SPLIT MASTER GATE (PM, June 16, 2026) — mirrors the Fable FABLE_AVAILABLE pattern so the
 * whole June-15 dual-pool cluster restores in ONE flip if the split returns. The Agent-SDK
 * billing split was announced for June 15, then PAUSED before it took effect. While
 * SPLIT_LIVE is false:
 *   - pure dated/live UI (countdowns, a live "June-14 Readiness Report" CTA, a live
 *     "June-15 forecast tile") is hidden — there's no event to count down to;
 *   - the real, shipped features (dual-pool view, agent-pool forecast, credits-enough check)
 *     stay, but are reworded to conditional/ready, with SPLIT_STATUS_NOTE shown once per cluster.
 * Flip to true (+ redeploy) and the dated surfaces restore. Nothing is deleted.
 */
export const SPLIT_LIVE = false;
export const SPLIT_STATUS_NOTE =
  "Anthropic announced an Agent-SDK billing split for June 15, then paused it before it took effect. Nothing has changed — WTClaude's dual-pool view is built and ready if a revised version returns.";

/**
 * D-13 MASTER GATE — the single "cloud is live" flip (GTM-028).
 *
 * When false (today): the site keeps its §1–4 "coming" states — no cloud-sync claim,
 * the dashboard is a "what's next", no live /dashboard link. When true: all GTM-028
 * CLOUD-ON copy publishes at once (Home hero line, /developers §4b dashboard + §4c sync
 * sections, the §7 append, and the docs `sync`/`dashboard` commands) AND the dashboard
 * nav/footer link turns on. ONE FLIP — sync + dashboard ship together.
 *
 * ⚠ DO NOT flip until the PMO confirms D-13 is green:
 *   - the cloud re-test passes Block 5 (sync) + Block 6 (dashboard), AND
 *   - infra confirms the web/ dashboard is deployed (a live /dashboard link 404s otherwise).
 * SEC-ROTATE containment is done (Jun 5); the live gate is the Phase-C deploy + re-test.
 */
export const CLOUD_LIVE = true;

/**
 * The dashboard nav/footer link + the §4b "Open your dashboard" CTA point at a live
 * /dashboard route, so they must stay off until the dashboard is actually deployed.
 * Derived from CLOUD_LIVE so the link flips together with the cloud-on copy (one flip,
 * no orphaned 404). Build-time guard — set CLOUD_LIVE, not this, to go live.
 */
export const SHOW_DASHBOARD_LINK = CLOUD_LIVE;

/**
 * Fast-mode copy gate (BUILD-022 / D-8, due Jun-8 EOD).
 * - SHOW_FAST_MODE=false removes every fast-mode mention from the site in one flip.
 * - FAST_MODE_BADGE = 'inferred' renders the inferred badge; null = no badge
 *   (use null only if the billing-grade field-read verifies by Jun-8).
 */
export const SHOW_FAST_MODE = false;
export const FAST_MODE_BADGE: 'inferred' | null = 'inferred';

/**
 * The task-category breakdown lacks `tool_names` on live payloads (task_category is
 * null today). Never market `tasks` as a working launch feature — coming-soon at most.
 */
export const SHOW_TASKS_FEATURE = false;

/**
 * Peerlist "Live on Launchpad" badge (PM, June 15). Time-sensitive social proof while
 * WTClaude is live on the Peerlist Launchpad — VOTING ENDS JUNE 21. SHOW_PEERLIST_BADGE=false
 * pulls every badge (homepage hero strip + footer) in one flip — a one-line removal when
 * voting closes. The embed URL/IDs live in PeerlistBadge.astro and are fixed; only the
 * theme query param swaps light/dark per surface.
 */
export const SHOW_PEERLIST_BADGE = true;

/**
 * Internal "Draft — copy gap" markers (`DraftNote.astro`) on the persona pages
 * (/complete, /business, /business/finance). These are dev-only flags for GTM —
 * keep FALSE in production so they never render publicly. Flip true locally to see them.
 */
export const SHOW_DRAFT_NOTES = false;

/**
 * FABLE MASTER GATE — the single "Fable is live" flip (PM, June 14, 2026).
 *
 * Claude Fable 5 (and Mythos 5) was suspended worldwide on June 12, 2026 under a US
 * export-control directive. Return is expected but uncertain. Rather than delete the
 * Fable surfaces, every Fable-facing surface keys off this ONE flag so it all restores
 * in a single edit when Fable returns. While FABLE_AVAILABLE is false:
 *   - the home Fable banner does not render (FableBanner.astro: SHOW_FABLE_BANNER && FABLE_AVAILABLE)
 *   - the /features "Tracks Claude Fable 5" card shows "Unavailable" + FABLE_SUSPENDED_NOTE
 *   - the /developers "Just shipped: tracks Fable" line swaps to the suspension copy
 * Nothing is removed — flip to true (+ redeploy) and every Fable surface restores to its
 * normal state with the original copy. Keep FABLE_BANNER + the post-cliff comment below.
 * (The two Fable blog posts carry their own dated update boxes — not flag-gated; refresh
 * those notes by hand when Fable returns.)
 */
export const FABLE_AVAILABLE = false;

/**
 * One-line suspension note, reused by the /features card + /developers line so they read
 * identically. Keep in sync with the blog update boxes. GTM may refine this copy.
 */
export const FABLE_SUSPENDED_NOTE =
  'Claude Fable 5 is temporarily suspended (US export-control directive, June 12, 2026); tracking resumes when it returns.';

/**
 * Fable-5 launch ticker (PM-GTM-038). SHOW_FABLE_BANNER=false pulls the home banner in
 * one flip. FABLE_BANNER is the pre-cliff string (now → June 22), verbatim from GTM.
 * NOTE (June 14): the banner now ALSO requires FABLE_AVAILABLE (see master gate above),
 * so it stays hidden while Fable is suspended without touching this string. Both kept so
 * the banner is a one-line restore. On/after June 23 swap in the post-cliff variant:
 *   'Now tracking Claude Fable 5 — billing-grade cost in your terminal. See what it’s costing you: `wtclaude fable`.'
 */
export const SHOW_FABLE_BANNER = true;
export const FABLE_BANNER =
  'Now tracking Claude Fable 5 — billing-grade cost in your terminal. Free through June 22; see the June-23 cliff coming with `wtclaude fable`.';

/**
 * Guardian pricing — locked + publishable (GTM-030 / PM-GTM-034). SMB pricing
 * remains embargoed (no numbers). `full` is the single canonical price string —
 * use it everywhere a price is shown so every surface reads identically.
 */
export const GUARDIAN_PRICE = {
  monthly: '$2.99/mo',
  yearly: '$24.99/year',
  yearlyEquiv: '≈$2.08/mo — save 30%',
  full: '$2.99/mo · $24.99/year (≈$2.08/mo — save 30%)',
};

/**
 * Email capture = the launch conversion path. The UI + submit handler are wired here;
 * the BACKEND is intentionally NOT stood up by this channel (collision with infra +
 * the dashboard/Supabase channel). Slot the real endpoint in when the PMO/infra picks one:
 *   - '' (default) → the form validates + confirms LOCALLY only; nothing is stored, and
 *     each submission is logged to the console for QA. Safe for preview + launch-if-undecided.
 *   - a URL → the form POSTs JSON `{ email, tag, source }` to it (a form service like
 *     Buttondown/Formspark, or a Supabase Edge Function). Success/error states handled.
 * See STREAM-INBOX PM-WEB-003 for the endpoint options + recommendation.
 *
 * Wired to env (PM-WEB-005): the backend + the Vercel env var (PUBLIC_CAPTURE_ENDPOINT) are live.
 * Empty string (no env, e.g. local dev) keeps the safe local-confirm path.
 */
export const CAPTURE_ENDPOINT = import.meta.env.PUBLIC_CAPTURE_ENDPOINT ?? '';
export const CAPTURE_METHOD: 'POST' = 'POST';

/** Canonical links. Socials are the live WTClaude brand profiles (PM-WEB-015). */
export const LINKS = {
  github: 'https://github.com/Beannation/wtclaude',
  x: 'https://x.com/getwtclaude',
  telegram: 'https://t.me/wtclaude_news',
  install: 'npx wtclaude setup',
};
