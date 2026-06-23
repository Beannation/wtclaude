/**
 * Free Claude Spend-Audit — shared types.
 *
 * The intake is the claude.ai → Settings → Analytics → "Export Spend Report" CSV
 * (one row per person × model × product). NOT the platform.claude.com Console export
 * (API billing, no per-person) — that one trips the wrong-file guard.
 *
 * Spec of record: free-seat-audit-experience.md (rev 2).
 * Everything in this module is PURE (no DOM, no network) so it runs identically at
 * build time (the static /business/audit/sample page) and in the browser.
 */

/** One parsed row of the Spend Report — person × model × product, summed over the window. */
export interface SpendRow {
  email: string;
  account_uuid: string;
  product: string; // Claude Code | Chat | Cowork | Office Agents | …
  model: string; // claude-opus-4-6, …
  model_family: string; // Opus | Sonnet | Haiku | (other, normalized)
  total_requests: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_net_spend_usd: number;
  total_gross_spend_usd: number;
}

/** Which optional columns the upload actually carried (drives graceful degradation). */
export interface ColumnAvailability {
  email: boolean;
  product: boolean;
  modelFamily: boolean;
  requests: boolean;
  promptTokens: boolean;
  completionTokens: boolean;
  netSpend: boolean;
  grossSpend: boolean;
}

export type ParseResult =
  | { kind: 'ok'; rows: SpendRow[]; columns: ColumnAvailability; headers: string[] }
  /** Looks like the platform.claude.com Console export (workspace_id, no per-person email). */
  | { kind: 'wrong-file'; detail: string }
  | { kind: 'empty'; detail: string }
  | { kind: 'error'; detail: string };

/** Per-person rollup used by every hook. */
export interface Person {
  email: string;
  domain: string;
  net: number; // Σ net_spend
  gross: number; // Σ gross_spend
  requests: number;
  promptTokens: number;
  completionTokens: number;
  /** net spend by model family (Opus/Sonnet/Haiku/other). */
  byFamily: Record<string, number>;
  /** net spend by product surface. */
  byProduct: Record<string, number>;
  /** the dominant weight for ranking: net spend when $ exist, else request volume. */
  weight: number;
}

export interface PersonFlag {
  key:
    | 'power-user'
    | 'near-dormant'
    | 'heavy-opus'
    | 'opus-cheap-surface'
    | 'dollar-per-req-outlier'
    | 'context-heavy';
  label: string;
}

export interface PersonRow extends Person {
  dollarPerReq: number | null;
  contextRatio: number | null; // prompt:completion
  opusShare: number; // 0..1 of this person's spend on Opus
  flags: PersonFlag[];
  /** which 1-based rank in the pareto sort (1 = top spender). */
  rank: number;
}

/** Seat-pricing config — versioned, list-price ESTIMATES only (never billing-grade). */
export interface SeatPricing {
  version: string;
  premiumMonthlyUsd: number;
  standardMonthlyUsd: number;
  note: string;
}

export interface HookH1 {
  available: boolean;
  basis: 'spend' | 'volume';
  peopleFor80: number;
  totalPeople: number;
  topVsMedian: number; // multiple
  topEmail: string;
}
export interface HookH2 {
  available: boolean;
  seatCount: number | null;
  activeUsers: number;
  dormantSeats: number | null; // seatCount − activeUsers (needs seat count)
  nearDormant: { email: string; requests: number; net: number }[];
  reclaimUsdPerYear: number | null; // needs seat count (assumes Premium)
  basis: 'spend' | 'volume';
}
export interface HookH3 {
  available: boolean;
  opusUsd: number;
  opusPctOfSpend: number;
  opusPeople: number;
  topOpusUsers: { email: string; usd: number }[];
  opusOnCheapSurface: { email: string; usd: number; product: string }[];
}
export interface HookH4 {
  available: boolean;
  byProduct: { product: string; usd: number; pct: number }[];
}
export interface HookH5 {
  available: boolean;
  teamAvgPerReq: number; // total net ÷ total requests (the "$0.90" baseline)
  outliers: { email: string; perReq: number; multiple: number }[];
}
export interface HookH6 {
  available: boolean;
  net: number;
  gross: number;
  maskedUsd: number;
  maskedPct: number;
}
export interface HookH7 {
  available: boolean;
  byDomain: { domain: string; usd: number; people: number }[];
}
export interface HookH8 {
  available: boolean;
  topRatios: { email: string; ratio: number }[];
}

export interface Hooks {
  /** true when the export carries $ (most plans); false on seat-based no-overage exports. */
  hasSpend: boolean;
  totalNet: number;
  totalGross: number;
  totalRequests: number;
  people: PersonRow[];
  columns: ColumnAvailability;
  seatCount: number | null;
  pricing: SeatPricing;
  h1: HookH1;
  h2: HookH2;
  h3: HookH3;
  h4: HookH4;
  h5: HookH5;
  h6: HookH6;
  h7: HookH7;
  h8: HookH8;
}

/**
 * The ONLY thing that ever leaves the browser (Option A, locked): the email plus
 * AGGREGATE numbers + action counts. No per-person rows, no names, no domains, no file.
 */
export interface LeadAggregate {
  is_sample: boolean;
  schema: 'full' | 'degraded';
  has_spend: boolean;
  people_count: number;
  seats_supplied: number | null;
  total_net_usd: number | null;
  total_gross_usd: number | null;
  discount_usd: number | null;
  discount_pct: number | null;
  pareto_people_for_80pct: number;
  top_vs_median_multiple: number;
  opus_pct_of_spend: number | null;
  opus_people: number;
  deadweight_seats: number | null;
  deadweight_reclaim_usd_yr: number | null;
  near_dormant_users: number;
  dollar_per_req_outliers: number;
  opus_in_chat_users: number;
  /** generic Anthropic surface names only (Code/Chat/Cowork/Office Agents) — not identifying. */
  product_mix: Record<string, number>;
  /** COUNT only — never the domain names (a domain can identify the company). */
  domains_count: number;
}

export interface LeadPayload {
  email: string;
  tag: string;
  source: string;
  website: string; // honeypot
  consent: boolean;
  monthly_rerun: boolean;
  audit: LeadAggregate;
}
