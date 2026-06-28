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
import { parseSpendReport } from './parse';
import { computeHooks } from './hooks';
import {
  buildReportCsv,
  emailGate,
  renderFullReport,
  renderHeadline,
  renderWrongFile,
} from './render';
import { SAMPLE_CSV, SAMPLE_ORG, SAMPLE_SEAT_COUNT } from './sampleData';
import type { ColumnAvailability, Hooks, SpendRow } from './types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

function track(event: string): void {
  try {
    (window as any).umami?.track(event);
  } catch {
    /* analytics must never block the audit */
  }
}

function el<T extends HTMLElement>(sel: string): T | null {
  return document.querySelector<T>(sel);
}

function seatCountInput(): number | null {
  const raw = el<HTMLInputElement>('#audit-seats')?.value?.trim();
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
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
function renderHeadlineView(): void {
  if (!state.hooks) return;
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

function renderReportView(): void {
  if (!state.hooks) return;
  setResults(
    renderFullReport(state.hooks, { sample: state.mode === 'sample', org: SAMPLE_ORG }),
  );
  state.view = 'report';
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
        <p class="mt-2">${parsed.detail.replace(/</g, '&lt;')}</p>
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
  void postLead({ email, tag, rerun });
}

async function postLead(opts: { email: string; tag: string; rerun: boolean }): Promise<void> {
  if (!state.hooks) return;
  const payload = {
    email: opts.email,
    tag: opts.tag,
    source: window.location.pathname,
    website: '', // honeypot empty for humans
    consent: false,
    monthly_rerun: opts.rerun,
  };

  // Log the exact body locally so anyone can verify what leaves the browser: ONLY
  // email + tag + source + the monthly-rerun flag. We deliberately send NO spend
  // numbers/aggregates — no names, no per-person rows, no file. (Honesty posture:
  // the audit's figures never leave the device; only the email + reminder pref do.)
  // eslint-disable-next-line no-console
  console.info('[audit lead] payload (email + prefs only) →', payload);

  if (!CAPTURE_ENDPOINT) return; // local dev / no endpoint: nothing stored, already logged
  try {
    await fetch(CAPTURE_ENDPOINT, {
      method: CAPTURE_METHOD,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    /* lead delivery is best-effort; the report is already on screen */
  }
}

// ---------------------------------------------------------------- download (offline)
function download(kind: 'csv' | 'pdf'): void {
  if (!state.hooks) return;
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
  }

  fileInput?.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) readFile(file);
  });

  // ---- paste ----
  el<HTMLButtonElement>('[data-audit-paste-go]')?.addEventListener('click', () => {
    const text = el<HTMLTextAreaElement>('#audit-paste')?.value || '';
    if (text.trim()) ingest(text, 'real');
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
  el<HTMLInputElement>('#audit-seats')?.addEventListener('change', () => {
    if (!state.rows) return;
    recompute();
    if (state.view === 'headline') renderHeadlineView();
    else if (state.view === 'report') renderReportView();
  });

  // ---- delegated handlers (forms/buttons rendered into #audit-results) ----
  document.addEventListener('submit', (e) => {
    const form = (e.target as HTMLElement)?.closest<HTMLFormElement>('form[data-audit-gate]');
    if (!form) return;
    e.preventDefault();
    void handleGateSubmit(form);
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
    if (t.closest('[data-audit-reset]')) window.location.href = '/business/audit';
  });
}
