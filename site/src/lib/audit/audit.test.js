// Spend-audit unit tests (QA-0928-109/110/113/114/192/195/198/199). The audit is PURE
// (no DOM, no network), so parse → hooks → render run here exactly as in the browser.
// All data is synthetic.
process.env.TZ = 'America/New_York';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSpendReport, normFamily } from './parse.ts';
import { computeHooks, parseSeatCount, SEAT_PRICING } from './hooks.ts';
import { renderHeadline, renderFullReport, fmtUsd, buildReportCsv } from './render.ts';
import { SAMPLE_CSV, SAMPLE_SEAT_COUNT } from './sampleData.ts';

const HEADER = 'email,account_uuid,product,model,model_family,total_requests,total_prompt_tokens,total_completion_tokens,total_net_spend_usd,total_gross_spend_usd';
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

function run(csv, seatCount = null) {
  const p = parseSpendReport(csv);
  assert.equal(p.kind, 'ok', p.detail);
  const hooks = computeHooks(p.rows, p.columns, { seatCount });
  return { hooks, head: text(renderHeadline(hooks)), full: text(renderFullReport(hooks, { sample: false })) };
}

// A copy of seat-audit-fixtures/test-northwind-seatbased.csv: 16 people on a seat-based plan,
// thousands of in-seat requests at $0, $250 of overage on 3 people, 4 people with no usage.
const NORTHWIND = `${HEADER}
ron@northwind.co,u_1176,Claude Code,claude-opus-4-6,Opus,1200,38400000,4080000,0,0
sue@northwind.co,u_1187,Claude Code,claude-sonnet-4-6,Sonnet,1100,35200000,3740000,0,0
paz@northwind.co,u_1194,Claude Code,claude-sonnet-4-6,Sonnet,980,31360000,3332000,0,0
oli@northwind.co,u_1201,Claude Code,claude-opus-4-6,Opus,870,27840000,2958000,0,0
nia@northwind.co,u_1207,Claude Code,claude-sonnet-4-6,Sonnet,760,24320000,2584000,0,0
mac@northwind.co,u_1213,Claude Code,claude-sonnet-4-6,Sonnet,680,21760000,2312000,0,0
kay@northwind.co,u_1218,Claude Code,claude-3-5-haiku,Haiku,590,18880000,2006000,0,0
jed@northwind.co,u_1227,Claude Code,claude-sonnet-4-6,Sonnet,520,16640000,1768000,0,0
ila@northwind.co,u_1235,Claude Code,claude-3-5-haiku,Haiku,430,13760000,1462000,0,0
hal@northwind.co,u_1240,Claude Code,claude-sonnet-4-6,Sonnet,380,12160000,1292000,0,0
gio@northwind.co,u_1251,Claude Code,claude-sonnet-4-6,Sonnet,300,9600000,1020000,0,0
fay@northwind.co,u_1258,Claude Code,claude-3-5-haiku,Haiku,250,8000000,850000,0,0
ron@northwind.co,u_1176,Claude Code,claude-opus-4-6,Opus,180,6000000,520000,140,140.0
oli@northwind.co,u_1201,Claude Code,claude-opus-4-6,Opus,90,3100000,260000,72,72.0
sue@northwind.co,u_1187,Claude Code,claude-sonnet-4-6,Sonnet,120,3600000,400000,38,38.0
dot@northwind.co,u_1259,Claude Code,claude-sonnet-4-6,Sonnet,0,0,0,0,0
eve@northwind.co,u_1272,Claude Code,claude-sonnet-4-6,Sonnet,0,0,0,0,0
fox@northwind.co,u_1279,Claude Code,claude-sonnet-4-6,Sonnet,0,0,0,0,0
guy@northwind.co,u_1281,Claude Code,claude-sonnet-4-6,Sonnet,0,0,0,0,0
`;

// QA-0928-109 repro: Fable 5.1 is $3,900 of $4,920 net (Opus 5.5 $910, Sonnet 5 $110).
const FABLE_HEAVY = `${HEADER}
ann@newco.dev,u_1,Claude Code,claude-fable-5-1,Fable,900,30000000,2500000,2400.00,2400.00
di@newco.dev,u_4,Claude Code,claude-fable-5-1,,600,15000000,1100000,1500.00,1500.00
ann@newco.dev,u_1,Claude Code,claude-opus-5-5,Opus,400,12000000,900000,300.00,300.00
bo@newco.dev,u_2,Claude Code,claude-opus-5-5,Opus,800,20000000,1500000,520.00,520.00
cy@newco.dev,u_3,Chat,claude-opus-5-5,Opus,300,3000000,500000,90.00,90.00
ed@newco.dev,u_5,Claude Code,claude-sonnet-5,Sonnet,500,9000000,800000,110.00,110.00
`;

// ---------------------------------------------------------------- QA-0928-109 Fable
test('normFamily recognises Fable and Mythos by family and by model id', () => {
  assert.equal(normFamily('Fable', ''), 'Fable');
  assert.equal(normFamily('', 'claude-fable-5-1'), 'Fable');
  assert.equal(normFamily('', 'claude-fable-5'), 'Fable');
  assert.equal(normFamily('Mythos', ''), 'Mythos');
  assert.equal(normFamily('', 'claude-mythos-5-1'), 'Mythos');
  assert.equal(normFamily('', 'claude-opus-5-5'), 'Opus');
});

test('a Fable-heavy team is not told it is already lean, and the mix names Fable', () => {
  const { hooks, head, full } = run(FABLE_HEAVY);
  assert.equal(Math.round(hooks.totalNet), 4920);
  assert.doesNotMatch(head, /already lean/);
  assert.doesNotMatch(head, /Opus is 18%/);
  assert.match(head, /Fable/);
  assert.equal(Math.round(hooks.h3.premiumPctOfSpend), 98);
  assert.equal(hooks.h3.premiumPeople, 4);
  assert.deepEqual(hooks.h3.premiumFamilies, ['Fable', 'Opus']);
  assert.match(full, /Fable/);
});

test('Fable feeds the heavy-model and cheap-surface flags and the mix bar', () => {
  const csv = `${HEADER}
fi@x.dev,u_1,Chat,claude-fable-5-1,Fable,100,100000,10000,300.00,300.00
se@x.dev,u_2,Claude Code,claude-sonnet-5,Sonnet,100,100000,10000,10.00,10.00
`;
  const { hooks } = run(csv);
  const fi = hooks.people.find((p) => p.email === 'fi@x.dev');
  assert.ok(fi.flags.some((f) => f.label === 'heavy Fable'), JSON.stringify(fi.flags));
  assert.ok(fi.flags.some((f) => f.label === 'Fable in Chat'), JSON.stringify(fi.flags));
  assert.deepEqual(hooks.h3.premiumOnCheapSurface.map((o) => [o.email, o.family, o.product]), [['fi@x.dev', 'Fable', 'Chat']]);
  const html = renderFullReport(hooks, { sample: false });
  assert.match(html, /title="Fable 100%"/, 'a Fable-only person gets a non-blank mix bar');
});

// RC check BUILD-018: the blurred-preview CTA under the headline promises only what the full
// report will show, in the report's own words ("Opus on cheap surfaces" only when every entry
// in that list is Opus; "Premium models on cheap surfaces" otherwise).
const previewCta = (head) => (head.match(/All 8 checks[^.]*— unlocked on this page/) || [''])[0];

test('the preview CTA names the premium-on-cheap list the way the report does, Fable included', () => {
  const csv = `${HEADER}
fi@x.dev,u_1,Chat,claude-fable-5-1,Fable,100,100000,10000,300.00,300.00
fi@x.dev,u_1,Claude Code,claude-fable-5-1,Fable,900,900000,90000,2700.00,2700.00
se@x.dev,u_2,Claude Code,claude-sonnet-5,Sonnet,100,100000,10000,10.00,10.00
`;
  const { head, full } = run(csv);
  assert.match(head, /Fable is \d+% of your bill/);
  assert.match(full, /Premium models on cheap surfaces/);
  const cta = previewCta(head);
  assert.ok(cta, head);
  assert.doesNotMatch(cta, /Opus/);
  assert.match(cta, /premium-models-on-cheap-surfaces list/);
});

test('the preview CTA keeps "Opus" only when every entry in the cheap-surface list is Opus', () => {
  const sample = previewCta(run(SAMPLE_CSV, SAMPLE_SEAT_COUNT).head);
  assert.match(sample, /the Opus-on-cheap-surfaces list/);
  const fh = run(FABLE_HEAVY);
  // FABLE_HEAVY's only cheap-surface premium use is Opus in Chat — the report says "Opus on cheap surfaces".
  assert.match(fh.full, /Opus on cheap surfaces/);
  assert.match(previewCta(fh.head), /the Opus-on-cheap-surfaces list/);
});

test('the preview CTA does not promise a list or outliers the report will not have', () => {
  const { hooks, head } = run(NORTHWIND); // no premium model on a cheap surface, no $/request outliers
  assert.equal(hooks.h3.premiumOnCheapSurface.length, 0);
  assert.equal(hooks.h5.outliers.length, 0);
  const cta = previewCta(head);
  assert.ok(cta, head);
  assert.doesNotMatch(cta, /cheap/);
  assert.doesNotMatch(cta, /outliers/);
});

test('the downloadable CSV keeps opus_share_pct where it was and appends premium_share_pct', () => {
  const { hooks } = run(FABLE_HEAVY);
  const lines = buildReportCsv(hooks, { sample: false }).split('\n');
  const header = lines.find((l) => l.startsWith('email,')).split(',');
  // The 0.3.1 columns, same names and order — anyone parsing the download keeps working.
  assert.deepEqual(header.slice(0, 8), ['email', 'net_spend_usd', 'gross_spend_usd', 'requests', 'dollar_per_request', 'opus_share_pct', 'prompt_completion_ratio', 'flags']);
  assert.equal(header[8], 'premium_share_pct');
  const ann = lines.find((l) => l.startsWith('ann@')).split(',');
  // ann: Fable $2,400 + Opus $300 of $2,700 → Opus-only 11%, premium (Opus+Fable+Mythos) 100%.
  assert.equal(ann[5], '11');
  assert.equal(ann[8], '100');
});

test('an Opus-only export keeps its wording (the public sample page is unchanged)', () => {
  const { head } = run(SAMPLE_CSV, SAMPLE_SEAT_COUNT);
  assert.match(head, /Opus is 60% of your bill — driven by 6 people\./);
});

// ---------------------------------------------------------------- QA-0928-110 seat-based overage
test('a seat-based export with some overage is labelled overage-only', () => {
  const { hooks, head, full } = run(NORTHWIND);
  assert.equal(hooks.overageOnly, true);
  assert.match(head, /overage-only/i);
  assert.match(full, /overage-only/i);
  assert.doesNotMatch(head, /of your bill/);
  assert.match(head, /of your overage \$/);
  assert.match(full, /Every \$ figure below is overage only/);
});

test('seat-based $/request is computed over dollarised requests only', () => {
  const { hooks, full } = run(NORTHWIND);
  // $250 of overage over 390 overage requests — not $250 over all 8,450 requests.
  assert.equal(hooks.h5.teamAvgPerReq.toFixed(2), (250 / 390).toFixed(2));
  const ron = hooks.people.find((p) => p.email === 'ron@northwind.co');
  assert.equal(ron.dollarPerReq, 140 / 180);
  assert.doesNotMatch(full, /runaway agents/);
});

test('usage-based exports are not labelled overage-only', () => {
  for (const csv of [SAMPLE_CSV, FABLE_HEAVY]) {
    const { hooks, head, full } = run(csv);
    assert.equal(hooks.overageOnly, false);
    assert.doesNotMatch(head + full, /overage-only/i);
  }
});

// Review regression: credits that zero out a usage-based row (net $0, gross > $0) are a
// discount, not in-seat usage. Reviewer's probe shape: 29% of requests on credit-covered Fable.
const CREDIT_COVERED = `${HEADER}
al@usage.dev,u_1,Claude Code,claude-opus-5-5,Opus,1400,40000000,3000000,900.00,1000.00
bea@usage.dev,u_2,Claude Code,claude-sonnet-5,Sonnet,700,14000000,1200000,200.00,236.00
cal@usage.dev,u_3,Claude Code,claude-fable-5-1,Fable,450,12000000,900000,0,600.00
dee@usage.dev,u_4,Claude Code,claude-fable-5-1,Fable,400,10000000,800000,0,450.00
`;

test('credit-covered rows (net $0, gross > $0) are a discount, not a seat plan', () => {
  const { hooks, head, full } = run(CREDIT_COVERED);
  assert.equal(hooks.overageOnly, false);
  assert.equal(hooks.inSeatRequests, 0);
  assert.doesNotMatch(head + full, /Seat-based plan/);
  assert.doesNotMatch(head + full, /overage-only/i);
  // The same report still tells the credit story, as the baseline did.
  assert.equal(hooks.h6.available, true);
  assert.equal(Math.round(hooks.h6.maskedUsd), 1186);
  // $/request is over every request (usage-based), not only the dollarised ones.
  assert.equal(hooks.h5.teamAvgPerReq.toFixed(4), (1100 / 2950).toFixed(4));
});

// ---------------------------------------------------------------- QA-0928-113 0x the median
test('the full report never says "0× the median"', () => {
  const { full } = run(NORTHWIND);
  assert.doesNotMatch(full, /0× the median/);
  assert.match(full, /2 of 16 people drive 80% of overage spend\./);
});

// ---------------------------------------------------------------- QA-0928-114 bridge
test('the bridge counts only $/request outliers, with correct plurals', () => {
  const sample = run(SAMPLE_CSV, SAMPLE_SEAT_COUNT);
  assert.equal(sample.hooks.h5.outliers.length, 1);
  assert.match(sample.full, /laura shows volatile, spiky spend\./);
  assert.doesNotMatch(sample.full, /\b1 others\b/);
  const nw = run(NORTHWIND);
  assert.doesNotMatch(nw.full, /others show volatile/);
  assert.match(nw.full, /Your spend can spike between invoices\./);
  // two outliers → "and 1 other"
  const csv = `${HEADER}
a@x.dev,u_1,Claude Code,claude-opus-5-5,Opus,10,1000000,10000,500.00,500.00
b@x.dev,u_2,Claude Code,claude-opus-5-5,Opus,10,1000000,10000,400.00,400.00
${Array.from({ length: 12 }, (_, i) => `p${i}@x.dev,u_${i + 9},Claude Code,claude-sonnet-5,Sonnet,1000,100000,10000,20.00,20.00`).join('\n')}
`;
  const two = run(csv);
  assert.equal(two.hooks.h5.outliers.length, 2);
  assert.match(two.full, /a and 1 other show volatile, spiky spend\./);
});

// ---------------------------------------------------------------- QA-0928-192 seat count
test('parseSeatCount accepts whole numbers 1..100,000 and explains everything else', () => {
  assert.deepEqual(parseSeatCount(''), { seats: null, error: null });
  assert.deepEqual(parseSeatCount(' 24 '), { seats: 24, error: null });
  assert.deepEqual(parseSeatCount('1e3'), { seats: 1000, error: null });
  assert.deepEqual(parseSeatCount('100000'), { seats: 100000, error: null });
  for (const bad of ['0', '-3', '2.5', 'abc', '999999999', '100001']) {
    const r = parseSeatCount(bad);
    assert.equal(r.seats, null, bad);
    assert.ok(r.error, `no message for "${bad}"`);
  }
});

test('fewer seats than people is said out loud, not silently ignored', () => {
  const { hooks, head, full } = run(SAMPLE_CSV, 5);
  assert.equal(hooks.h2.seatsBelowPeople, true);
  assert.match(head, /You entered 5 seats, but the export shows 13 people/);
  assert.match(full, /You entered 5 seats, but the export shows 13 people/);
  assert.equal(run(SAMPLE_CSV, SAMPLE_SEAT_COUNT).hooks.h2.seatsBelowPeople, false);
});

// ---------------------------------------------------------------- QA-0928-195 net > gross
test('net above gross reads "no discount detected", and money is sign-aware', () => {
  const csv = `${HEADER}
a@x.co,u_1,Claude Code,claude-opus-5-5,Opus,100,1000000,100000,120.00,100.00
b@x.co,u_2,Claude Code,claude-sonnet-5,Sonnet,100,1000000,100000,60.00,50.00
`;
  const { full } = run(csv);
  assert.doesNotMatch(full, /\$-/);
  assert.doesNotMatch(full, /masked by credits/);
  assert.match(full, /No discount detected/);
  assert.equal(fmtUsd(-30), '-$30');
  assert.equal(fmtUsd(30), '$30');
  assert.equal(fmtUsd(-0.004, 2), '$0.00');
});

// ---------------------------------------------------------------- QA-0928-198 intake errors
test('a semicolon-separated export is diagnosed as such', () => {
  const r = parseSpendReport(HEADER.replaceAll(',', ';') + '\na@s.co;u_1;Claude Code;claude-opus-5-5;Opus;100;1000000;100000;10,5;12,0\n');
  assert.equal(r.kind, 'error');
  assert.match(r.detail, /semicolon/i);
  const t = parseSpendReport(HEADER.replaceAll(',', '\t') + '\na@s.co\tu_1\tClaude Code\tclaude-opus-5-5\tOpus\t100\t1\t1\t10.5\t12\n');
  assert.equal(t.kind, 'error');
  assert.match(t.detail, /tab/i);
});

test('JSON and binary files get their own message; no literal backticks', () => {
  const j = parseSpendReport('{\n  "_comment": "per-user cost",\n  "data": []\n}');
  assert.equal(j.kind, 'error');
  assert.match(j.detail, /JSON/);
  const png = parseSpendReport('�PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR\u0000\u0000\u0004�');
  assert.equal(png.kind, 'error');
  assert.match(png.detail, /isn't a text CSV/);
  const plain = parseSpendReport('hello world\nthis is not a csv at all\n');
  assert.equal(plain.kind, 'error');
  for (const r of [j, png, plain]) assert.doesNotMatch(r.detail, /`/);
});

// RC check BUILD-018: a damaged file is refused with the line named, never turned into a
// silent, wrong report (an unclosed quote swallowed every later row; garbage and negative
// numbers became 0 or "-5 requests").
const GOOD = 'a@x.dev,u_1,Claude Code,claude-opus-5-5,Opus,100,1000000,100000,50.00,50.00';
const GOOD2 = 'b@x.dev,u_2,Claude Code,claude-sonnet-5,Sonnet,200,2000000,200000,20.00,20.00';

test('an unclosed quote is refused, naming the line it opens on', () => {
  const r = parseSpendReport(`${HEADER}\na@x.dev,u_1,Claude Code,claude-opus-5-5,Opus,"100,1000000,100000,50.00,50.00\n${GOOD2}\n${GOOD2.replace('b@', 'c@')}\n`);
  assert.equal(r.kind, 'error', JSON.stringify(r).slice(0, 200));
  assert.match(r.detail, /line 2\b/i);
  assert.match(r.detail, /quote/i);
});

test('a row with more or fewer values than the header is refused, naming the line', () => {
  // An unquoted "$1,234.50" splits into two cells.
  const extra = parseSpendReport(`${HEADER}\n${GOOD}\nb@x.dev,u_2,Claude Code,claude-sonnet-5,Sonnet,200,2000000,200000,$1,234.50,$1,300.00\n`);
  assert.equal(extra.kind, 'error');
  assert.match(extra.detail, /line 3\b/i);
  assert.match(extra.detail, /12 values/);
  assert.match(extra.detail, /10 columns/);
  assert.match(extra.detail, /unquoted comma/i);
  const short = parseSpendReport(`${HEADER}\n${GOOD}\nb@x.dev,u_2,Claude Code,claude-sonnet-5,Sonnet,200\n`);
  assert.equal(short.kind, 'error');
  assert.match(short.detail, /line 3\b/i);
  assert.match(short.detail, /6 values/);
});

test('non-numeric and negative numbers are refused, naming the line and the column', () => {
  const cases = [
    [`b@x.dev,u_2,Claude Code,claude-sonnet-5,Sonnet,abc,2000000,200000,20.00,20.00`, /total_requests/, /isn.t a number/],
    [`b@x.dev,u_2,Claude Code,claude-sonnet-5,Sonnet,-5,2000000,200000,20.00,20.00`, /total_requests/, /negative/],
    [`b@x.dev,u_2,Claude Code,claude-sonnet-5,Sonnet,200,2000000,200000,-20.00,20.00`, /total_net_spend_usd/, /negative/],
    [`b@x.dev,u_2,Claude Code,claude-sonnet-5,Sonnet,200,2000000,200000,"10,5",20.00`, /total_net_spend_usd/, /isn.t a number/],
  ];
  for (const [row, col, why] of cases) {
    const r = parseSpendReport(`${HEADER}\n${GOOD}\n${row}\n`);
    assert.equal(r.kind, 'error', row);
    assert.match(r.detail, /line 3\b/i, row);
    assert.match(r.detail, col, row);
    assert.match(r.detail, why, row);
  }
});

test('several damaged rows: the first is named and the rest are counted', () => {
  const bad = (e) => `${e}@x.dev,u_9,Claude Code,claude-sonnet-5,Sonnet,abc,1,1,1,1`;
  const r = parseSpendReport(`${HEADER}\n${GOOD}\n${bad('b')}\n${bad('c')}\n${bad('d')}\n`);
  assert.equal(r.kind, 'error');
  assert.match(r.detail, /line 3\b/i);
  assert.match(r.detail, /2 more rows/);
});

test('a malformed file never reaches the report: no "-5 requests", no "0 requests"', () => {
  for (const row of [
    'b@x.dev,u_2,Claude Code,claude-sonnet-5,Sonnet,-5,2000000,200000,-20.00,20.00',
    'b@x.dev,u_2,Claude Code,claude-sonnet-5,Sonnet,"200,2000000,200000,20.00,20.00',
  ]) assert.notEqual(parseSpendReport(`${HEADER}\n${row}\n${GOOD}\n`).kind, 'ok', row);
});

test('what a real export can hold still parses: quoted thousands, $ signs, blanks, CRLF, trailing blank cells', () => {
  const r = parseSpendReport(
    `${HEADER}\r\na@x.dev,u_1,Claude Code,claude-opus-5-5,Opus,"1,200",1000000,100000,"$1,234.50",$1300\r\n` +
      `b@x.dev,u_2,"Chat, web",claude-sonnet-5,Sonnet,200,2000000,200000,20.00,\r\n${GOOD2.replace('b@', 'c@')},,\r\n,,,,,,,,,\r\n`,
  );
  assert.equal(r.kind, 'ok', r.detail);
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].total_requests, 1200);
  assert.equal(r.rows[0].total_net_spend_usd, 1234.5);
  assert.equal(r.rows[0].total_gross_spend_usd, 1300);
  assert.equal(r.rows[1].product, 'Chat, web');
  assert.equal(r.rows[1].total_gross_spend_usd, 0);
});

test('a well-formed Spend Report still parses', () => {
  assert.equal(parseSpendReport(SAMPLE_CSV).kind, 'ok');
  assert.equal(parseSpendReport(NORTHWIND).kind, 'ok');
});

// ---------------------------------------------------------------- QA-0928-199 seat price basis
test('the reclaim figure states its seat-price basis (annual vs monthly billing)', () => {
  const { hooks, head, full } = run(SAMPLE_CSV, SAMPLE_SEAT_COUNT);
  // 11 idle seats × $100 (Premium, billed annually) × 12 — the math is unchanged.
  assert.equal(hooks.h2.reclaimUsdPerYear, 11 * SEAT_PRICING.premiumAnnualUsd * 12);
  assert.equal(hooks.h2.reclaimUsdPerYear, 13200);
  assert.match(full, /\$100\/seat\/mo billed annually; \$125 billed monthly/);
  assert.match(head, /billed annually/);
});

// ---------------------------------------------------------------- RC check BUILD-018 print
// Download PDF prints #audit-results. The lead-failure notice (app.ts prepends
// [data-lead-status] inside the report) and the report's own buttons are screen-only.
const PAGES = new URL('../../pages/', import.meta.url);
const printBlock = (rel) => {
  const src = readFileSync(new URL(rel, PAGES), 'utf8');
  const i = src.indexOf('@media print');
  assert.ok(i >= 0, `${rel} has no print block`);
  return src.slice(i, src.indexOf('</style>', i));
};

test('the print stylesheet hides the lead notice and the report buttons on both audit pages', () => {
  for (const rel of ['business/audit.astro', 'business/audit/sample.astro']) {
    const css = printBlock(rel);
    assert.match(css, /body\.audit-printing \[data-lead-status\]/, rel);
    assert.match(css, /body\.audit-printing \[data-no-print\]/, rel);
  }
});

test('the report marks its action rows screen-only; the report itself is not', () => {
  const html = renderFullReport(run(SAMPLE_CSV, SAMPLE_SEAT_COUNT).hooks, { sample: false });
  const noPrint = [...html.matchAll(/<(\w+)[^>]*\bdata-no-print\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(noPrint.length, 3, noPrint.join('\n'));
  assert.ok(noPrint.some((t) => /flex flex-wrap items-center justify-between/.test(t)), 'download bar');
  assert.match(html, /<div[^>]*data-no-print[^>]*>\s*<p[^>]*>Keep or forward this report/);
  assert.match(html, /<section[^>]*data-no-print[^>]*>\s*<p[^>]*>Nice — that's your audit\./);
  assert.match(html, /<div[^>]*data-no-print[^>]*><button[^>]*data-audit-reset/);
  assert.doesNotMatch(html, /class="audit-report[^"]*"[^>]*data-no-print/);
});
