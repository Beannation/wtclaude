// --csv / --clipboard formatters (build-spec M4: "a formatter over --json").
// CSV is a thin, dependency-free serializer; clipboard shells out per platform
// and fails soft (returns false) so an export convenience never breaks a command.

import { spawnSync } from 'node:child_process';

function escapeCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// rows: array of objects. columns: [{ key, label }] (label optional).
export function toCSV(rows, columns) {
  const cols = columns || (rows[0] ? Object.keys(rows[0]).map(k => ({ key: k })) : []);
  const header = cols.map(c => escapeCell(c.label || c.key)).join(',');
  const body = rows.map(r => cols.map(c => escapeCell(r[c.key])).join(',')).join('\n');
  return body ? `${header}\n${body}` : header;
}

// Copy text to the OS clipboard. Returns true on success, false on any failure
// (no clipboard tool, non-zero exit, error). Never throws.
export function copyToClipboard(text) {
  const candidates = process.platform === 'darwin'
    ? [['pbcopy', []]]
    : process.platform === 'win32'
      ? [['clip', []]]
      : [['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']], ['wl-copy', []]];
  for (const [cmd, args] of candidates) {
    try {
      const res = spawnSync(cmd, args, { input: text });
      if (!res.error && res.status === 0) return true;
    } catch {
      // try next candidate
    }
  }
  return false;
}
