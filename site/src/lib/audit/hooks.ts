/**
 * The 8 spend-audit hooks — computed entirely client-side from the one Spend Report CSV.
 * Every figure here is a LABELED ESTIMATE; on seat-based plans the $ is overage-only.
 * Verified against seat-audit-hooks-proposal.md's fixture outputs (13 users / 24 seats).
 */
import type {
  Hooks,
  LeadAggregate,
  Person,
  PersonFlag,
  PersonRow,
  SeatPricing,
  SpendRow,
  ColumnAvailability,
} from './types';
// Explicit .ts extension so node --test can load this module as-is (Astro resolves it either way).
import { SEAT_PRICES } from './seatPrices.ts';

/**
 * Seat-pricing config — LIST-PRICE ESTIMATES only. Used solely for the H2 reclaim figure
 * ("up to ~$X/yr if Premium"). Never presented as billing-grade. The prices come from the
 * versioned rate sheet via the generated seatPrices.ts mirror (QA-0928-199) — never a literal
 * here. The reclaim math uses the annual-billing price, and every surface says so.
 * Confirm tiers in claude.ai → Org → Seats.
 */
export const SEAT_PRICING: SeatPricing = {
  version: SEAT_PRICES.sheet,
  premiumAnnualUsd: SEAT_PRICES.team_premium.price_monthly_annual_billing,
  premiumMonthlyUsd: SEAT_PRICES.team_premium.price_monthly,
  standardAnnualUsd: SEAT_PRICES.team_standard.price_monthly_annual_billing,
  standardMonthlyUsd: SEAT_PRICES.team_standard.price_monthly,
  note: 'Seat prices are list-price estimates used only for the reclaim figure — confirm tiers in claude.ai → Org → Seats.',
};

/** The seat-count field accepts whole numbers in this range; anything else is explained, not used. */
export const MAX_SEATS = 100_000;

/** Parse the "Seats you're paying for" field (QA-0928-192). Empty → not supplied (no message). */
export function parseSeatCount(raw: string): { seats: number | null; error: string | null } {
  const v = raw.trim();
  if (!v) return { seats: null, error: null };
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1)
    return { seats: null, error: 'Enter a whole number of seats (1 or more) — this value is ignored.' };
  if (n > MAX_SEATS)
    return { seats: null, error: `That's more than ${MAX_SEATS.toLocaleString('en-US')} seats — check the number; it's ignored.` };
  return { seats: n, error: null };
}

/** A user is "near-dormant" if they generated at most this many requests in the window. */
const NEAR_DORMANT_REQUESTS = 20;
/** Flag $/request outliers at or above this multiple of the team average. */
const PER_REQ_OUTLIER_MULTIPLE = 3;
/** Flag a person "heavy <family>" when premium models are at least this share of their own spend. */
const HEAVY_PREMIUM_SHARE = 0.5;
/**
 * Premium model families — the rate sheet prices each at 2× Sonnet 5 or more (Opus 5.5 $4/$20;
 * Fable and Mythos $10/$50, 2.5× Opus 5.5). QA-0928-109: Fable used to be invisible here.
 */
export const PREMIUM_FAMILIES = ['Opus', 'Fable', 'Mythos'];
const isPremium = (family: string) => PREMIUM_FAMILIES.includes(family);
/** Surfaces where a premium model is usually overkill (cheap-task overspend). */
const CHEAP_SURFACES = new Set(['chat', 'cowork', 'office agents']);
/**
 * Seat-based plans export in-seat usage as requests at $0 net AND $0 gross. When at least this
 * share of all requests is in-seat, the $ columns are overage only (QA-0928-110). A
 * product-tunable threshold: usage-based exports have no $0/$0 rows, and a stray rounded-to-$0
 * row stays far below it. Rows credits zeroed out (net $0, gross > $0) are a discount, not seat usage.
 */
const SEAT_PLAN_ZERO_SHARE = 0.1;
/** A row "carries $" above this, net or gross (sub-cent on both counts as in-seat). */
const PAID_ROW_USD = 0.005;
const isInSeatRow = (r: SpendRow) => r.total_net_spend_usd <= PAID_ROW_USD && r.total_gross_spend_usd <= PAID_ROW_USD;
/** Flag context-heavy when prompt:completion ratio is at least this. */
const CONTEXT_HEAVY_RATIO = 8;

const domainOf = (email: string) => {
  const at = email.lastIndexOf('@');
  return at >= 0 ? email.slice(at + 1) : email;
};

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Roll the per-row CSV up into one record per person. */
export function aggregatePeople(rows: SpendRow[]): Person[] {
  const map = new Map<string, Person>();
  for (const r of rows) {
    let p = map.get(r.email);
    if (!p) {
      p = {
        email: r.email,
        domain: domainOf(r.email),
        net: 0,
        gross: 0,
        requests: 0,
        paidRequests: 0,
        promptTokens: 0,
        completionTokens: 0,
        byFamily: {},
        byProduct: {},
        weight: 0,
      };
      map.set(r.email, p);
    }
    p.net += r.total_net_spend_usd;
    p.gross += r.total_gross_spend_usd;
    p.requests += r.total_requests;
    if (!isInSeatRow(r)) p.paidRequests += r.total_requests;
    p.promptTokens += r.total_prompt_tokens;
    p.completionTokens += r.total_completion_tokens;
    p.byFamily[r.model_family] = (p.byFamily[r.model_family] || 0) + r.total_net_spend_usd;
    p.byProduct[r.product] = (p.byProduct[r.product] || 0) + r.total_net_spend_usd;
  }
  return [...map.values()];
}

export function computeHooks(
  rows: SpendRow[],
  columns: ColumnAvailability,
  opts: { seatCount?: number | null } = {},
): Hooks {
  const people = aggregatePeople(rows);
  const totalNet = people.reduce((s, p) => s + p.net, 0);
  const totalGross = people.reduce((s, p) => s + p.gross, 0);
  const totalRequests = people.reduce((s, p) => s + p.requests, 0);

  // Seat-based no-overage exports carry volume but ~$0 spend. Fall back to request volume.
  const hasSpend = columns.netSpend && totalNet > 0.005;
  const weightOf = (p: Person) => (hasSpend ? p.net : p.requests);
  people.forEach((p) => (p.weight = weightOf(p)));

  // Seat-based WITH overage: most requests are in-seat ($0), so the $ is overage only and
  // $/request must divide overage $ by the overage (paid) requests, not by free in-seat ones.
  const inSeatRequests = totalRequests - people.reduce((s, p) => s + p.paidRequests, 0);
  const overageOnly = hasSpend && totalRequests > 0 && inSeatRequests / totalRequests >= SEAT_PLAN_ZERO_SHARE;
  const perReqRequests = (p: Person) => (overageOnly ? p.paidRequests : p.requests);
  const totalPerReqRequests = people.reduce((s, p) => s + perReqRequests(p), 0);

  // Rank by weight (desc) → pareto / power-users.
  const ranked = [...people].sort((a, b) => b.weight - a.weight);
  const totalWeight = ranked.reduce((s, p) => s + p.weight, 0);

  // ---- H5 baseline (team average $/request — the "$0.90") ----
  const teamAvgPerReq = totalPerReqRequests > 0 ? totalNet / totalPerReqRequests : 0;

  // ---- Premium-model aggregates (for H3): Opus, Fable, Mythos ----
  const premiumOf = (p: Person) =>
    Object.entries(p.byFamily).reduce((s, [fam, usd]) => s + (isPremium(fam) ? usd : 0), 0);
  /** a person's biggest premium family (labels "heavy Fable" etc.) */
  const topPremiumFamily = (p: Person) =>
    Object.entries(p.byFamily)
      .filter(([fam, usd]) => isPremium(fam) && usd > 0)
      .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Opus';
  const premiumUsd = people.reduce((s, p) => s + premiumOf(p), 0);
  const premiumPeopleSet = new Set(people.filter((p) => premiumOf(p) > 0).map((p) => p.email));
  const familyTotals = new Map<string, number>();
  for (const p of people)
    for (const [fam, usd] of Object.entries(p.byFamily))
      if (isPremium(fam) && usd > 0) familyTotals.set(fam, (familyTotals.get(fam) || 0) + usd);
  const premiumFamilies = [...familyTotals.entries()].sort((a, b) => b[1] - a[1]).map(([fam]) => fam);

  // ---- Build the per-person rows (with flags) ----
  const seatCount = opts.seatCount ?? null;
  // pareto cut: people that together reach 80% of weight → "power users"
  let cum = 0;
  let pareto80 = 0;
  for (const p of ranked) {
    cum += p.weight;
    pareto80++;
    if (totalWeight > 0 && cum / totalWeight >= 0.8) break;
  }
  const powerUserEmails = new Set(ranked.slice(0, pareto80).map((p) => p.email));

  const personRows: PersonRow[] = ranked.map((p, i) => {
    const reqs = perReqRequests(p);
    const dollarPerReq = reqs > 0 && hasSpend ? p.net / reqs : null;
    const contextRatio = p.completionTokens > 0 ? p.promptTokens / p.completionTokens : null;
    const premiumUsdP = premiumOf(p);
    const premiumShare = p.net > 0 ? premiumUsdP / p.net : 0;
    const flags: PersonFlag[] = [];

    if (powerUserEmails.has(p.email)) flags.push({ key: 'power-user', label: 'power user' });
    if (p.requests <= NEAR_DORMANT_REQUESTS)
      flags.push({ key: 'near-dormant', label: 'near-dormant' });
    if (hasSpend && premiumShare >= HEAVY_PREMIUM_SHARE && premiumUsdP > 0)
      flags.push({ key: 'heavy-premium', label: `heavy ${topPremiumFamily(p)}` });
    // A premium model on a cheap surface (Chat/Cowork/Office) — cheap-task overspend
    for (const [prod, usd] of Object.entries(p.byProduct)) {
      if (CHEAP_SURFACES.has(prod.toLowerCase()) && premiumUsdP > 0 && usd > 0) {
        // only flag if this person actually ran a premium model on that cheap surface
        const premiumHere = rows.find(
          (r) => r.email === p.email && r.product === prod && isPremium(r.model_family),
        );
        if (premiumHere) {
          flags.push({ key: 'premium-cheap-surface', label: `${premiumHere.model_family} in ${prod}` });
          break;
        }
      }
    }
    if (
      dollarPerReq != null &&
      teamAvgPerReq > 0 &&
      dollarPerReq >= teamAvgPerReq * PER_REQ_OUTLIER_MULTIPLE
    )
      flags.push({ key: 'dollar-per-req-outlier', label: '$/req outlier' });
    if (contextRatio != null && contextRatio >= CONTEXT_HEAVY_RATIO)
      flags.push({ key: 'context-heavy', label: 'context-heavy' });

    return { ...p, dollarPerReq, contextRatio, premiumShare, flags, rank: i + 1 };
  });

  // ---- H1 concentration ----
  const weights = ranked.map((p) => p.weight);
  const med = median(weights);
  const top = ranked[0]?.weight ?? 0;
  const h1 = {
    available: true,
    basis: (hasSpend ? 'spend' : 'volume') as 'spend' | 'volume',
    peopleFor80: pareto80,
    totalPeople: people.length,
    topVsMedian: med > 0 ? top / med : 0,
    topEmail: ranked[0]?.email ?? '',
  };

  // ---- H2 dead-weight ----
  const nearDormant = people
    .filter((p) => p.requests <= NEAR_DORMANT_REQUESTS)
    .sort((a, b) => a.requests - b.requests)
    .map((p) => ({ email: p.email, requests: p.requests, net: p.net }));
  const dormantSeats = seatCount != null ? Math.max(0, seatCount - people.length) : null;
  // Premium seats at the annual-billing list price (labelled as such wherever it renders).
  const reclaimUsdPerYear =
    dormantSeats != null ? dormantSeats * SEAT_PRICING.premiumAnnualUsd * 12 : null;
  const h2 = {
    available: columns.requests,
    seatCount,
    activeUsers: people.length,
    dormantSeats,
    seatsBelowPeople: seatCount != null && seatCount < people.length,
    nearDormant,
    reclaimUsdPerYear,
    basis: (hasSpend ? 'spend' : 'volume') as 'spend' | 'volume',
  };

  // ---- H3 model mix ----
  const topPremiumUsers = people
    .filter((p) => premiumOf(p) > 0)
    .sort((a, b) => premiumOf(b) - premiumOf(a))
    .slice(0, 5)
    .map((p) => ({ email: p.email, usd: premiumOf(p) }));
  const premiumOnCheapSurface: { email: string; usd: number; product: string; family: string }[] = [];
  for (const r of rows) {
    if (isPremium(r.model_family) && CHEAP_SURFACES.has(r.product.toLowerCase())) {
      const existing = premiumOnCheapSurface.find(
        (x) => x.email === r.email && x.product === r.product && x.family === r.model_family,
      );
      if (existing) existing.usd += r.total_net_spend_usd;
      else
        premiumOnCheapSurface.push({
          email: r.email,
          usd: r.total_net_spend_usd,
          product: r.product,
          family: r.model_family,
        });
    }
  }
  premiumOnCheapSurface.sort((a, b) => b.usd - a.usd);
  const h3 = {
    available: columns.modelFamily && hasSpend,
    premiumFamilies,
    premiumUsd,
    premiumPctOfSpend: totalNet > 0 ? (premiumUsd / totalNet) * 100 : 0,
    premiumPeople: premiumPeopleSet.size,
    topPremiumUsers,
    premiumOnCheapSurface,
  };

  // ---- H4 hidden surfaces ----
  const productTotals = new Map<string, number>();
  for (const p of people)
    for (const [prod, usd] of Object.entries(p.byProduct))
      productTotals.set(prod, (productTotals.get(prod) || 0) + usd);
  const byProduct = [...productTotals.entries()]
    .map(([product, usd]) => ({ product, usd, pct: totalNet > 0 ? (usd / totalNet) * 100 : 0 }))
    .sort((a, b) => b.usd - a.usd);
  const h4 = { available: columns.product && hasSpend, byProduct };

  // ---- H5 $/request outliers ----
  const outliers = personRows
    .filter(
      (p) =>
        p.dollarPerReq != null && teamAvgPerReq > 0 && p.dollarPerReq >= teamAvgPerReq * PER_REQ_OUTLIER_MULTIPLE,
    )
    .sort((a, b) => (b.dollarPerReq || 0) - (a.dollarPerReq || 0))
    .map((p) => ({
      email: p.email,
      perReq: p.dollarPerReq as number,
      multiple: teamAvgPerReq > 0 ? (p.dollarPerReq as number) / teamAvgPerReq : 0,
    }));
  const h5 = {
    available: columns.requests && hasSpend,
    teamAvgPerReq,
    outliers,
  };

  // ---- H6 discount / list exposure ----
  const maskedUsd = totalGross - totalNet;
  const h6 = {
    available: columns.grossSpend && columns.netSpend && totalGross > 0,
    net: totalNet,
    gross: totalGross,
    maskedUsd,
    maskedPct: totalGross > 0 ? (maskedUsd / totalGross) * 100 : 0,
  };

  // ---- H7 domain allocation ----
  const domMap = new Map<string, { usd: number; people: number }>();
  for (const p of people) {
    const d = domMap.get(p.domain) || { usd: 0, people: 0 };
    d.usd += hasSpend ? p.net : 0;
    d.people += 1;
    domMap.set(p.domain, d);
  }
  const byDomain = [...domMap.entries()]
    .map(([domain, v]) => ({ domain, usd: v.usd, people: v.people }))
    .sort((a, b) => b.usd - a.usd);
  const h7 = { available: byDomain.length > 1, byDomain };

  // ---- H8 context-ratio proxy ----
  const topRatios = personRows
    .filter((p) => p.contextRatio != null)
    .sort((a, b) => (b.contextRatio || 0) - (a.contextRatio || 0))
    .slice(0, 5)
    .map((p) => ({ email: p.email, ratio: p.contextRatio as number }));
  const h8 = { available: columns.promptTokens && columns.completionTokens, topRatios };

  return {
    hasSpend,
    overageOnly,
    inSeatRequests,
    totalNet,
    totalGross,
    totalRequests,
    people: personRows,
    columns,
    seatCount,
    pricing: SEAT_PRICING,
    h1,
    h2,
    h3,
    h4,
    h5,
    h6,
    h7,
    h8,
  };
}

/**
 * Distill the hooks into the AGGREGATE-ONLY lead payload (Option A). This is the only data
 * that ever leaves the browser. It carries NO emails, NO names, NO per-domain $ — counts and
 * org-level totals only. Round all $ to whole dollars.
 */
export function toLeadAggregate(hooks: Hooks, opts: { sample: boolean }): LeadAggregate {
  const r0 = (n: number | null) => (n == null ? null : Math.round(n));
  const degraded = Object.values(hooks.columns).some((v) => v === false);
  const productMix: Record<string, number> = {};
  for (const p of hooks.h4.byProduct) productMix[p.product] = Math.round(p.usd);
  return {
    is_sample: opts.sample,
    schema: degraded ? 'degraded' : 'full',
    has_spend: hooks.hasSpend,
    people_count: hooks.people.length,
    seats_supplied: hooks.seatCount,
    total_net_usd: hooks.hasSpend ? r0(hooks.totalNet) : null,
    total_gross_usd: hooks.h6.available ? r0(hooks.totalGross) : null,
    discount_usd: hooks.h6.available ? r0(hooks.h6.maskedUsd) : null,
    discount_pct: hooks.h6.available ? Math.round(hooks.h6.maskedPct) : null,
    pareto_people_for_80pct: hooks.h1.peopleFor80,
    top_vs_median_multiple: Math.round(hooks.h1.topVsMedian),
    premium_pct_of_spend: hooks.h3.available ? Math.round(hooks.h3.premiumPctOfSpend) : null,
    premium_people: hooks.h3.premiumPeople,
    deadweight_seats: hooks.h2.dormantSeats,
    deadweight_reclaim_usd_yr: r0(hooks.h2.reclaimUsdPerYear),
    near_dormant_users: hooks.h2.nearDormant.length,
    dollar_per_req_outliers: hooks.h5.outliers.length,
    premium_on_cheap_surface_users: hooks.h3.premiumOnCheapSurface.length,
    product_mix: productMix,
    domains_count: hooks.h7.byDomain.length,
  };
}
