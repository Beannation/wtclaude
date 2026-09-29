/**
 * Isomorphic HTML renderers for the spend audit. PURE string builders — no `document`,
 * no `window` — so the exact same output renders at build time (the static
 * /business/audit/sample page) and at runtime (innerHTML on upload).
 *
 * SECURITY: every dynamic value (emails, domains, product names from the user's CSV) is
 * HTML-escaped before interpolation, because the client injects these strings via innerHTML.
 *
 * HONESTY: every $ carries an "estimate" badge; seat-based $ is labeled overage-only; H8 is
 * labeled a proxy; every recommendation says "you confirm — WTClaude never changes anything."
 */
import type { Hooks } from './types';
// Explicit .ts extension so node --test can load this module as-is (Astro resolves it either way).
import { EMAIL_MAX } from '../lead-contract.ts';

// ---------------------------------------------------------------- format helpers
const esc = (s: unknown): string =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** Sign-aware: -30 → "-$30", never "$-30" (QA-0928-195). A value that rounds to zero prints unsigned. */
export const fmtUsd = (n: number, dp = 0): string => {
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return (n < 0 && Number(Math.abs(n).toFixed(dp)) > 0 ? '-$' : '$') + abs;
};
const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');
const fmtPct = (n: number): string => `${Math.round(n)}%`;
const fmtMult = (n: number): string => `${Math.round(n)}×`;
const fmtRatio = (n: number): string => `${Math.round(n)}:1`;

/** "Opus" · "Fable and Opus" · "Fable, Opus and Mythos" — the premium families in the export. */
function familiesLabel(fams: string[]): { label: string; verb: 'is' | 'are' } {
  const f = fams.length ? fams : ['Opus'];
  const label = f.length === 1 ? f[0] : `${f.slice(0, -1).join(', ')} and ${f[f.length - 1]}`;
  return { label, verb: f.length === 1 ? 'is' : 'are' };
}

/**
 * How the report names its premium-on-cheap-surfaces list: "Opus" only when every entry is Opus,
 * else "Premium models" (QA-0928-109). One helper, so the headline's preview CTA and the full
 * report's card never name the list differently.
 */
const cheapSurfaceLabel = (hooks: Hooks): 'Opus' | 'Premium models' =>
  hooks.h3.premiumOnCheapSurface.every((o) => o.family === 'Opus') ? 'Opus' : 'Premium models';

/**
 * What the blurred preview promises (RC check BUILD-018): only what the full report will show.
 * The $/request outliers and the premium-on-cheap list are named only when the report has them.
 */
function previewPromise(hooks: Hooks): string {
  const parts = ['All 8 checks', 'every person'];
  if (hooks.h5.available && hooks.h5.outliers.length) parts.push('the $/request outliers');
  if (hooks.h3.available && hooks.h3.premiumOnCheapSurface.length) {
    const label = cheapSurfaceLabel(hooks) === 'Opus' ? 'Opus' : 'premium-models';
    parts.push(`the ${label}-on-cheap-surfaces list`);
  }
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** Seat-price basis of the reclaim figure (QA-0928-199): the math uses the annual-billing price. */
const seatBasis = (hooks: Hooks): string =>
  `${fmtUsd(hooks.pricing.premiumAnnualUsd)}/seat/mo billed annually; ${fmtUsd(hooks.pricing.premiumMonthlyUsd)} billed monthly`;

/** "You entered 5 seats, but the export shows 13 people" (QA-0928-192) — said, not silently clamped. */
const seatsBelowPeopleLine = (hooks: Hooks): string =>
  `You entered <strong>${fmtInt(hooks.h2.seatCount ?? 0)}</strong> seat${hooks.h2.seatCount === 1 ? '' : 's'}, but the export shows <strong>${fmtInt(hooks.h2.activeUsers)}</strong> people — check the seat count; idle-seat reclaim needs at least as many seats as people.`;

// ---------------------------------------------------------------- shared bits
/** The privacy line — sits AT the email input, never a footer. We transmit only the
 * email + the monthly-rerun opt-in; no spend numbers ever leave the browser. */
export const PRIVACY_LINE =
  'No spend data ever leaves your browser — the audit runs entirely on your device. The only thing we receive is your email address (and, if you tick it, a monthly-reminder preference) — never your numbers, employee names, seats, or your spend file.';

type BadgeKind = 'estimate' | 'proxy' | 'overage' | 'recommend';
function badge(kind: BadgeKind): string {
  const map: Record<BadgeKind, [string, string]> = {
    estimate: ['estimate', 'bg-warm/10 text-warm border border-dashed border-warm/60'],
    proxy: ['proxy', 'bg-warm/15 text-warm border border-warm/40'],
    overage: ['overage-only', 'bg-warm/15 text-warm border border-warm/40'],
    recommend: ['you confirm', 'bg-amber-light text-amber-deep border border-amber/40'],
  };
  const [label, cls] = map[kind];
  return `<span class="inline-flex items-center rounded-full px-2 py-[2px] text-[10px] font-mono font-medium uppercase tracking-wide align-middle ${cls}">${label}</span>`;
}

function sectionCard(title: string, badgeHtml: string, body: string): string {
  return `<article class="rounded-2xl border border-ink/10 bg-card p-6 shadow-sm">
    <div class="flex flex-wrap items-center gap-2"><h3 class="font-head text-base">${esc(title)}</h3>${badgeHtml}</div>
    <div class="mt-3 text-sm leading-relaxed text-ink/75">${body}</div>
  </article>`;
}

/** The email-capture gate (Tier 2 unlock OR the demo door). Bound by delegation in app.ts. */
export function emailGate(opts: { tag: string; cta: string; heading: string; sub?: string }): string {
  return `<form class="audit-gate flex flex-col gap-3" data-audit-gate data-tag="${esc(opts.tag)}" novalidate>
    <div>
      <p class="font-head text-lg">${esc(opts.heading)}</p>
      ${opts.sub ? `<p class="mt-1 text-sm text-ink/70">${esc(opts.sub)}</p>` : ''}
    </div>
    <div class="flex flex-col gap-2 sm:flex-row">
      <input name="email" type="email" required maxlength="${EMAIL_MAX}" autocomplete="email" placeholder="you@company.com"
        class="min-w-0 flex-1 rounded-lg border border-ink/15 bg-card px-3.5 py-2.5 text-sm text-ink placeholder:text-warm focus-visible:outline-2 focus-visible:outline-amber aria-[invalid=true]:border-alert" />
      <div aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden">
        <label>Leave empty<input name="website" type="text" tabindex="-1" autocomplete="off" data-honeypot /></label>
      </div>
      <button type="submit" class="shrink-0 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-surface transition hover:bg-ink/85 disabled:opacity-60" data-submit>${esc(opts.cta)}</button>
    </div>
    <label class="flex items-start gap-2 text-xs leading-snug text-warm">
      <input type="checkbox" name="rerun" data-rerun class="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-ink/30 accent-amber" />
      <span>Email me a monthly re-run reminder (a fresh upload, same private flow).</span>
    </label>
    <p class="rounded-lg bg-ink/[0.03] px-3 py-2.5 text-xs leading-relaxed text-ink/70">${esc(PRIVACY_LINE)}</p>
    <p class="text-sm" role="status" aria-live="polite" data-status></p>
  </form>`;
}

// ---------------------------------------------------------------- wrong-file guard
export function renderWrongFile(detail: string): string {
  return `<div class="rounded-2xl border border-amber/40 bg-amber-light/60 p-6 shadow-sm">
    <p class="font-head text-lg text-amber-deep">That's the API billing export — not the per-person Spend Report</p>
    <p class="mt-2 text-sm leading-relaxed text-ink/75">${esc(detail)} We need the per-person Spend Report from <strong>claude.ai → Settings → Analytics → Export Spend Report</strong> (you must be an Owner / Primary-Owner; pick Last 90 Days).</p>
    <ol class="mt-4 space-y-1.5 text-sm text-ink/75">
      <li><span class="font-mono text-amber-deep">1.</span> Go to <strong>claude.ai</strong> → your initials → <strong>Settings</strong>.</li>
      <li><span class="font-mono text-amber-deep">2.</span> Open <strong>Analytics</strong> → <strong>Spend</strong> → <strong>Export Spend Report</strong>.</li>
      <li><span class="font-mono text-amber-deep">3.</span> Choose <strong>Last 90 Days</strong>, download, and drop that CSV here.</li>
    </ol>
    <button type="button" data-audit-reset class="mt-5 rounded-lg bg-ink px-4 py-2.5 text-sm font-semibold text-surface transition hover:bg-ink/85">Try a different file →</button>
  </div>`;
}

// ---------------------------------------------------------------- Tier 1 headline (ungated)
export function renderHeadline(hooks: Hooks): string {
  const { h1, h2, h3 } = hooks;
  // Seat-based plan with some overage: every $ here is overage only (QA-0928-110).
  const ovg = hooks.overageOnly;

  // Is there anything worth cutting? (auto-qualifier) — premium = Opus, Fable, Mythos (QA-0928-109)
  const wasteSignals =
    (h2.reclaimUsdPerYear || 0) > 0 ||
    h2.nearDormant.length > 0 ||
    (h3.premiumPctOfSpend >= 45 && h3.available) ||
    hooks.h5.outliers.length > 0;

  // ---- hero number ----
  let heroNum: string;
  let heroSub: string;
  if (h2.reclaimUsdPerYear != null && h2.reclaimUsdPerYear > 0) {
    heroNum = `~${fmtUsd(h2.reclaimUsdPerYear)}/yr`;
    heroSub = 'sitting in idle or over-tiered seats (if Premium, billed annually)';
  } else if (hooks.hasSpend) {
    heroNum = `${h1.peopleFor80} of ${h1.totalPeople}`;
    heroSub = ovg ? 'people drive 80% of your Claude overage spend' : 'people drive 80% of your Claude spend';
  } else {
    heroNum = `${fmtInt(hooks.totalRequests)}`;
    heroSub = 'requests across your team this window';
  }

  // ---- three reveals ----
  const deadweightBody =
    h2.reclaimUsdPerYear != null && h2.reclaimUsdPerYear > 0
      ? `<strong>${fmtUsd(h2.reclaimUsdPerYear)}/yr</strong> ${badge('estimate')} — ${h2.dormantSeats} seat${h2.dormantSeats === 1 ? '' : 's'} with ~0 usage${h2.nearDormant.length ? ` + ${h2.nearDormant.length} near-dormant` : ''}, if those seats are Premium (billed annually).`
      : h2.seatsBelowPeople
        ? `${seatsBelowPeopleLine(hooks)}${h2.nearDormant.length ? ` ${h2.nearDormant.length} near-dormant ${h2.nearDormant.length === 1 ? 'person' : 'people'} (≤20 requests).` : ''}`
      : h2.nearDormant.length
        ? `<strong>${h2.nearDormant.length}</strong> near-dormant ${h2.nearDormant.length === 1 ? 'person' : 'people'} (≤20 requests). Add your seat count to see idle-seat reclaim $.`
        : `No idle seats detected by usage. Add your seat count to check for seats paying with ~0 usage.`;

  const basisWord = h1.basis === 'spend' ? (ovg ? 'overage spend' : 'spend') : 'usage';
  const concentrationBody = h1.topVsMedian
    ? `<strong>${h1.peopleFor80} of your ${h1.totalPeople}</strong> people drive 80% of ${basisWord}; your top ${h1.basis === 'spend' ? 'spender' : 'user'} is <strong>${fmtMult(h1.topVsMedian)}</strong> the median.`
    : `<strong>${h1.peopleFor80} of your ${h1.totalPeople}</strong> people drive 80% of ${basisWord}.`;

  const fam = familiesLabel(h3.premiumFamilies);
  const modelBody = h3.available
    ? `${fam.label} ${fam.verb} <strong>${fmtPct(h3.premiumPctOfSpend)}</strong> of your ${ovg ? 'overage $' : 'bill'} — driven by <strong>${h3.premiumPeople}</strong> ${h3.premiumPeople === 1 ? 'person' : 'people'}.`
    : `Model-mix $ needs the spend columns — your export shows volume only (seat-based plan).`;

  const reveals = `<div class="mt-8 grid gap-4 sm:grid-cols-3">
    ${sectionCard('💰 Dead weight', badge('estimate'), deadweightBody)}
    ${sectionCard('😮 Concentration', ovg ? badge('overage') : '', concentrationBody)}
    ${sectionCard('🎯 Model mix', h3.available ? badge('estimate') + (ovg ? ' ' + badge('overage') : '') : '', modelBody)}
  </div>`;

  const overageLine = ovg
    ? `<p class="mt-6 rounded-xl border border-warm/40 bg-warm/10 px-4 py-3 text-sm text-ink/70">${badge('overage')} Seat-based plan: in-seat usage shows as $0 in this export, so these $ figures are overage only — not your bill.</p>`
    : '';

  const leanNote = !wasteSignals
    ? `<p class="mt-6 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-ink/75">✅ Your team looks already lean — nothing obvious to cut. The full breakdown is still below if you want the per-person detail.</p>`
    : '';

  // ---- blurred preview + gate ----
  const preview = `<div class="relative mt-8 overflow-hidden rounded-2xl border border-ink/10 bg-card shadow-sm">
      <div class="pointer-events-none select-none blur-[6px]" aria-hidden="true">${personTable(hooks, { limit: 5 })}</div>
      <div class="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-card/40 to-card/90 p-6 text-center">
        <p class="font-head text-lg">See the full per-person breakdown — free</p>
        <p class="max-w-md text-sm text-ink/70">${esc(previewPromise(hooks))} — unlocked on this page, computed in your browser.</p>
        <a href="#audit-gate" data-audit-scroll class="rounded-lg bg-amber px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-amber-deep hover:text-white">Unlock the full report →</a>
      </div>
    </div>`;

  return `<div class="audit-headline">
    <div class="rounded-2xl border border-ink/10 bg-ink p-8 text-center text-surface shadow-sm">
      <p class="text-xs font-semibold uppercase tracking-wide text-surface/60">Your Claude spend audit</p>
      <p class="mt-3 font-head text-4xl sm:text-5xl">${esc(heroNum)}</p>
      <p class="mt-2 text-sm text-surface/75">${esc(heroSub)}</p>
    </div>
    ${reveals}
    ${overageLine}
    ${leanNote}
    ${preview}
  </div>`;
}

// ---------------------------------------------------------------- per-person table
function flagPill(label: string): string {
  return `<span class="inline-block rounded-full bg-ink/[0.05] px-2 py-[1px] text-[10px] font-medium text-ink/60">${esc(label)}</span>`;
}

function modelMixBar(p: Hooks['people'][number]): string {
  const fams: [string, string][] = [
    ['Opus', 'bg-amber'],
    ['Sonnet', 'bg-amber-deep'],
    ['Haiku', 'bg-warm'],
    ['Fable', 'bg-ink'],
    ['Mythos', 'bg-ink/50'],
    ['Other', 'bg-ink/20'],
  ];
  const named = new Set(fams.map(([f]) => f));
  const other = Object.entries(p.byFamily).reduce((s, [f, v]) => s + (named.has(f) ? 0 : v), 0);
  const total = Object.values(p.byFamily).reduce((s, v) => s + v, 0) || p.requests || 1;
  const segs = fams
    .map(([fam, cls]) => {
      const v = fam === 'Other' ? other : p.byFamily[fam] || 0;
      const pct = total > 0 ? (v / total) * 100 : 0;
      return pct > 0 ? `<span class="${cls}" style="width:${pct.toFixed(1)}%" title="${fam} ${fmtPct(pct)}"></span>` : '';
    })
    .join('');
  return `<span class="inline-flex h-2 w-20 overflow-hidden rounded-full bg-ink/[0.06] align-middle">${segs}</span>`;
}

export function personTable(hooks: Hooks, opts: { limit?: number } = {}): string {
  const rows = opts.limit ? hooks.people.slice(0, opts.limit) : hooks.people;
  const spendCol = hooks.hasSpend;
  const ovg = hooks.overageOnly;
  const body = rows
    .map((p) => {
      const flags = p.flags.length
        ? `<div class="mt-1 flex flex-wrap gap-1">${p.flags.map((f) => flagPill(f.label)).join('')}</div>`
        : '';
      return `<tr class="border-t border-ink/[0.06]">
        <td class="px-3 py-2.5 align-top">
          <div class="font-medium text-ink">${esc(p.email)}</div>${flags}
        </td>
        <td class="px-3 py-2.5 text-right align-top tabular-nums">${spendCol ? fmtUsd(p.net) : '—'}</td>
        <td class="px-3 py-2.5 align-top">${modelMixBar(p)}</td>
        <td class="px-3 py-2.5 text-right align-top tabular-nums">${fmtInt(p.requests)}</td>
        <td class="px-3 py-2.5 text-right align-top tabular-nums">${p.dollarPerReq != null ? fmtUsd(p.dollarPerReq, 2) : '—'}</td>
        <td class="px-3 py-2.5 text-right align-top tabular-nums">${p.contextRatio != null ? fmtRatio(p.contextRatio) : '—'}</td>
      </tr>`;
    })
    .join('');
  return `<table class="w-full border-collapse text-sm">
    <thead><tr class="text-left text-[11px] uppercase tracking-wide text-warm">
      <th class="px-3 py-2 font-medium">Person</th>
      <th class="px-3 py-2 text-right font-medium">${ovg ? 'Overage $' : 'Net spend'}</th>
      <th class="px-3 py-2 font-medium">Model mix</th>
      <th class="px-3 py-2 text-right font-medium">Requests</th>
      <th class="px-3 py-2 text-right font-medium">${ovg ? 'Overage $/req' : '$/req'}</th>
      <th class="px-3 py-2 text-right font-medium">Ctx</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

// ---------------------------------------------------------------- Tier 2 full report
export function renderFullReport(
  hooks: Hooks,
  opts: { sample: boolean; org?: string } = { sample: false },
): string {
  const { h1, h2, h3, h4, h5, h6, h7, h8 } = hooks;
  // Seat-based plan with some overage: $ figures are overage only (QA-0928-110).
  const ovg = hooks.overageOnly;
  const overage = !hooks.hasSpend || ovg;
  /** badge row for a $ card — the overage label rides along on seat-based exports */
  const moneyBadge = badge('estimate') + (ovg ? ' ' + badge('overage') : '');

  const sampleBanner = opts.sample
    ? `<div class="sticky top-14 z-20 -mx-1 mb-6 rounded-xl border border-amber/50 bg-amber-light px-4 py-3 text-center text-sm font-semibold text-amber-deep shadow-sm">📊 SAMPLE REPORT — demo data for a fictional company${opts.org ? ` (${esc(opts.org)})` : ''}, not your team.</div>`
    : '';

  const watermark = opts.sample
    ? `<div class="pointer-events-none absolute inset-0 z-10 overflow-hidden opacity-[0.07]" aria-hidden="true">${Array.from(
        { length: 8 },
        () =>
          `<div class="whitespace-nowrap font-head text-3xl tracking-widest text-ink" style="transform:rotate(-18deg)">SAMPLE · SAMPLE · SAMPLE · SAMPLE · SAMPLE · SAMPLE · SAMPLE · SAMPLE</div>`,
      ).join('')}</div>`
    : '';

  // ---- H2 dead weight
  const h2Body = (() => {
    if (h2.reclaimUsdPerYear != null && h2.reclaimUsdPerYear > 0) {
      return `<p><strong>${h2.dormantSeats}</strong> of your <strong>${h2.seatCount}</strong> seats show ~0 usage in the window${h2.nearDormant.length ? `, and ${h2.nearDormant.length} ${h2.nearDormant.length === 1 ? 'person is' : 'people are'} near-dormant (≤20 requests)` : ''} — up to <strong>${fmtUsd(h2.reclaimUsdPerYear)}/yr</strong> reclaimable if those are Premium seats (${seatBasis(hooks)}).</p>
        <p class="mt-2 text-xs text-ink/55">${esc(hooks.pricing.note)} ${badge('recommend')} — review and right-size in Org → Seats; WTClaude never changes anything.</p>`;
    }
    if (h2.seatsBelowPeople) {
      return `<p>${seatsBelowPeopleLine(hooks)}</p>${h2.nearDormant.length ? `<p class="mt-2"><strong>${h2.nearDormant.length}</strong> ${h2.nearDormant.length === 1 ? 'person is' : 'people are'} near-dormant (≤20 requests this window).</p>` : ''}`;
    }
    if (h2.nearDormant.length) {
      return `<p><strong>${h2.nearDormant.length}</strong> ${h2.nearDormant.length === 1 ? 'person is' : 'people are'} near-dormant (≤20 requests this window). Add a seat count above to see reclaimable $ for fully-idle seats.</p>`;
    }
    return `<p>No idle/near-dormant seats detected by usage volume. Add a seat count above to check for seats paying with ~0 usage.</p>`;
  })();

  // ---- H3 model mix
  const fam = familiesLabel(h3.premiumFamilies);
  const cheapLabel = cheapSurfaceLabel(hooks);
  const h3Body = h3.available
    ? `<p>${fam.label} ${fam.verb} <strong>${fmtUsd(h3.premiumUsd)}</strong> = <strong>${fmtPct(h3.premiumPctOfSpend)}</strong> of ${ovg ? 'overage spend' : 'spend'}, driven by <strong>${h3.premiumPeople}</strong> ${h3.premiumPeople === 1 ? 'person' : 'people'}: ${h3.topPremiumUsers.slice(0, 3).map((u) => `${esc(u.email.split('@')[0])} ${fmtUsd(u.usd)}`).join(', ')}.</p>
      ${h3.premiumOnCheapSurface.length ? `<p class="mt-2">⚠️ ${cheapLabel} on cheap surfaces: ${h3.premiumOnCheapSurface.map((o) => `<strong>${esc(o.email.split('@')[0])}</strong> runs ${fmtUsd(o.usd)} of ${esc(o.family)} inside ${esc(o.product)}`).join('; ')} — cheap-task overspend; coach toward Sonnet/Haiku. ${badge('recommend')}</p>` : ''}`
    : `<p>Per-person model $ needs the spend columns — your export shows usage volume only (seat-based plan).</p>`;

  // ---- H4 hidden surfaces
  const h4Body = h4.available
    ? `<ul class="space-y-1">${h4.byProduct
        .map(
          (x) =>
            `<li class="flex items-center justify-between gap-3"><span>${esc(x.product)}</span><span class="tabular-nums text-ink/60">${fmtUsd(x.usd)} · ${fmtPct(x.pct)}</span></li>`,
        )
        .join('')}</ul>`
    : `<p>Product $ needs the spend columns — showing usage only.</p>`;

  // ---- H5 outliers
  const perReqWord = ovg ? 'per overage request' : '/request';
  const h5Body = h5.available
    ? h5.outliers.length
      ? `<p>Team average is <strong>${fmtUsd(h5.teamAvgPerReq, 2)}</strong>${ovg ? ' ' : ''}${perReqWord}. Outliers:</p>
         <ul class="mt-2 space-y-1">${h5.outliers
           .map(
             (o) =>
               `<li><strong>${esc(o.email.split('@')[0])}</strong> averages <strong>${fmtUsd(o.perReq, 2)}</strong>${ovg ? ' ' : ''}${perReqWord} — <strong>${fmtMult(o.multiple)}</strong> the team average — likely runaway agents or huge context.</li>`,
           )
           .join('')}</ul>`
      : `<p>No $/request outliers — your team average is ${fmtUsd(h5.teamAvgPerReq, 2)}${ovg ? ' ' : ''}${perReqWord} and everyone's close to it.</p>`
    : `<p>$/request needs spend + request columns.</p>`;

  // ---- H6 discount exposure
  const h6Body = h6.available
    ? h6.maskedUsd > 0.005
      ? `<p>You're at <strong>${fmtUsd(h6.net)}</strong> net vs <strong>${fmtUsd(h6.gross)}</strong> list — <strong>${fmtUsd(h6.maskedUsd)}</strong> (${fmtPct(h6.maskedPct)}) masked by credits/discounts. That's your renewal exposure if the discount lapses.</p>`
      : `<p>No discount detected — net spend (<strong>${fmtUsd(h6.net)}</strong>) is at or above list (<strong>${fmtUsd(h6.gross)}</strong>).</p>`
    : `<p>Discount exposure needs both net and gross spend columns.</p>`;

  // ---- H7 domain allocation
  const h7Body = h7.available
    ? `<ul class="space-y-1">${h7.byDomain
        .map(
          (d) =>
            `<li class="flex items-center justify-between gap-3"><span>${esc(d.domain)} <span class="text-ink/50">(${d.people})</span></span><span class="tabular-nums text-ink/60">${hooks.hasSpend ? fmtUsd(d.usd) : '—'}</span></li>`,
        )
        .join('')}</ul>
       <p class="mt-2 text-xs text-ink/55">Employees vs contractors / cost-centers in one click. Full chargeback &amp; cost-center mapping is the paid tier.</p>`
    : `<p>Only one email domain found — nothing to allocate.</p>`;

  // ---- H8 context proxy
  const h8Body = h8.available
    ? `<p>Highest prompt:completion ratios (a coarse context-bloat lead):</p>
       <ul class="mt-2 space-y-1">${h8.topRatios
         .slice(0, 3)
         .map((r) => `<li><strong>${esc(r.email.split('@')[0])}</strong> — ${fmtRatio(r.ratio)}</li>`)
         .join('')}</ul>
       <p class="mt-2 text-xs text-ink/55">This is a <strong>proxy</strong> — the CSV doesn't contain true cache-read waste. To validate it, run <code class="font-mono text-ink/70">wtclaude waste</code> in the CLI for the full breakdown.</p>`
    : `<p>Context ratio needs prompt + completion token columns.</p>`;

  const hooksGrid = `<div class="mt-6 grid gap-4 md:grid-cols-2">
    ${sectionCard('Power-user concentration', ovg ? badge('overage') : '', `<p><strong>${h1.peopleFor80} of ${h1.totalPeople}</strong> people drive 80% of ${h1.basis === 'spend' ? (ovg ? 'overage spend' : 'spend') : 'usage'}${h1.topVsMedian ? `; top ${h1.basis === 'spend' ? 'spender' : 'user'} is <strong>${fmtMult(h1.topVsMedian)}</strong> the median` : ''}. Where governance should focus.</p>`)}
    ${sectionCard('Dead-weight seats', badge('estimate'), h2Body)}
    ${sectionCard('Per-person model mix', h3.available ? moneyBadge : '', h3Body)}
    ${sectionCard('Hidden metered surfaces', h4.available ? moneyBadge : '', h4Body)}
    ${sectionCard('$/request outliers', h5.available ? moneyBadge : '', h5Body)}
    ${sectionCard('Discount / list exposure', h6.available ? moneyBadge : '', h6Body)}
    ${sectionCard('Allocation by domain', '', h7Body)}
    ${sectionCard('Context-ratio proxy', badge('proxy'), h8Body)}
  </div>`;

  const tableSection = `<section class="relative mt-6 overflow-hidden rounded-2xl border border-ink/10 bg-card p-1 shadow-sm">
    ${watermark}
    <div class="relative z-0 overflow-x-auto">${personTable(hooks)}</div>
  </section>`;

  const overageNote = ovg
    ? `<p class="mt-4 rounded-xl border border-warm/40 bg-warm/10 px-4 py-3 text-sm text-ink/70">${fmtPct(hooks.totalRequests > 0 ? (hooks.inSeatRequests / hooks.totalRequests) * 100 : 0)} of the requests in your export are in-seat usage at $0 ${badge('overage')} — on seat-based plans that usage is the flat seat fee, not dollarized. Every $ figure below is overage only, not your bill, and $/request divides overage $ by overage requests.</p>`
    : overage
    ? `<p class="mt-4 rounded-xl border border-warm/40 bg-warm/10 px-4 py-3 text-sm text-ink/70">Your export shows usage volume but little/no overage $ ${badge('overage')} — on seat-based plans, within-allotment usage is the flat seat fee, not dollarized. We're leaning on request/token volume.</p>`
    : '';

  // ---- conversion bridge (binding §7) — overage/volatility, not just savings.
  // Only real $/request outliers are "volatile" — near-dormant people are not (QA-0928-114).
  const volatile = h5.outliers.map((o) => o.email.split('@')[0]);
  const others = volatile.length - 1;
  const bridge = `<section class="mt-8 rounded-2xl border border-amber/40 bg-amber-light/50 p-6 text-center shadow-sm">
    <p class="font-head text-lg text-amber-deep">This is a snapshot. Spend doesn't hold still.</p>
    <p class="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink/75">${
      volatile.length === 0
        ? 'Your spend can spike between invoices.'
        : others === 0
          ? `${esc(volatile[0])} shows volatile, spiky spend.`
          : `${esc(volatile[0])} and ${others} other${others === 1 ? '' : 's'} show volatile, spiky spend.`
    } Want an alert <em>before</em> the next spike hits — not at invoice time?</p>
    <a href="/business/" data-track="audit_bridge_watchdog" class="mt-4 inline-flex rounded-lg bg-ink px-5 py-2.5 text-sm font-semibold text-surface transition hover:bg-ink/85">Get the continuous watchdog →</a>
    <p class="mt-3 text-xs text-ink/55">Continuous monitoring, trends, delivered coaching and full chargeback are the paid product — this free audit stays a snapshot.</p>
  </section>`;

  // Action rows are screen-only (data-no-print): Download PDF prints the report, not its buttons.
  const downloadBar = `<div class="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-ink/10 bg-card p-4 shadow-sm" data-no-print>
    <p class="text-sm text-ink/70">Keep or forward this report — generated in your browser, never uploaded.</p>
    <div class="flex gap-2">
      <button type="button" data-audit-download="csv" class="rounded-lg border border-ink/15 bg-card px-4 py-2 text-sm font-semibold text-ink transition hover:bg-ink/[0.04]">Download CSV</button>
      <button type="button" data-audit-download="pdf" class="rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-surface transition hover:bg-ink/85">Download PDF</button>
    </div>
  </div>`;

  // ---- shareable-result card (smb-audit-landing-seo-and-share-card.md Part 2, Variant A —
  // generic, figure-free, identifier-free: no numbers, no company/employee identifiers).
  const shareSection = `<section class="mt-6 rounded-2xl border border-ink/10 bg-card p-6 text-center shadow-sm" data-no-print>
    <p class="font-head text-base">Nice — that's your audit.</p>
    <p class="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink/70">Want to save others the guesswork? Share a quick card (no numbers, nothing about your team) and point a peer at their own free audit.</p>
    <div class="mt-4 flex flex-wrap items-center justify-center gap-2">
      <button type="button" data-audit-share class="rounded-lg bg-amber px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-amber-deep hover:text-white">Share this audit →</button>
      <button type="button" data-audit-share-download class="rounded-lg border border-ink/15 bg-card px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-ink/[0.04]">Download card</button>
    </div>
    <p class="mt-3 text-xs text-ink/55" data-share-status role="status" aria-live="polite"></p>
  </section>`;

  const honesty = `<p class="mt-6 text-center text-xs leading-relaxed text-ink/55">
    Every figure is a labeled estimate — your spend report should closely match your invoice. ${overage ? 'On seat-based plans the $ is overage-only. ' : ''}All outputs are recommendations you confirm — WTClaude never changes anything, and your spend file never left this browser.
  </p>`;

  // ---- one-click path to the fuller product (E)
  const learnMore = `<p class="mt-4 text-center text-sm"><a href="/business/" data-track="audit_learn_more_business" class="font-semibold text-amber-deep hover:text-amber">Learn more about WTClaude for Business →</a></p>`;

  return `<div class="audit-report relative">
    ${sampleBanner}
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="font-head text-2xl">Full per-person breakdown</h2>
        <p class="mt-1 text-sm text-ink/60">${hooks.people.length} people${hooks.seatCount ? ` · ${hooks.seatCount} seats` : ''}${hooks.hasSpend ? ` · ${fmtUsd(hooks.totalNet)} ${ovg ? 'overage' : 'net'}` : ` · ${fmtInt(hooks.totalRequests)} requests`} · all 8 checks</p>
      </div>
    </div>
    ${overageNote}
    ${hooksGrid}
    ${tableSection}
    ${downloadBar}
    ${shareSection}
    ${bridge}
    ${honesty}
    ${learnMore}
    ${
      opts.sample
        ? `<section class="mt-8 rounded-2xl border border-ink/10 bg-ink p-6 text-center text-surface">
            <p class="font-head text-lg">This is what you'll see for your own team.</p>
            <p class="mx-auto mt-2 max-w-md text-sm text-surface/75">Get your CSV: claude.ai → Settings → Analytics → Export Spend Report (Owner / Primary-Owner, Last 90 Days).</p>
            <button type="button" data-audit-reset class="mt-4 rounded-lg bg-amber px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-amber-deep hover:text-white">Run my real audit →</button>
          </section>`
        : `<div class="mt-8 text-center" data-no-print><button type="button" data-audit-reset class="text-sm font-semibold text-amber-deep hover:text-amber">↺ Start over with a different file</button></div>`
    }
  </div>`;
}

/** Build the downloadable CSV string (client-side, offline). */
export function buildReportCsv(hooks: Hooks, opts: { sample: boolean }): string {
  const lines: string[] = [];
  const q = (s: unknown) => {
    const v = String(s);
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  lines.push(`# Claude Spend Audit${opts.sample ? ' — SAMPLE (demo data, not real)' : ''}`);
  lines.push(`# All figures are labeled estimates; recommendations you confirm.`);
  lines.push('');
  lines.push(
    [
      'email',
      'net_spend_usd',
      'gross_spend_usd',
      'requests',
      'dollar_per_request',
      'opus_share_pct', // Opus only, as in 0.3.1 — kept so parsers of the download don't break
      'prompt_completion_ratio',
      'flags',
      'premium_share_pct', // Opus + Fable + Mythos (QA-0928-109) — appended, never reordered
    ]
      .map(q)
      .join(','),
  );
  for (const p of hooks.people) {
    lines.push(
      [
        p.email,
        p.net.toFixed(2),
        p.gross.toFixed(2),
        p.requests,
        p.dollarPerReq != null ? p.dollarPerReq.toFixed(4) : '',
        Math.round((p.net > 0 ? (p.byFamily['Opus'] || 0) / p.net : 0) * 100),
        p.contextRatio != null ? p.contextRatio.toFixed(2) : '',
        p.flags.map((f) => f.label).join(' | '),
        Math.round(p.premiumShare * 100),
      ]
        .map(q)
        .join(','),
    );
  }
  lines.push('');
  lines.push('# Aggregates');
  lines.push(`# people,${hooks.people.length}`);
  lines.push(`# total_net_usd,${hooks.totalNet.toFixed(2)}`);
  lines.push(`# total_gross_usd,${hooks.totalGross.toFixed(2)}`);
  if (hooks.h6.available) lines.push(`# masked_by_discount_usd,${hooks.h6.maskedUsd.toFixed(2)}`);
  if (hooks.h2.reclaimUsdPerYear != null)
    lines.push(`# deadweight_reclaim_usd_per_year,${hooks.h2.reclaimUsdPerYear.toFixed(2)}`);
  return lines.join('\n');
}
