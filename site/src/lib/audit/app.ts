/**
 * Spend-audit client controller. Wires the dropzone / paste / sample / demo doors to the
 * pure parse→compute→render pipeline, and handles the email gate + lead POST (email + opt-in only)
 * + offline CSV/PDF download.
 *
 * PRIVACY (Option A, locked): the raw CSV and every per-person row live ONLY in this closure
 * (`state.rows`). They are never assigned to window, never serialized into the lead payload,
 * never sent anywhere. The single network call is the lead POST, whose body is the email +
 * opt-in flags only — no totals, counts, names, per-person rows, or the file ever leave the
 * browser. Parsing the file fires NO network request.
 */
import { CAPTURE_ENDPOINT, CAPTURE_METHOD } from '../../config';
import { auditLeadBody, EMAIL_RE, type LeadBody } from '../lead-contract';
import { parseSpendReport } from './parse';
import { computeHooks, parseSeatCount } from './hooks';
import {
  buildReportCsv,
  emailGate,
  renderFullReport,
  renderHeadline,
  renderWrongFile,
} from './render';
import { SAMPLE_CSV, SAMPLE_ORG, SAMPLE_SEAT_COUNT } from './sampleData';
import type { ColumnAvailability, Hooks, SpendRow } from './types';

type Mode = 'real' | 'sample';
type View = 'headline' | 'report' | 'wrong' | 'error' | 'demo-gate';

interface State {
  rows: SpendRow[] | null; // CLIENT-ONLY — never leaves this closure
  columns: ColumnAvailability | null;
  hooks: Hooks | null;
  mode: Mode;
  view: View;
}

const state: State = { rows: null, columns: null, hooks: null, mode: 'real', view: 'headline' };

/** The last lead POST's outcome, so a re-render (seat change) keeps a failure notice visible. */
let lastLead: { body: LeadBody; failed: boolean } | null = null;

/** Campaign attribution (B) — read once per page load, threaded onto every tracked event so
 * campaign sources stay attributable without touching the lead payload's strict key surface. */
function utmContent(): string | null {
  try {
    return new URLSearchParams(window.location.search).get('utm_content');
  } catch {
    return null;
  }
}

function track(event: string, data?: Record<string, unknown>): void {
  try {
    const utm = utmContent();
    (window as any).umami?.track(event, utm ? { ...data, utm_content: utm } : data);
  } catch {
    /* analytics must never block the audit */
  }
}

function el<T extends HTMLElement>(sel: string): T | null {
  return document.querySelector<T>(sel);
}

/** The seat-count field, validated (QA-0928-192): bad values are explained under the field, not used. */
function seatCountInput(): number | null {
  const { seats, error } = parseSeatCount(el<HTMLInputElement>('#audit-seats')?.value || '');
  const input = el<HTMLInputElement>('#audit-seats');
  const msg = el<HTMLElement>('[data-seats-msg]');
  if (input) {
    if (error) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }
  if (msg) msg.textContent = error || '';
  return seats;
}

function results(): HTMLElement | null {
  return el<HTMLElement>('#audit-results');
}

function setResults(html: string, { scroll = true } = {}): void {
  const r = results();
  if (!r) return;
  r.innerHTML = html;
  r.classList.remove('hidden');
  if (scroll) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------- views
/**
 * A seat-count change is waiting to be drawn (see bindSeatRefresh). Every render draws from the
 * current state.hooks, so any render satisfies it.
 */
let seatRefreshPending = false;

/**
 * Draw a held seat-count change now. download() calls this first: the redraw waits for the press
 * to produce its click, and when that click is Download PDF, window.print() would otherwise print
 * the page as it was before the new seat count (RC check BUILD-018).
 */
function flushSeatRefresh(): void {
  if (!seatRefreshPending || !state.hooks) return;
  if (state.view === 'headline') renderHeadlineView({ refresh: true });
  else if (state.view === 'report') renderReportView({ scroll: false });
  seatRefreshPending = false;
}

/**
 * `refresh` (a seat-count change): swap only the headline. The gate below keeps its node, so a
 * typed email, the reminder tick and focus survive, and nothing scrolls (RC check BUILD-018 —
 * rebuilding the gate under the pointer lost the Unlock click and wiped the email).
 */
function renderHeadlineView({ refresh = false } = {}): void {
  if (!state.hooks) return;
  seatRefreshPending = false;
  const headline = refresh ? results()?.querySelector<HTMLElement>('.audit-headline') : null;
  if (headline && results()?.querySelector('#audit-gate')) {
    headline.outerHTML = renderHeadline(state.hooks);
    return;
  }
  const gate = `<div id="audit-gate" class="mx-auto mt-10 max-w-xl rounded-2xl border border-ink/10 bg-card p-6 shadow-sm">
    ${emailGate({
      tag: 'spend_audit',
      cta: 'Unlock the full report',
      heading: 'See the full per-person breakdown — free',
      sub: 'Enter a work email to reveal all 8 checks and the per-person table — already computed, right here in your browser.',
    })}
  </div>`;
  setResults(renderHeadline(state.hooks) + gate);
  state.view = 'headline';
  track('audit_headline_view');
}

function renderReportView({ scroll = true } = {}): void {
  if (!state.hooks) return;
  seatRefreshPending = false;
  setResults(
    renderFullReport(state.hooks, { sample: state.mode === 'sample', org: SAMPLE_ORG }),
    { scroll },
  );
  state.view = 'report';
  if (lastLead?.failed) showLeadStatus('failed');
}

// ---------------------------------------------------------------- ingest
function ingest(text: string, mode: Mode): void {
  const parsed = parseSpendReport(text);
  if (parsed.kind === 'wrong-file') {
    state.rows = null;
    state.hooks = null;
    state.view = 'wrong';
    setResults(renderWrongFile(parsed.detail));
    track('audit_wrong_file');
    return;
  }
  if (parsed.kind === 'empty' || parsed.kind === 'error') {
    state.rows = null;
    state.hooks = null;
    state.view = 'error';
    setResults(
      `<div class="rounded-2xl border border-alert/40 bg-alert/[0.06] p-6 text-sm text-ink/75">
        <p class="font-head text-base text-alert">We couldn't read that as a Spend Report</p>
        <p class="mt-2">${parsed.detail.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>
        <button type="button" data-audit-reset class="mt-4 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-surface hover:bg-ink/85">Try another file →</button>
      </div>`,
    );
    return;
  }

  // ok
  state.mode = mode;
  state.rows = parsed.rows;
  state.columns = parsed.columns;
  recompute();
  renderHeadlineView();
}

/** Rebuild hooks from the in-memory rows + the current seat-count input. */
function recompute(): void {
  if (!state.rows || !state.columns) return;
  const seatCount = state.mode === 'sample' ? SAMPLE_SEAT_COUNT : seatCountInput();
  state.hooks = computeHooks(state.rows, state.columns, { seatCount });
}

function loadSample(mode: Mode): void {
  state.mode = mode;
  ingest(SAMPLE_CSV, mode);
}

function reset(): void {
  state.rows = null;
  state.columns = null;
  state.hooks = null;
  state.mode = 'real';
  state.view = 'headline';
  lastLead = null;
  const r = results();
  if (r) {
    r.innerHTML = '';
    r.classList.add('hidden');
  }
  const file = el<HTMLInputElement>('#audit-file');
  if (file) file.value = '';
  const paste = el<HTMLTextAreaElement>('#audit-paste');
  if (paste) paste.value = '';
  el<HTMLElement>('#audit-intake')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------- email gate + lead
async function handleGateSubmit(form: HTMLFormElement): Promise<void> {
  const tag = form.dataset.tag || 'spend_audit';
  const input = form.querySelector<HTMLInputElement>('input[name="email"]');
  const status = form.querySelector<HTMLElement>('[data-status]');
  const honeypot = form.querySelector<HTMLInputElement>('[data-honeypot]');
  const rerun = form.querySelector<HTMLInputElement>('[data-rerun]')?.checked === true;
  const email = (input?.value || '').trim();

  if (!email || !EMAIL_RE.test(email)) {
    input?.setAttribute('aria-invalid', 'true');
    if (status) {
      status.textContent = 'Please enter a valid email address.';
      status.className = 'text-sm text-alert';
    }
    input?.focus();
    return;
  }

  // The demo door computes the sample fresh; the Tier-2 unlock reveals what's already computed.
  if (tag === 'spend_audit_demo') {
    loadSample('sample');
  }
  if (!state.hooks) return;

  // Reveal the full report (client-side — it was always computed; the gate just unlocks it).
  renderReportView();
  track(tag === 'spend_audit_demo' ? 'audit_demo_unlock' : 'audit_unlock');

  // Fire the lead (email + opt-in only) in the background (never blocks the reveal).
  // The honeypot value really rides along so the endpoint's bot check works (QA-0928-194).
  void postLead(
    auditLeadBody({
      email,
      tag,
      source: window.location.pathname,
      honeypot: honeypot?.value || '',
      rerun,
    }),
  );
}

async function postLead(payload: LeadBody): Promise<void> {
  if (!state.hooks) return;

  // Log the exact body locally so anyone can verify what leaves the browser: ONLY
  // email + tag + source + the monthly-rerun flag. We deliberately send NO spend
  // numbers/aggregates — no names, no per-person rows, no file. (Honesty posture:
  // the audit's figures never leave the device; only the email + reminder pref do.)
  // eslint-disable-next-line no-console
  console.info('[audit lead] payload (email + prefs only) →', payload);

  if (!CAPTURE_ENDPOINT) return; // local dev / no endpoint: nothing stored, already logged
  lastLead = { body: payload, failed: false };
  let ok = false;
  try {
    const res = await fetch(CAPTURE_ENDPOINT, {
      method: CAPTURE_METHOD,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    ok = res.ok;
  } catch {
    ok = false;
  }
  // QA-0928-30: a rejected lead used to look like success. The report stays on screen either
  // way; a failure gets a small, non-blocking notice with a retry.
  lastLead.failed = !ok;
  showLeadStatus(ok ? 'saved' : 'failed');
}

/** Non-blocking lead notice at the top of the report ('saved' clears a previous failure). */
function showLeadStatus(kind: 'failed' | 'saved' | 'saving'): void {
  const report = el<HTMLElement>('#audit-results .audit-report');
  let note = report?.querySelector<HTMLElement>('[data-lead-status]') || null;
  if (kind === 'saved') {
    if (note) {
      note.className = 'mb-4 rounded-xl border border-success/30 bg-success/10 px-4 py-3 text-sm text-ink/75';
      note.textContent = 'Saved — thanks.';
    }
    return;
  }
  if (!report) return;
  if (!note) {
    note = document.createElement('p');
    note.setAttribute('data-lead-status', '');
    note.setAttribute('role', 'status');
    note.setAttribute('aria-live', 'polite');
    report.prepend(note);
  }
  note.className = 'mb-4 rounded-xl border border-alert/40 bg-alert/[0.06] px-4 py-3 text-sm text-ink/75';
  note.innerHTML =
    kind === 'saving'
      ? 'Saving your email…'
      : 'We couldn’t save your email — <button type="button" data-lead-retry class="font-semibold text-amber-deep underline hover:text-amber">try again</button>. Your report is unaffected.';
}

// ---------------------------------------------------------------- download (offline)
function download(kind: 'csv' | 'pdf'): void {
  if (!state.hooks) return;
  flushSeatRefresh(); // the PDF prints the page, so the page must show the seat count the CSV uses
  const sample = state.mode === 'sample';
  const stamp = new Date().toISOString().slice(0, 10);
  const base = sample ? 'SAMPLE-claude-spend-audit' : `claude-spend-audit-${stamp}`;

  if (kind === 'csv') {
    const csv = buildReportCsv(state.hooks, { sample });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    track('audit_download_csv');
    return;
  }

  // PDF via the browser's print-to-PDF — fully offline, no library. The print stylesheet
  // (on the page) hides everything except #audit-results.
  const prevTitle = document.title;
  document.title = base; // most browsers default the PDF filename to the document title
  document.body.classList.add('audit-printing');
  const restore = () => {
    document.body.classList.remove('audit-printing');
    document.title = prevTitle;
    window.removeEventListener('afterprint', restore);
  };
  window.addEventListener('afterprint', restore);
  track('audit_download_pdf');
  window.print();
  // Safety net for browsers that don't fire afterprint.
  setTimeout(restore, 1500);
}

// ---------------------------------------------------------------- share card (Variant A —
// generic, figure-free, identifier-free; smb-audit-landing-seo-and-share-card.md Part 2)
const SHARE_URL = 'https://wtclaude.com/business/audit/?utm_source=share&utm_medium=social&utm_campaign=smb_audit';
const SHARE_TITLE = 'I ran the free Claude Team spend audit';
const SHARE_TEXT =
  '8 checks on your Anthropic Spend Report — over-tiered seats, model-mix waste, and more. Free, in your browser, nothing uploaded.';

async function shareAudit(statusEl: HTMLElement | null): Promise<void> {
  track('audit_share_click');
  const nav = navigator as Navigator & {
    share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
  };
  if (nav.share) {
    try {
      await nav.share({ title: SHARE_TITLE, text: SHARE_TEXT, url: SHARE_URL });
      return;
    } catch {
      // user cancelled, or the platform declined — fall through to copy-link
    }
  }
  try {
    await navigator.clipboard.writeText(SHARE_URL);
    if (statusEl) statusEl.textContent = 'Link copied — share it anywhere.';
  } catch {
    if (statusEl) statusEl.textContent = SHARE_URL;
  }
}

function downloadShareCard(): void {
  track('audit_share_download');
  const a = document.createElement('a');
  a.href = '/assets/audit-share-card.png';
  a.download = 'wtclaude-spend-audit-share-card.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Wires the share-card buttons rendered inside renderFullReport() — shared by the live
 * report (bindOnce) and the static /business/audit/sample page (initSampleStatic). */
function bindShareOnce(scope: Document): void {
  scope.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('[data-audit-share]')) {
      void shareAudit(t.closest<HTMLElement>('section')?.querySelector('[data-share-status]') || null);
      return;
    }
    if (t.closest('[data-audit-share-download]')) {
      downloadShareCard();
    }
  });
}

// ---------------------------------------------------------------- wiring
function bindOnce(): void {
  if ((window as any).__auditBound) return;
  (window as any).__auditBound = true;

  // ---- dropzone ----
  const dz = el<HTMLElement>('#audit-dropzone');
  const fileInput = el<HTMLInputElement>('#audit-file');

  if (dz) {
    ['dragenter', 'dragover'].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.add('ring-2', 'ring-amber');
      }),
    );
    ['dragleave', 'drop'].forEach((ev) =>
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        dz.classList.remove('ring-2', 'ring-amber');
      }),
    );
    dz.addEventListener('drop', (e) => {
      const file = (e as DragEvent).dataTransfer?.files?.[0];
      if (file) readFile(file);
    });
    dz.addEventListener('click', (e) => {
      // let inner controls (paste toggle etc.) work; only the zone background opens the picker
      if ((e.target as HTMLElement).closest('[data-no-pick]')) return;
      fileInput?.click();
    });
    // role="button" + tabindex="0" promise keyboard activation (QA-0928-115).
    dz.addEventListener('keydown', (e) => {
      if (e.target !== dz || (e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault(); // Space would otherwise scroll the page
      fileInput?.click();
    });
  }

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) readFile(file);
  });

  // ---- paste ----
  el<HTMLButtonElement>('[data-audit-paste-go]')?.addEventListener('click', () => {
    const text = el<HTMLTextAreaElement>('#audit-paste')?.value || '';
    const msg = el<HTMLElement>('[data-paste-msg]');
    if (!text.trim()) {
      if (msg) msg.textContent = 'Paste your CSV first.'; // QA-0928-198: a blank paste used to do nothing
      return;
    }
    if (msg) msg.textContent = '';
    ingest(text, 'real');
  });

  // ---- sample (ungated headline) + demo door (email-gated full report) ----
  el<HTMLButtonElement>('[data-audit-try-sample]')?.addEventListener('click', () => {
    track('audit_try_sample');
    loadSample('sample');
  });
  el<HTMLButtonElement>('[data-audit-demo]')?.addEventListener('click', () => {
    track('audit_demo_door');
    state.mode = 'sample';
    state.view = 'demo-gate';
    setResults(
      `<div class="mx-auto max-w-xl rounded-2xl border border-ink/10 bg-card p-6 shadow-sm">
        ${emailGate({
          tag: 'spend_audit_demo',
          cta: 'See the sample report',
          heading: 'See a full sample report',
          sub: `${SAMPLE_ORG} · ${SAMPLE_SEAT_COUNT} seats — a complete, clearly-labeled demo. One email and the whole report opens.`,
        })}
      </div>`,
    );
  });

  // ---- seat count recompute (only meaningful after a real upload) ----
  bindSeatRefresh();

  // ---- delegated handlers (forms/buttons rendered into #audit-results) ----
  document.addEventListener('submit', (e) => {
    const form = (e.target as HTMLElement)?.closest<HTMLFormElement>('form[data-audit-gate]');
    if (!form) return;
    e.preventDefault();
    void handleGateSubmit(form);
  });

  // The gate's "valid email" error clears as soon as you type, as CaptureForm's does (QA-0928-193).
  document.addEventListener('input', (e) => {
    const input = (e.target as HTMLElement)?.closest<HTMLInputElement>('form[data-audit-gate] input[name="email"]');
    if (!input) return;
    input.removeAttribute('aria-invalid');
    const status = input.form?.querySelector<HTMLElement>('[data-status]');
    if (status) {
      status.textContent = '';
      status.className = 'text-sm';
    }
  });

  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const dl = t.closest<HTMLElement>('[data-audit-download]');
    if (dl) {
      download(dl.dataset.auditDownload === 'pdf' ? 'pdf' : 'csv');
      return;
    }
    if (t.closest('[data-audit-reset]')) {
      reset();
      return;
    }
    if (t.closest('[data-lead-retry]') && lastLead) {
      showLeadStatus('saving');
      void postLead(lastLead.body);
    }
  });

  bindShareOnce(document);
}

/**
 * Seat-count changes (RC check BUILD-018). The field commits on blur, and the blur usually comes
 * from pressing something else — often the gate's Unlock button. The numbers are recomputed at
 * once (so that click reveals the new seat count), but redrawing is held until the press has
 * produced its click: redrawing mid-press moved the page under the pointer and the click was lost.
 * With no press in progress (keyboard), it redraws straight away. Either way the gate is kept.
 */
function bindSeatRefresh(): void {
  let pressing = false;
  let pressTimer: ReturnType<typeof setTimeout> | undefined;

  const endPress = () => {
    clearTimeout(pressTimer);
    pressing = false;
    flushSeatRefresh();
  };

  document.addEventListener('pointerdown', () => {
    clearTimeout(pressTimer);
    pressing = true;
  }, true);
  // The click (and the submit it triggers) follows the release; redraw after it. On touch the
  // click can trail the release, so the fallback waits; a press that never clicks (a drag, a
  // scroll) still redraws.
  document.addEventListener('pointerup', () => {
    clearTimeout(pressTimer);
    pressTimer = setTimeout(endPress, 800);
  }, true);
  document.addEventListener('pointercancel', () => {
    clearTimeout(pressTimer);
    pressTimer = setTimeout(endPress, 0);
  }, true);
  window.addEventListener('blur', endPress); // the window lost focus mid-press: no release is coming
  document.addEventListener('click', () => {
    if (!pressing) return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(endPress, 0); // after the click's own handlers and its form submit
  });

  el<HTMLInputElement>('#audit-seats')?.addEventListener('change', () => {
    if (!state.rows) {
      seatCountInput(); // validate + explain even before an upload
      return;
    }
    recompute();
    seatRefreshPending = true;
    if (!pressing) flushSeatRefresh();
  });
}

function readFile(file: File): void {
  const reader = new FileReader();
  reader.onload = () => ingest(String(reader.result || ''), 'real');
  reader.onerror = () =>
    setResults(
      `<div class="rounded-2xl border border-alert/40 bg-alert/[0.06] p-6 text-sm text-ink/75">Couldn't read that file. Try pasting the CSV instead.</div>`,
    );
  reader.readAsText(file);
}

export function initAudit(): void {
  bindOnce();
}

/**
 * Initializer for the STATIC /business/audit/sample page. The report there is server-rendered
 * at build time, so this only (1) seeds the in-memory sample hooks so the offline CSV/PDF
 * download buttons work, and (2) wires the in-report buttons (download + "Run my real audit →"
 * which navigates to the live tool). No dropzone, no email gate.
 */
export function initSampleStatic(): void {
  const parsed = parseSpendReport(SAMPLE_CSV);
  if (parsed.kind === 'ok') {
    state.mode = 'sample';
    state.rows = parsed.rows;
    state.columns = parsed.columns;
    state.hooks = computeHooks(parsed.rows, parsed.columns, { seatCount: SAMPLE_SEAT_COUNT });
    state.view = 'report';
  }
  if ((window as any).__auditSampleBound) return;
  (window as any).__auditSampleBound = true;
  document.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const dl = t.closest<HTMLElement>('[data-audit-download]');
    if (dl) {
      download(dl.dataset.auditDownload === 'pdf' ? 'pdf' : 'csv');
      return;
    }
    if (t.closest('[data-audit-reset]')) window.location.href = '/business/audit/';
  });

  bindShareOnce(document);
}
