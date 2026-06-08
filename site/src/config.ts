/**
 * Launch gates for the Wave-1 site. These are the load-bearing switches the
 * reconciliation audit + kickoff call out. Change here, not in page copy.
 */

/** The single flag that drives the June-15 dated banner + forecast variants. */
export const DUAL_POOL_ACTIVATION_DATE = '2026-06-15T00:00:00-04:00';

/**
 * SEC gate. No live-dashboard link until Build confirms SEC Phase C is deployed.
 * SEC-ROTATE containment is done (Jun 5); the live gate is now Phase C. Keep false
 * until Peter confirms Phase C is live — the web dashboard stays a "coming" state.
 */
export const SHOW_DASHBOARD_LINK = false;

/**
 * Fast-mode copy gate (BUILD-022 / D-8, due Jun-8 EOD).
 * - SHOW_FAST_MODE=false removes every fast-mode mention from the site in one flip.
 * - FAST_MODE_BADGE = 'inferred' renders the inferred badge; null = no badge
 *   (use null only if the billing-grade field-read verifies by Jun-8).
 */
export const SHOW_FAST_MODE = true;
export const FAST_MODE_BADGE: 'inferred' | null = 'inferred';

/**
 * The task-category breakdown lacks `tool_names` on live payloads (task_category is
 * null today). Never market `tasks` as a working launch feature — coming-soon at most.
 */
export const SHOW_TASKS_FEATURE = false;

/** Guardian pricing — locked + publishable. SMB pricing remains embargoed (no numbers). */
export const GUARDIAN_PRICE = {
  monthly: '$2.99/mo',
  yearly: '$24.99/year',
  yearlyEquiv: '≈$2.08/mo — save 30%',
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

/** Canonical links. */
export const LINKS = {
  github: 'https://github.com/wtclaude/wtclaude',
  install: 'npx wtclaude setup',
};
