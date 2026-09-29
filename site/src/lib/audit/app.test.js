// Spend-audit controller (app.ts) against a minimal fake DOM (RC check BUILD-018). site/ has no
// browser harness, so these drive the real controller through the events a press produces and
// record what the page shows and what window.print() would print. No network: the capture
// endpoint is stubbed empty (the lead POST returns before fetch) and fetch throws if anything
// reaches it anyway. All data is synthetic.
process.env.TZ = 'America/New_York';
import { test, before, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// app.ts imports the Astro config (import.meta.env) and extensionless siblings, as Vite allows.
const CONFIG_STUB = `data:text/javascript,${encodeURIComponent("export const CAPTURE_ENDPOINT = ''; export const CAPTURE_METHOD = 'POST';")}`;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === '../../config') return { url: CONFIG_STUB, shortCircuit: true };
    if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier)) {
      try { return next(`${specifier}.ts`, context); } catch { /* fall through */ }
    }
    return next(specifier, context);
  },
});

const HEADER = 'email,account_uuid,product,model,model_family,total_requests,total_prompt_tokens,total_completion_tokens,total_net_spend_usd,total_gross_spend_usd';
const CSV = `${HEADER}
ana@example.invalid,u_1,Claude Code,claude-sonnet-4-6,Sonnet,400,12000000,1200000,40.00,40.00
ben@example.invalid,u_2,Claude Code,claude-opus-4-6,Opus,300,9000000,900000,90.00,90.00
cy@example.invalid,u_3,Chat,claude-sonnet-4-6,Sonnet,120,1800000,300000,6.00,6.00`;

// ---- a fake DOM: just the surface app.ts touches --------------------------------------------
function fakeEl(props = {}) {
  const listeners = {};
  return {
    value: '',
    dataset: {},
    innerHTML: '',
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {},
    removeAttribute() {},
    scrollIntoView() {},
    focus() {},
    click() {},
    remove() {},
    querySelector: () => null,
    closest: () => null,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    fire(type, ev = {}) { for (const fn of listeners[type] || []) fn({ target: this, preventDefault() {}, ...ev }); },
    ...props,
  };
}

const GATE_START = '<div id="audit-gate"';
const docListeners = [];
const seats = fakeEl();
const results = fakeEl();
let fullRenders = 0; // #audit-results rebuilt from scratch (a gate rebuilt under the pointer loses the click)
let headlineSwaps = 0; // only the headline replaced; the gate node stays
{
  let html = '';
  Object.defineProperty(results, 'innerHTML', {
    get: () => html,
    set: (v) => { html = v; fullRenders++; },
  });
  results.querySelector = (sel) => {
    if (sel === '#audit-gate') return html.includes(GATE_START) ? fakeEl() : null;
    if (sel === '.audit-headline' && html.startsWith('<div class="audit-headline">') && html.includes(GATE_START)) {
      return { set outerHTML(v) { html = v + html.slice(html.indexOf(GATE_START)); headlineSwaps++; } };
    }
    return null;
  };
}
const pasteBox = fakeEl();
const pasteGo = fakeEl();
const byId = { '#audit-seats': seats, '#audit-results': results, '#audit-paste': pasteBox, '[data-audit-paste-go]': pasteGo };
const printed = [];
const csvBlobs = [];

globalThis.document = {
  title: 'Claude spend audit',
  body: { classList: { add() {}, remove() {} }, appendChild() {} },
  querySelector: (sel) => byId[sel] || null,
  createElement: () => fakeEl(),
  addEventListener(type, fn, capture = false) { docListeners.push({ type, fn, capture: !!capture }); },
};
globalThis.window = {
  location: { search: '', pathname: '/business/audit/' },
  addEventListener() {},
  removeEventListener() {},
  print: () => printed.push(results.innerHTML),
};
globalThis.fetch = async (url) => { throw new Error(`unexpected network request: ${url}`); };

/** A document-level event: capture listeners, then bubble ones, in registration order. */
function fireDoc(type, target) {
  const ev = { type, target, preventDefault() {} };
  for (const phase of [true, false]) for (const l of docListeners) if (l.type === type && l.capture === phase) l.fn(ev);
}
/** A pressable element whose closest(`sel`) is `value` (and nothing else). */
function pressable(sel, value) {
  const t = fakeEl();
  t.closest = (s) => (s === sel ? value ?? t : null);
  return t;
}
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

const gateForm = fakeEl({
  dataset: { tag: 'spend_audit' },
  querySelector: (sel) =>
    sel === 'input[name="email"]' ? fakeEl({ value: 'qa@example.invalid' }) : sel === '[data-honeypot]' ? fakeEl() : null,
});
gateForm.closest = (s) => (s === 'form[data-audit-gate]' ? gateForm : null);
const unlockButton = pressable('form[data-audit-gate]', gateForm);

/** Start over, paste the synthetic export: the headline and the email gate are on screen. */
function freshHeadline() {
  fireDoc('click', pressable('[data-audit-reset]'));
  seats.value = '';
  pasteBox.value = CSV; // start-over empties the paste box
  pasteGo.fire('click');
  assert.ok(results.innerHTML.includes(GATE_START), `the gate is showing: ${results.innerHTML.slice(0, 300)}`);
  fullRenders = 0;
  headlineSwaps = 0;
}
/** A mouse press on `target` that commits the seat field (its change fires mid-press), then the click. */
function pressCommittingSeats(target, value) {
  seats.value = value;
  fireDoc('pointerdown', target);
  seats.fire('change');
  const duringPress = results.innerHTML;
  fireDoc('pointerup', target);
  fireDoc('click', target);
  return duringPress;
}

before(async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  mock.method(console, 'info', () => {}); // the controller logs the lead body locally
  const { initAudit } = await import('./app.ts');
  initAudit();
});
after(() => {
  mock.timers.reset();
  mock.restoreAll();
});

test('keyboard: a seat change redraws only the headline, at once, and keeps the gate', () => {
  freshHeadline();
  const gate = results.innerHTML.slice(results.innerHTML.indexOf(GATE_START));
  seats.value = '20';
  seats.fire('change'); // Tab out of the field: no press in progress
  assert.equal(headlineSwaps, 1);
  assert.equal(fullRenders, 0, 'the gate (and a typed email) is not rebuilt');
  assert.match(text(results.innerHTML), /\/yr/, 'the headline shows the idle-seat reclaim');
  assert.equal(results.innerHTML.slice(results.innerHTML.indexOf(GATE_START)), gate);
});

test('mouse: a seat change committed by pressing Unlock is not drawn mid-press; the click opens the report with it', () => {
  freshHeadline();
  const beforePress = results.innerHTML;
  const duringPress = pressCommittingSeats(unlockButton, '20');
  assert.equal(duringPress, beforePress, 'nothing moves under the pointer while it is down');
  fireDoc('submit', gateForm); // the click's form submit
  assert.match(text(results.innerHTML), /3 people · 20 seats · \$136 net · all 8 checks/);
  const shown = results.innerHTML;
  mock.timers.tick(2000); // the held redraw finds nothing left to do
  assert.equal(results.innerHTML, shown);
});

test('a seat count committed by pressing Download PDF is in the printed report, and the CSV agrees', async () => {
  freshHeadline();
  fireDoc('submit', gateForm); // unlock with no seat count
  assert.match(text(results.innerHTML), /3 people · \$136 net · all 8 checks/);
  assert.doesNotMatch(text(results.innerHTML), /seats ·/);

  // Type 20 seats, scroll down without clicking, press Download PDF (RC check BUILD-018 regression).
  const pdf = pressable('[data-audit-download]', fakeEl({ dataset: { auditDownload: 'pdf' } }));
  printed.length = 0;
  pressCommittingSeats(pdf, '20');
  assert.equal(printed.length, 1, 'one print');
  assert.match(text(printed[0]), /3 people · 20 seats · /, 'the printed report carries the new seat count');
  assert.match(text(printed[0]), /17 of your 20 seats show ~0 usage/);

  // Download CSV in the same state: the CSV's reclaim figure is the one the PDF printed.
  URL.createObjectURL = (blob) => { csvBlobs.push(blob); return 'blob:stub'; };
  URL.revokeObjectURL = () => {};
  const csvButton = pressable('[data-audit-download]', fakeEl({ dataset: { auditDownload: 'csv' } }));
  fireDoc('pointerdown', csvButton);
  fireDoc('pointerup', csvButton);
  fireDoc('click', csvButton);
  const csv = await csvBlobs[0].text();
  const reclaim = Number(csv.match(/# deadweight_reclaim_usd_per_year,([\d.]+)/)?.[1]);
  assert.ok(reclaim > 0, 'the CSV has the reclaim for 20 seats');
  const usd = Math.round(reclaim).toLocaleString('en-US');
  assert.ok(text(printed[0]).includes(`$${usd}/yr`), `the PDF shows the CSV's $${usd}/yr`);

  const shown = results.innerHTML;
  mock.timers.tick(2000); // the held redraw has nothing left to do: the screen already matches
  assert.equal(results.innerHTML, shown);
});
