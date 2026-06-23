/**
 * Dependency-free CSV parsing + schema detection for the Spend Report.
 *
 * Why no PapaParse: the whole tool's trust contract is "nothing leaves your browser."
 * A ~40-line, fully-auditable, zero-dependency parser keeps the supply chain empty and
 * the bundle tiny, and the Spend Report schema is simple (no embedded newlines). It still
 * honors quoted fields / escaped quotes / CRLF / BOM per RFC-4180.
 */
import type { ColumnAvailability, ParseResult, SpendRow } from './types';

/** RFC-4180-ish parse into a matrix of string cells. Tolerates quotes, "" escapes, CR/LF, BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, ''); // strip BOM
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
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
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      endField();
      i++;
      continue;
    }
    if (c === '\r') {
      // swallow \r (handle \r\n and bare \r)
      if (text[i + 1] === '\n') i++;
      endRow();
      i++;
      continue;
    }
    if (c === '\n') {
      endRow();
      i++;
      continue;
    }
    field += c;
    i++;
  }
  // flush trailing field/row (file not ending in newline)
  if (field.length > 0 || row.length > 0) endRow();

  // Drop fully-blank trailing rows.
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}

const norm = (s: string) => s.trim().toLowerCase();

/** Normalize a model_family value (or infer from the model id) to Opus/Sonnet/Haiku. */
export function normFamily(family: string, model: string): string {
  const f = norm(family);
  if (f.includes('opus')) return 'Opus';
  if (f.includes('sonnet')) return 'Sonnet';
  if (f.includes('haiku')) return 'Haiku';
  const m = norm(model);
  if (m.includes('opus')) return 'Opus';
  if (m.includes('sonnet')) return 'Sonnet';
  if (m.includes('haiku')) return 'Haiku';
  return family.trim() || 'Other';
}

const toNum = (s: string | undefined): number => {
  if (s == null) return 0;
  const v = Number(String(s).replace(/[$,\s]/g, ''));
  return Number.isFinite(v) ? v : 0;
};

/**
 * Parse a Spend Report CSV. Detects:
 *  - the WRONG file (Console export: workspace_id present, no per-person email) → redirect, not crash
 *  - degraded schema (missing/renamed optional columns) → compute what's present, label the rest
 */
export function parseSpendReport(input: string): ParseResult {
  const matrix = parseCsv(input);
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
    return {
      kind: 'error',
      detail:
        "We couldn't find an `email` column. This needs the per-person Spend Report from claude.ai → Settings → Analytics → Export Spend Report.",
    };
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

  const rows: SpendRow[] = [];
  for (let r = 1; r < matrix.length; r++) {
    const line = matrix[r];
    const email = cell(line, 'email').trim().toLowerCase();
    if (!email) continue; // skip rows without a person
    rows.push({
      email,
      account_uuid: cell(line, 'account_uuid').trim(),
      product: (cell(line, 'product').trim() || 'Unknown'),
      model: cell(line, 'model').trim(),
      model_family: normFamily(cell(line, 'model_family'), cell(line, 'model')),
      total_requests: toNum(cell(line, 'total_requests')),
      total_prompt_tokens: toNum(cell(line, 'total_prompt_tokens')),
      total_completion_tokens: toNum(cell(line, 'total_completion_tokens')),
      total_net_spend_usd: toNum(cell(line, 'total_net_spend_usd')),
      total_gross_spend_usd: toNum(cell(line, 'total_gross_spend_usd')),
    });
  }

  if (rows.length === 0) {
    return { kind: 'empty', detail: 'We parsed the file but found no per-person rows.' };
  }
  return { kind: 'ok', rows, columns, headers };
}
