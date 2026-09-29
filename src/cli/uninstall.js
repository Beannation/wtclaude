import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { WTCLAUDE_DIR, CONFIG_FILE, claudeSettingsPath } from '../utils/paths.js';
import { readClaudeSettings, statusLineState, writeClaudeSettings, resolveCollector } from '../utils/claude-settings.js';
import { readConfigStrict, saveConfig, isAnonymousId } from '../sync/index.js';

// `wtclaude uninstall` — the clean exit. Removes the collector from Claude Code's
// statusline (only if it's ours) and optionally deletes ~/.wtclaude/. Data
// deletion is CONFIRMED before it happens (or explicit via --purge — except on
// an install that has synced, which always needs an explicit yes: a prompt, or
// --purge --yes); --keep-data removes only the statusline hook.

// Remove the statusLine only if it is EXACTLY ours — a command that runs the
// collector and nothing else (QA-0928-47: a substring match on 'wtclaude'
// deleted a user's combined ccusage+wtclaude wrapper). Edits the settings file
// Claude Code reads, which CLAUDE_CONFIG_DIR relocates (QA-0928-46), and never
// rewrites a file it can't parse as a plain JSON object.
function removeStatusline(settingsPath) {
  const read = readClaudeSettings(settingsPath);
  if (read.state === 'absent') return { status: 'absent' };
  if (read.state === 'unreadable') return { status: 'unreadable' };
  const settings = read.settings;
  // The collector setup would point at counts as ours too (RC 2026-09-28).
  const state = statusLineState(settings, [resolveCollector().path].filter(Boolean));
  if (state === 'none') return { status: 'absent' };
  if (state === 'foreign') return { status: 'foreign' }; // not ours — leave it alone
  if (state === 'wrapped') return { status: 'wrapped', command: settings.statusLine.command };
  delete settings.statusLine;
  try { return { status: 'removed', backup: writeClaudeSettings(settingsPath, settings) }; }
  catch { return { status: 'unwritable' }; }
}

// Has this install ever synced (or tried to)? An unreadable config can't rule
// it out.
function hasSynced() {
  try {
    const c = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    return !!(c && (c.sync_enabled === true || c.last_sync_at || c.last_sync_attempt_at));
  } catch {
    return existsSync(CONFIG_FILE);
  }
}

// What config.json holds, for the warning and the save to agree on:
//   { state: 'absent' }                  no file
//   { state: 'unparsable', raw }         not JSON
//   { state: 'no-valid-id', raw }        parses, but no anonymous_id of the shape
//                                        setup writes (missing, or not a UUID)
//   { state: 'valid', raw, id }
// Only a valid id is picked out; for anything else the whole file is the
// record of the key (reviewer: a parsed config was told it "can't be read as
// JSON", and a non-UUID string was saved on its own).
function readIdentity() {
  let raw;
  try { raw = readFileSync(CONFIG_FILE, 'utf8'); } catch { return { state: 'absent' }; }
  let c;
  try { c = JSON.parse(raw); } catch { return { state: 'unparsable', raw }; }
  if (c && isAnonymousId(c.anonymous_id)) return { state: 'valid', raw, id: c.anonymous_id };
  return { state: 'no-valid-id', raw };
}

const WHOLE_FILE_REASON = {
  'unparsable': 'which can\'t be read as JSON, so the whole file is saved before deleting.',
  'no-valid-id': 'which holds no valid anonymous id, so the whole file is saved before deleting.',
};

// QA-0928-42: deleting ~/.wtclaude deletes the only copy of the anonymous id,
// which is the only key to the synced cloud copy — and uninstall doesn't delete
// that copy. Say so BEFORE the data goes. When the user is being asked to
// confirm, show the id itself (it's their own terminal) so they can keep it.
// Peter's decision: there is no private channel for a deletion request yet and
// GitHub issues are public, so nothing here points at them.
function printCloudWarning({ showId }) {
  console.log('  ! Your synced data stays in the WTClaude cloud: uninstall does not delete it,');
  console.log('    and deleting it isn\'t self-serve yet.');
  const identity = showId ? readIdentity() : { state: 'absent' };
  if (identity.state === 'valid') {
    console.log('    Its only key is this install\'s anonymous id:');
    console.log(`        ${identity.id}`);
    console.log('    Keep a private copy if you may want the cloud copy removed later, and');
    console.log('    don\'t post it anywhere public: it opens your dashboard.');
  } else if (WHOLE_FILE_REASON[identity.state]) {
    console.log('    Its only key is the anonymous id in');
    console.log(`      ${CONFIG_FILE}`);
    console.log(`    ${WHOLE_FILE_REASON[identity.state]}`);
  } else {
    console.log('    Its only key is this install\'s anonymous id, and the only copy of it is in');
    console.log(`      ${CONFIG_FILE}`);
  }
}

// Deleting the data of an install that has synced always needs an explicit
// yes (QA-0928-42), even with --purge: a prompt in a terminal, or --yes where
// there is no terminal to ask in. Returns true to delete.
async function confirmSyncedDelete(o) {
  const tty = process.stdin.isTTY;
  if (!tty && !(o.purge && o.yes)) {
    printCloudWarning({ showId: false });
    console.log('  • Kept your local data: this install has synced, so deleting it needs your');
    console.log('    confirmation. Run `wtclaude uninstall` in a terminal to see the id and');
    console.log('    confirm, or use --purge --yes (the id is shown and saved to a private file first).');
    if (o.purge) process.exitCode = 1;
    return false;
  }
  printCloudWarning({ showId: true });
  if (o.purge && o.yes) {
    console.log('  • Confirmed with --yes.');
    return true;
  }
  const ok = await confirm(`  • Delete all local data in ${WTCLAUDE_DIR} anyway? [y/N]: `);
  if (!ok) console.log(`  • Kept your local data. The id stays in ${CONFIG_FILE}.`);
  return ok;
}

// Turn sync off before deleting anything, so a delete that fails part-way (or
// a kept data dir) doesn't go on uploading. Best effort: a config that can't be
// parsed is never rewritten.
function turnSyncOff() {
  try {
    const c = readConfigStrict();
    if (c.sync_enabled !== true) return;
    c.sync_enabled = false;
    saveConfig(c);
    console.log('  • Turned cloud sync off.');
  } catch { /* unparsable or unwritable: leave it exactly as it is */ }
}

// Save the anonymous id OUTSIDE the dir a purge deletes, readable only by you
// (reviewer, QA-0928-42: telling the user to keep a copy of an id the same
// command then deletes is advice they can't follow). A valid id is kept on its
// own, not the salt or the rest of the config; any other config is copied
// whole, since no id can be picked out of it (see readIdentity). Returns
// { path, state } ('valid' = id only); throws when the file can't be read or
// written, and the caller then keeps the data.
function saveIdentity() {
  const identity = readIdentity();
  if (identity.state === 'absent') readFileSync(CONFIG_FILE, 'utf8'); // throws ENOENT
  const body = identity.state === 'valid'
    ? JSON.stringify({
      anonymous_id: identity.id,
      saved_at: new Date().toISOString(),
      note: 'Saved by `wtclaude uninstall` before deleting ~/.wtclaude: the only key to the data this install synced. Keep it private; delete this file once the cloud copy is removed.',
    }, null, 2) + '\n'
    : identity.raw;
  const path = join(homedir(), `.wtclaude-identity-${new Date().toISOString().replace(/[-:.]/g, '')}.json`);
  writeFileSync(path, body, { mode: 0o600, flag: 'wx' });
  return { path, state: identity.state };
}

async function confirm(question) {
  if (!process.stdin.isTTY) return false; // never delete data unattended without --purge
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const a = (await rl.question(question)).trim().toLowerCase();
    return a === 'y' || a === 'yes';
  } catch { return false; } finally { rl.close(); }
}

export function registerUninstall(program) {
  program
    .command('uninstall')
    .description('Remove the wtclaude statusline hook and (optionally) your local data')
    .option('--purge', 'Also delete ~/.wtclaude/ (asks first if this install has synced)')
    .option('--keep-data', 'Remove only the statusline hook; keep all local data')
    .option('-y, --yes', 'With --purge: confirm deleting a synced install\'s data without a prompt')
    .action(async (opts) => {
      const o = opts || {};
      console.log('\n  WTClaude Uninstall');
      console.log('  ==================\n');

      const settingsPath = claudeSettingsPath();
      const sl = removeStatusline(settingsPath);
      const slMsg = {
        removed: `Removed the wtclaude collector from your Claude Code statusline (${settingsPath}).`,
        absent: 'No wtclaude statusline entry found (nothing to remove).',
        foreign: 'Left your statusline alone — it points at a non-wtclaude command.',
        wrapped: `Left your statusLine alone — it wraps wtclaude inside your own command:\n      ${sl.command}\n    Remove wtclaude-collector from it by hand in ${settingsPath}.`,
        unreadable: `Could not read ${settingsPath} as plain JSON — remove the statusLine entry manually.`,
        unwritable: `Could not write ${settingsPath} — remove the statusLine entry manually.`,
      }[sl.status];
      console.log(`  • ${slMsg}`);
      if (sl.backup) console.log(`    (backup of the previous file: ${sl.backup})`);

      let deleteData = false;
      const synced = !o.keepData && hasSynced();
      if (o.keepData) {
        console.log('  • Keeping all local data in ~/.wtclaude/ (--keep-data).');
      } else if (synced) {
        deleteData = await confirmSyncedDelete(o);
      } else if (o.purge) {
        deleteData = true;
      } else if (existsSync(WTCLAUDE_DIR)) {
        deleteData = await confirm(`  • Also delete all local data in ${WTCLAUDE_DIR}? [y/N]: `);
        if (!deleteData) console.log('  • Kept your local data. (Re-run with --purge to delete it.)');
      }

      if (deleteData && synced) {
        turnSyncOff();
        try {
          const { path: saved, state } = saveIdentity();
          console.log({
            valid: `  • Saved this install's anonymous id (only) to ${saved}`,
            'unparsable': `  • Saved a copy of ${CONFIG_FILE} (the id couldn't be picked out of it) to ${saved}`,
            'no-valid-id': `  • Saved a copy of ${CONFIG_FILE} (it holds no valid anonymous id to pick out) to ${saved}`,
          }[state]);
          console.log('    (readable only by you). Keep it private; delete that file once you no');
          console.log('    longer need the cloud copy.');
        } catch (err) {
          console.log(`  • Could not save a copy of this install's anonymous id (${err.code || err.message}).`);
          console.log('    Kept your local data, so the only key to your cloud copy is not lost.');
          console.log(`    Copy ${CONFIG_FILE} somewhere private, then delete ${WTCLAUDE_DIR} yourself.`);
          process.exitCode = 1;
          deleteData = false;
        }
      }

      if (deleteData) {
        try { rmSync(WTCLAUDE_DIR, { recursive: true, force: true }); console.log(`  • Deleted ${WTCLAUDE_DIR}.`); }
        catch (err) { console.log(`  • Could not delete ${WTCLAUDE_DIR}: ${err.message}`); }
      }

      console.log('\n  Done. Thanks for trying WTClaude.');
      console.log('  Reinstall anytime with:  wtclaude setup\n');
    });
}
