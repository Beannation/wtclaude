// Reading Claude Code's settings.json and recognising OUR statusLine entry.
// Shared by `setup` (wire / repair), `uninstall` (remove only ours) and the
// cold-start hints (is capture actually wired?). The one writer,
// writeClaudeSettings(), always takes a backup of an existing file first.

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, unlinkSync, statSync, accessSync, realpathSync, constants as fsConstants } from 'node:fs';
import { join, dirname, delimiter, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { claudeSettingsPath } from './paths.js';

// This package's own collector script (what the `wtclaude-collector` bin runs).
export const OWN_COLLECTOR = fileURLToPath(new URL('../collector/index.js', import.meta.url));

// This package's version, for telling an older collector on PATH apart.
export const OWN_VERSION = (() => {
  try { return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version || null; } catch { return null; }
})();

// The wtclaude version a collector path belongs to (RC 2026-09-28): follow
// symlinks to the real file (a global install's bin entry links into
// lib/node_modules/wtclaude/src/collector/index.js) and read the nearest
// wtclaude package.json above it. null when it can't be told.
export function collectorVersion(p) {
  if (!p) return null;
  let dir;
  try { dir = dirname(realpathSync(p)); } catch { return null; }
  for (let i = 0; i < 5; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
      if (pkg && pkg.name === 'wtclaude') return typeof pkg.version === 'string' ? pkg.version : null;
    } catch { /* no package.json here */ }
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

// Is version `a` older than `b`? Numeric x.y.z; anything unparsable is not.
export function isOlderVersion(a, b) {
  const parse = (v) => (/^(\d+)\.(\d+)\.(\d+)/.exec(String(v || '')) || []).slice(1).map(Number);
  const x = parse(a), y = parse(b);
  if (x.length !== 3 || y.length !== 3) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i];
  return false;
}

// npx runs a package out of ~/.npm/_npx/<hash>/…, a cache npm may prune at any
// time and that is pinned to one version (QA-0928-44).
export function isNpxPath(p) {
  return typeof p === 'string' && /[\\/]_npx[\\/]/.test(p);
}

// Claude Code runs statusLine.command through a shell (statusline docs: "The
// `command` field runs in a shell"), so a path with a space or any shell
// metacharacter must be quoted or it breaks with exit 127 (QA-0928-44).
export function shellQuote(p) {
  return /^[A-Za-z0-9_\/.,:+@%=-]+$/.test(p) ? p : `'${String(p).replace(/'/g, `'\\''`)}'`;
}

// Parse a command as ONE POSIX shell word, the way /bin/sh would: single
// quotes (everything literal, including the '\'' escape shellQuote writes for
// an apostrophe), double quotes (literal but for \" \\ \$ \`), and backslash
// escapes. Returns { word, quoted } — `quoted` when any quoting or escaping was
// used — or null when the command is not a single plain word: several words,
// an unquoted metacharacter (| ; & < > ( ) $ `), or an expansion inside
// double quotes (RC 2026-09-28).
export function parseShellWord(cmd) {
  const s = String(cmd).trim();
  if (!s) return null;
  let word = '', quoted = false, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end === -1) return null;                    // unterminated
      word += s.slice(i + 1, end); quoted = true; i = end + 1;
    } else if (c === '"') {
      i++; quoted = true;
      for (;;) {
        if (i >= s.length) return null;               // unterminated
        const d = s[i];
        if (d === '"') { i++; break; }
        if (d === '$' || d === '`') return null;      // an expansion: not a plain path
        if (d === '\\' && i + 1 < s.length && '"\\$`'.includes(s[i + 1])) { word += s[i + 1]; i += 2; continue; }
        word += d; i++;
      }
    } else if (c === '\\') {
      if (i + 1 >= s.length) return null;
      word += s[i + 1]; quoted = true; i += 2;
    } else if (/\s/.test(c) || /[|;&<>()$`\n]/.test(c)) {
      return null;                                    // a second word or shell syntax
    } else {
      word += c; i++;
    }
  }
  return { word, quoted };
}

// The command with its shell quoting removed, when it is a single word; else
// the trimmed command itself.
export function unquoteCommand(cmd) {
  const w = parseShellWord(cmd);
  return w ? w.word : String(cmd).trim();
}

function isFile(p) {
  try { return statSync(p).isFile(); } catch { return false; }
}
function isExecutableFile(p) {
  try { accessSync(p, fsConstants.X_OK); return statSync(p).isFile(); } catch { return false; }
}

// The path /bin/sh would run for a single-path command: one layer of quotes
// removed, and an unquoted leading ~/ expanded (a quoted one isn't).
export function shellPath(cmd) {
  const w = parseShellWord(cmd);
  const p = w ? w.word : String(cmd).trim();
  const quoted = w ? w.quoted : false;
  return !quoted && p.startsWith('~/') ? join(homedir(), p.slice(2)) : p;
}

// Is this statusLine command OURS — i.e. does it run the collector and nothing
// else? Only then may setup repair it or uninstall delete it (QA-0928-47: a
// substring match on 'wtclaude' deleted a user's combined ccusage+wtclaude
// wrapper). Ours: a single path (quoted or not) whose last segment is
// `wtclaude-collector`, a path to a wtclaude package's src/collector/index.js,
// or one of `ownPaths` (the path setup itself would write). An UNQUOTED command
// with whitespace is a program plus arguments (`bash …/wtclaude-collector`,
// `multi-status …/wtclaude-collector`), unless the whole string is an existing
// file: the legacy unquoted path with a space, which setup repairs by quoting.
//
// FIXED 2026-09-28 (RC): the metacharacter test ran on the contents of a
// single-quoted word, where ( ) & $ ; are literal, and the '\'' form shellQuote
// writes for an apostrophe couldn't be unquoted — so an install path holding
// any of them made setup call its own entry a wrapper and uninstall refuse it.
// The command is now parsed as one shell word (parseShellWord); shell syntax
// only counts outside quotes.
export function isOwnCollectorCommand(cmd, ownPaths = []) {
  if (typeof cmd !== 'string' || !cmd.trim()) return false;
  const own = [...ownPaths, OWN_COLLECTOR].filter(Boolean);
  if (own.some((q) => cmd.trim() === shellQuote(q))) return true;
  const w = parseShellWord(cmd);
  let p;
  if (w) p = w.word;
  else if (/\s/.test(cmd.trim()) && !/['"|;&<>`$()\n\\]/.test(cmd) && isFile(cmd.trim())) p = cmd.trim(); // legacy unquoted path with a space
  else return false;                                  // a pipeline, wrapper or compound command
  if (!w && !isFile(p)) return false;
  if (own.includes(p)) return true;
  const segs = p.split(/[\\/]/);
  if (segs[segs.length - 1] === 'wtclaude-collector') return true;
  return /(^|[\\/])wtclaude[\\/]src[\\/]collector[\\/]index\.js$/.test(p);
}

// Parse settings.json WITHOUT ever guessing (QA-0928-11). Anything but a plain
// JSON object — comments/trailing commas (JSONC), a byte-order mark, a
// truncated or empty file, a null/array/scalar top level — is 'unreadable',
// and callers must leave the file byte-identical and tell the user what to add.
// Returns { state: 'absent' | 'ok' | 'unreadable', settings?, reason?, kind? };
// `kind` (RC 2026-09-28) says why: 'io' | 'bom' | 'empty' | 'jsonc' (any other
// parse failure) | 'non-object', so a file with no top-level { } is not told to
// "add this inside its top-level { … }".
export function readClaudeSettings(path = claudeSettingsPath()) {
  if (!existsSync(path)) return { state: 'absent', settings: {} };
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (err) { return { state: 'unreadable', kind: 'io', reason: `it can't be read (${err.code || err.message})` }; }
  if (raw.charCodeAt(0) === 0xfeff) return { state: 'unreadable', kind: 'bom', reason: 'it starts with a byte-order mark' };
  if (!raw.trim()) return { state: 'unreadable', kind: 'empty', reason: 'it is empty' };
  let settings;
  try { settings = JSON.parse(raw); } catch (err) { return { state: 'unreadable', kind: 'jsonc', reason: `it isn't plain JSON: ${err.message}` }; }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return { state: 'unreadable', kind: 'non-object', reason: 'its top level is not a JSON object' };
  }
  return { state: 'ok', settings };
}

// What the settings' statusLine is, from our point of view:
//   'none'         — no statusLine
//   'ours'         — runs the collector, with "type": "command" (Claude Code runs it)
//   'ours-untyped' — runs the collector but lacks "type": "command", so Claude
//                    Code never runs it (QA-0928-10: every tag v0.1.3–0.3.1 wrote this)
//   'wrapped'      — a custom command that mentions wtclaude (a wrapper); not ours
//   'foreign'      — someone else's statusLine
export function statusLineState(settings, ownPaths = []) {
  const sl = settings && settings.statusLine;
  if (sl == null) return 'none';
  if (typeof sl !== 'object' || Array.isArray(sl)) return 'foreign';
  if (isOwnCollectorCommand(sl.command, ownPaths)) return sl.type === 'command' ? 'ours' : 'ours-untyped';
  return typeof sl.command === 'string' && /wtclaude/i.test(sl.command) ? 'wrapped' : 'foreign';
}

// Can /bin/sh actually run this (own) statusLine command? A bare
// `wtclaude-collector` is looked up on PATH, so it runs only when a stable one
// is there (`collector.source === 'path'`; an npx cache dir on PATH during a
// `npx wtclaude` run is not on Claude Code's PATH). A path must be an
// executable file outside the npx cache; a relative one depends on whatever
// cwd Claude Code has, so it doesn't count (QA-0928-44).
export function ownCommandRunnable(cmd, collector = resolveCollector()) {
  const p = shellPath(cmd);
  if (!/[\\/]/.test(p)) return collector.source === 'path';
  return isAbsolute(p) && !isNpxPath(p) && isExecutableFile(p);
}

// An own entry pinned to an executable collector inside the npx cache: it runs
// today, but npm may prune it (RC 2026-09-28: setup said "nothing is being
// captured" while it was capturing).
export function npxPinnedRunnable(cmd) {
  const p = shellPath(cmd);
  return isAbsolute(p) && isNpxPath(p) && isExecutableFile(p);
}

// The file a (single-word) statusLine command runs: the path itself, or the
// PATH hit for a bare name. null when it can't be told.
export function commandTarget(cmd, collector = resolveCollector()) {
  const p = shellPath(cmd);
  if (!/[\\/]/.test(p)) return collector.source === 'path' ? collector.path : null;
  return isAbsolute(p) ? p : null;
}

// Find a STABLE collector to point the statusLine at:
//   1. an executable `wtclaude-collector` on PATH, skipping npx cache dirs and
//      relative entries (a global install) → source 'path';
//   2. else, if this copy runs from the npx cache → { path: null, source: 'npx' }:
//      pinning it would silently break when npm prunes the cache;
//   3. else this package's own collector script (a clone or local install)
//      → source 'package'; setup says so rather than pinning it silently.
export function resolveCollector(env = process.env) {
  for (const dir of String(env.PATH || '').split(delimiter)) {
    if (!dir || !isAbsolute(dir) || isNpxPath(dir)) continue;
    const p = join(dir, 'wtclaude-collector');
    if (isExecutableFile(p)) return { path: p, source: 'path' };
  }
  if (isNpxPath(OWN_COLLECTOR)) return { path: null, source: 'npx' };
  return { path: OWN_COLLECTOR, source: 'package' };
}

// Is capture wired in the settings file Claude Code actually reads
// (CLAUDE_CONFIG_DIR-aware)? For the cold-start hints (QA-0928-45).
// Returns { state, settingsPath, command } with state = a statusLineState()
// value, 'unreadable', or 'ours-unrunnable' (typed and ours, but /bin/sh can't
// run it: a bare name not on PATH, a missing path — QA-0928-44).
export function collectorWiring() {
  const settingsPath = claudeSettingsPath();
  const read = readClaudeSettings(settingsPath);
  if (read.state === 'unreadable') return { state: 'unreadable', settingsPath };
  const collector = resolveCollector();
  const state = statusLineState(read.settings, [collector.path].filter(Boolean));
  const command = state === 'ours' ? read.settings.statusLine.command : undefined;
  if (state === 'ours' && !ownCommandRunnable(command, collector)) return { state: 'ours-unrunnable', settingsPath, command };
  return { state, settingsPath, command };
}

// Write settings.json, copying an existing file to
// settings.json.wtclaude-backup-<timestamp> first (QA-0928-11: "any write is
// preceded by a backup"). Returns the backup path (null for a new file); on a
// failed write the backup is removed again and the error is thrown.
export function writeClaudeSettings(settingsPath, settings) {
  let backup = null;
  try {
    mkdirSync(dirname(settingsPath), { recursive: true }); // a fresh box may not have ~/.claude yet
    if (existsSync(settingsPath)) {
      backup = `${settingsPath}.wtclaude-backup-${new Date().toISOString().replace(/[-:.]/g, '')}`;
      copyFileSync(settingsPath, backup);
    }
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    return backup;
  } catch (err) {
    if (backup) { try { unlinkSync(backup); } catch { /* best effort */ } }
    throw err;
  }
}
