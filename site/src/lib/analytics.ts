/**
 * Umami (self-hosted) event wiring. The site fires the launch-funnel events named
 * in the copy spec. If Umami isn't loaded (env unset / blocked), every call no-ops.
 *
 * Client usage:  import { track } from '../lib/analytics'; track('install_cmd_copied')
 * Markup usage:  data-track="cta_get_started"  (see initTracking below)
 */

export type UmamiEvent =
  | 'install_cmd_copied'
  | 'cta_get_started'
  | 'cta_github'
  | 'cta_docs'
  | 'lp_view_dev'
  | 'lp_view_complete'
  | 'lp_view_smb_tease'
  | 'forecast_explainer_view'
  | 'readiness_cta'
  | 'countdown_banner_click'
  | 'guardian_waitlist'
  | 'blog_read_50'
  | 'blog_read_100';

declare global {
  interface Window {
    umami?: { track: (event: string, data?: Record<string, unknown>) => void };
  }
}

export function track(event: UmamiEvent, data?: Record<string, unknown>): void {
  try {
    window.umami?.track(event, data);
  } catch {
    /* analytics must never break the page */
  }
}
