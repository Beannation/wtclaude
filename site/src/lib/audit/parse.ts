/**
 * Dependency-free CSV parsing + schema detection for the Spend Report.
 *
 * Why no PapaParse: the whole tool's trust contract is "nothing leaves your browser."
 * A ~40-line, fully-auditable, zero-dependency parser keeps the supply chain empty and
 * the bundle tiny, and the Spend Report schema is simple (no embedded newlines). It still
 * honors quoted fields / escaped quotes / CRLF / BOM per RFC-4180.
 */
import type { ColumnAvailability, ParseResult, SpendRow } from './types';

/** A parsed matrix, each row's 1-based starting line, and where an unclosed quote opened (if any). */
export interface CsvParse {
  rows: string[][];
  lines: number[];
  unclosedQuoteLine: number | null;
}

/**
 * RFC-4180-ish parse into a matrix of string cells. Tolerates quotes, "" escapes, CR/LF, BOM.
 * Also reports where each row starts and whether the text ends inside a quoted field: an
 * unclosed quote swallows every later row into one cell, so the caller must refuse the file
 * rather than audit what is left (RC check BUILD-018).
 */
export function parseCsvDetailed(input: string): CsvParse {
  const text = input.replace(/^\uFEFF/, ''); // strip BOM
  const rows: string[][] = [];
  const lines: number[] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;
  let quoteLine = 1;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    lines.push(rowLine);
    row = [];
  };

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (c === '\n' || (c === '\r' && text[i + 1] !== '\n')) line++;
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      quoteLine = line;
      i++;
      continue;
    }
    if (c === ',') {
      endField();
      i++;
      continue;
    }
    if (c === '\r' || c === '\n') {
      // swallow \r (handle \r\n and bare \r)
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRow();
      i++;
      line++;
      rowLine = line;
      continue;
    }
    field += c;
    i++;
  }
  // flush trailing field/row (file not ending in newline)
  if (field.length > 0 || row.length > 0 || inQuotes) endRow();

  // Drop fully-blank rows.
  const keep = rows.map((r) => !(r.length === 1 && r[0].trim() === ''));
  return {
    rows: rows.filter((_, k) => keep[k]),
    lines: lines.filter((_, k) => keep[k]),
    unclosedQuoteLine: inQuotes ? quoteLine : null,
  };
}

/** The cell matrix only (see parseCsvDetailed for line numbers and unclosed-quote detection). */
export function parseCsv(input: string): string[][] {
  return parseCsvDetailed(input).rows;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Normalize a model_family value (or infer from the model id) to Opus/Sonnet/Haiku/Fable/Mythos. */
export function normFamily(family: string, model: string): string {
  const known = (s: string) =>
    s.includes('opus') ? 'Opus'
    : s.includes('sonnet') ? 'Sonnet'
    : s.includes('haiku') ? 'Haiku'
    : s.includes('fable') ? 'Fable'
    : s.includes('mythos') ? 'Mythos'
    : null;
  return known(norm(family)) ?? known(norm(model)) ?? (family.trim() || 'Other');
}

/**
 * Plain-words intake diagnostics (QA-0928-198) for the shapes people actually drop in: a binary
 * file (image / .xlsx), JSON (the Enterprise Analytics API shape), and a Spend Report re-saved
 * with ';' or tab separators (Excel in many locales). We explain rather than auto-convert: those
 * re-saves often switch the decimal mark too ("10,5"), and a silently mis-read dollar figure is
 * worse than asking for the original file.
 */
const REEXPORT =
  'Re-export the Spend Report from claude.ai → Settings → Analytics → Export Spend Report and upload that file as-is.';

function diagnoseNotText(text: string): string | null {
  // Control bytes near the top, or an undecodable byte in the magic-number position (PNG's 0x89).
  if (/[\u0000-\u0008\u000E-\u001F]/.test(text.slice(0, 512)) || /\uFFFD/.test(text.slice(0, 16)))
    return `That file isn't a text CSV (it looks like an image or a spreadsheet file). ${REEXPORT}`;
  if (/^\s*[[{]/.test(text)) return `That's a JSON file, not the Spend Report CSV. ${REEXPORT}`;
  return null;
}

function diagnoseNoEmail(firstLine: string): string {
  const hasEmailWith = (sep: string) => firstLine.split(sep).some((h) => norm(h.replace(/^"|"$/g, '')) === 'email');
  if (hasEmailWith(';'))
    return `This looks like a Spend Report saved with semicolons (;) between columns — Excel does that in many regions. ${REEXPORT}`;
  if (hasEmailWith('\t'))
    return `This looks tab-separated (copied from a spreadsheet?). ${REEXPORT} Or paste the raw CSV text.`;
  return `We couldn't find an "email" column. This needs the per-person Spend Report from claude.ai → Settings → Analytics → Export Spend Report.`;
}

/** The numeric Spend Report columns: each must hold a plain, non-negative number (or be blank). */
const NUMERIC_COLUMNS = [
  'total_requests',
  'total_prompt_tokens',
  'total_completion_tokens',
  'total_net_spend_usd',
  'total_gross_spend_usd',
] as const;

/**
 * Read one numeric cell. Blank is 0; a leading "$" and thousands commas ("1,234.50") are fine.
 * Anything else — text, a decimal comma ("10,5"), a negative — is an error the caller names,
 * never a silent 0 (RC check BUILD-018: "abc" requests used to read as 0, and -5 as -5).
 */
function readNumber(raw: string): { value: number } | { problem: 'not-a-number' | 'negative' } {
  const t = raw.trim();
  if (t === '') return { value: 0 };
  const noDollar = t.replace(/^(-?)\$/, '$1').replace(/^\$(-)/, '$1');
  const plain = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(noDollar) ? noDollar.replace(/,/g, '') : noDollar;
  if (!/^-?(\d+(\.\d*)?|\.\d+)([eE][-+]?\d+)?$/.test(plain)) return { problem: 'not-a-number' };
  const v = Number(plain);
  if (!Number.isFinite(v)) return { problem: 'not-a-number' };
  if (v < 0) return { problem: 'negative' };
  return { value: v };
}

const clipCell = (s: string) => (s.length > 40 ? `${s.slice(0, 40)}…` : s);

/**
 * Parse a Spend Report CSV. Detects:
 *  - the WRONG file (Console export: workspace_id present, no per-person email) → redirect, not crash
 *  - degraded schema (missing/renamed optional columns) → compute what's present, label the rest
 */
export function parseSpendReport(input: string): ParseResult {
  const notText = diagnoseNotText(input.replace(/^\uFEFF/, ''));
  if (notText) return { kind: 'error', detail: notText };
  const csv = parseCsvDetailed(input);
  if (csv.unclosedQuoteLine != null) {
    return {
      kind: 'error',
      detail: `Line ${csv.unclosedQuoteLine} opens a quote mark (") that never closes, so everything after it runs together and can't be read. ${REEXPORT}`,
    };
  }
  const matrix = csv.rows;
  if (matrix.length < 2) {
    return { kind: 'empty', detail: 'That file has no data rows we can read.' };
  }
  const headers = matrix[0].map((h) => h.trim());
  const idx: Record<string, number> = {};
  headers.forEach((h, k) => {
    idx[norm(h)] = k;
  });
  const has = (name: string) => norm(name) in idx;

  // --- Wrong-file guard (AC): Console export has workspace_id / API billing cols and no email.
  const looksConsole =
    !has('email') &&
    (has('workspace_id') || has('service_tier') || has('amount_usd') || has('uncached_input_tokens'));
  if (looksConsole) {
    return {
      kind: 'wrong-file',
      detail:
        'This looks like the API billing export from platform.claude.com (Console) — it has no per-person breakdown.',
    };
  }
  if (!has('email')) {
    return { kind: 'error', detail: diagnoseNoEmail(input.replace(/^\uFEFF/, '').split(/\r\n|\r|\n/)[0] ?? '') };
  }

  const columns: ColumnAvailability = {
    email: true,
    product: has('product'),
    modelFamily: has('model_family') || has('model'),
    requests: has('total_requests'),
    promptTokens: has('total_prompt_tokens'),
    completionTokens: has('total_completion_tokens'),
    netSpend: has('total_net_spend_usd'),
    grossSpend: has('total_gross_spend_usd'),
  };

  const cell = (r: string[], name: string) => {
    const k = idx[norm(name)];
    return k == null ? '' : (r[k] ?? '');
  };

  // The header's named columns (a trailing comma on the header adds a blank name, not a column).
  let columnCount = headers.length;
  while (columnCount > 0 && headers[columnCount - 1] === '') columnCount--;

  // Every damaged row is found; the first is named and the rest counted. One bad row refuses the
  // file: auditing around it would print totals that silently leave it out.
  const problems: string[] = [];
  const rows: SpendRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    const at = `Line ${csv.lines[r]}`;
    if (line.every((c) => c.trim() === '')) continue; // a row of empty cells (,,,,)
    // Cells past the header's last named column are tolerated only when blank (a trailing comma).
    if (line.length < columnCount || line.slice(columnCount).some((c) => c.trim() !== '')) {
      problems.push(
        line.length > columnCount
          ? `${at} has ${line.length} values but the header has ${columnCount} columns — an unquoted comma inside a value (like $1,234.50) does this.`
          : `${at} has ${line.length} values but the header has ${columnCount} columns — the row looks cut short.`,
      );
      continue;
    }
    const email = cell(line, 'email').trim().toLowerCase();
    if (!email) continue; // skip rows without a person
    const nums: Partial<Record<(typeof NUMERIC_COLUMNS)[number], number>> = {};
    let bad = false;
    for (const col of NUMERIC_COLUMNS) {
      if (!has(col)) {
        nums[col] = 0;
        continue;
      }
      const raw = cell(line, col);
      const read = readNumber(raw);
      if ('value' in read) {
        nums[col] = read.value;
        continue;
      }
      problems.push(
        read.problem === 'negative'
          ? `${at}: ${col} is ${clipCell(raw.trim())}, and the audit can't use a negative value.`
          : `${at}: ${col} is "${clipCell(raw.trim())}", which isn't a number.`,
      );
      bad = true;
      break;
    }
    if (bad) continue;
    rows.push({
      email,
      account_uuid: cell(line, 'account_uuid').trim(),
      product: (cell(line, 'product').trim() || 'Unknown'),
      model: cell(line, 'model').trim(),
      model_family: normFamily(cell(line, 'model_family'), cell(line, 'model')),
      total_requests: nums.total_requests ?? 0,
      total_prompt_tokens: nums.total_prompt_tokens ?? 0,
      total_completion_tokens: nums.total_completion_tokens ?? 0,
      total_net_spend_usd: nums.total_net_spend_usd ?? 0,
      total_gross_spend_usd: nums.total_gross_spend_usd ?? 0,
    });
  }

  if (problems.length) {
    const more = problems.length - 1;
    return {
      kind: 'error',
      detail: `${problems[0]}${more ? ` (${more} more row${more === 1 ? ' has' : 's have'} problems too.)` : ''} ${REEXPORT}`,
    };
  }

  if (rows.length === 0) {
    return { kind: 'empty', detail: 'We parsed the file but found no per-person rows.' };
  }
  return { kind: 'ok', rows, columns, headers };
}
