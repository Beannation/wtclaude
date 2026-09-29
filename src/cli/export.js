import { openSync, fstatSync, fchmodSync, writeFileSync, closeSync } from 'node:fs';
import { listSessions, readSession, getUnreadableLines } from '../utils/sessions.js';
import { readConfigStrict, ConfigError } from '../sync/index.js';

// `wtclaude export` — dump everything wtclaude holds locally about you, in one
// JSON bundle (good-faith privacy posture; pairs with anonymous-by-default). The
// records hold counts, flags, model ids, timestamps, tool names and salted
// project hashes, plus git branch names and cost-center labels as captured (sync
// hashes branches; local data keeps them raw). No prompts, code or paths.
//
// QA-0928-06: identifiers that grant access or undo the hashing are redacted so
// a shared export can't leak them: the anonymous id (the key to the cloud row
// and dashboard; user_identifier is the same value and is dropped from every
// record), the hash salt (it would let anyone confirm a guessed project path
// against project_hash), the invite code, and any key/secret/token-like field.

const REDACT_KEYS = ['anonymous_id', 'user_identifier', 'edit_hash_salt', 'invite_code'];
const KEY_LIKE = /key|secret|token|password|salt/i;

function sanitizeConfig(config) {
  const out = { ...config };
  const redacted = [];
  for (const k of Object.keys(out)) {
    if (REDACT_KEYS.includes(k) || KEY_LIKE.test(k)) {
      out[k] = '[redacted]';
      redacted.push(k);
    }
  }
  return { config: out, redacted };
}

function stripIdentifier(turn) {
  if (!('user_identifier' in turn)) return turn;
  const { user_identifier: _drop, ...rest } = turn;
  return rest;
}

export function registerExport(program) {
  program
    .command('export')
    .description('Dump all local wtclaude data to JSON (everything we store about you)')
    .option('--out <file>', 'Write to a file instead of stdout')
    .option('--pretty', 'Pretty-print the JSON')
    .action((opts) => {
      const o = opts || {};
      const sessions = listSessions()
        .map(id => ({ session_id: id, turns: readSession(id).map(stripIdentifier) }))
        .filter(s => s.turns.length > 0);

      let config = null, redacted = [], configNote = '';
      try {
        ({ config, redacted } = sanitizeConfig(readConfigStrict()));
      } catch (err) {
        if (!(err instanceof ConfigError)) throw err;
        configNote = ' config.json could not be read (not valid JSON), so it is left out.';
      }

      // RC 2026-09-28: a damaged session line is left out — and the bundle
      // that is "everything we store about you" says so.
      const skipped = getUnreadableLines();
      const skippedNote = skipped.lines > 0
        ? ` ${skipped.lines} damaged line${skipped.lines === 1 ? '' : 's'} in ${skipped.files.length} session file${skipped.files.length === 1 ? '' : 's'} could not be read and ${skipped.lines === 1 ? 'is' : 'are'} left out.`
        : '';
      const bundle = {
        exported_at: new Date().toISOString(),
        tool: 'wtclaude',
        note: 'Local data only. Records hold token and cost counts, model ids, timestamps, flags, tool names, '
          + 'salted project hashes, and your git branch names and cost-center labels as captured (not hashed '
          + 'locally). No prompts, code, file contents or folder paths. '
          + (redacted.length ? `Redacted from config: ${redacted.join(', ')}. ` : '')
          + 'user_identifier (your anonymous id) is removed from every record.' + configNote + skippedNote,
        config,
        session_count: sessions.length,
        turn_count: sessions.reduce((n, s) => n + s.turns.length, 0),
        skipped_lines: skipped.lines,
        sessions,
      };

      const json = JSON.stringify(bundle, null, o.pretty ? 2 : 0);
      if (o.out) {
        // QA-0928-66: a bad path is one clean line, not a stack trace. 0600: the
        // bundle is your full usage history. The mode only applies to a NEW file,
        // so an existing one is tightened before the data goes in (a regular file
        // only: never chmod a device such as /dev/stdout).
        let fd;
        try {
          fd = openSync(o.out, 'w', 0o600);
          if (fstatSync(fd).isFile()) {
            try { fchmodSync(fd, 0o600); } catch { /* not ours to chmod; still write where asked */ }
          }
          writeFileSync(fd, json + '\n');
        } catch (err) {
          const why = { ENOENT: 'no such directory', EACCES: 'permission denied', EISDIR: 'that is a directory', ENOTDIR: 'a parent is not a directory' }[err.code] || err.code || err.message;
          console.error(`\n  Can't write ${o.out}: ${why}.\n`);
          process.exitCode = 1;
          return;
        } finally {
          if (fd !== undefined) closeSync(fd);
        }
        console.log(`\n  Exported ${bundle.session_count} session(s) / ${bundle.turn_count} turn(s) to ${o.out}\n`);
      } else {
        console.log(json);
      }
    });
}
