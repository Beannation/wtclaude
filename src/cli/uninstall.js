import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { WTCLAUDE_DIR } from '../utils/paths.js';

// `wtclaude uninstall` — the clean exit. Removes the collector from Claude Code's
// statusline (only if it's ours) and optionally deletes ~/.wtclaude/. Data
// deletion is CONFIRMED before it happens (or explicit via --purge); --keep-data
// removes only the statusline hook.

function removeStatusline() {
  const settingsPath = join(homedir(), '.claude', 'settings.json');
  if (!existsSync(settingsPath)) return 'absent';
  let settings;
  try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { return 'unreadable'; }
  const cmd = settings.statusLine?.command;
  if (!cmd) return 'absent';
  if (!cmd.includes('wtclaude')) return 'foreign'; // not ours — leave it alone
  delete settings.statusLine;
  try { writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n'); return 'removed'; }
  catch { return 'unwritable'; }
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
    .option('--purge', 'Also delete ~/.wtclaude/ without prompting')
    .option('--keep-data', 'Remove only the statusline hook; keep all local data')
    .action(async (opts) => {
      const o = opts || {};
      console.log('\n  WTClaude Uninstall');
      console.log('  ==================\n');

      const sl = removeStatusline();
      const slMsg = {
        removed: 'Removed the wtclaude collector from your Claude Code statusline.',
        absent: 'No wtclaude statusline entry found (nothing to remove).',
        foreign: 'Left your statusline alone — it points at a non-wtclaude command.',
        unreadable: 'Could not read ~/.claude/settings.json — remove the statusLine entry manually.',
        unwritable: 'Could not write ~/.claude/settings.json — remove the statusLine entry manually.',
      }[sl];
      console.log(`  • ${slMsg}`);

      let deleteData = false;
      if (o.keepData) {
        console.log('  • Keeping all local data in ~/.wtclaude/ (--keep-data).');
      } else if (o.purge) {
        deleteData = true;
      } else if (existsSync(WTCLAUDE_DIR)) {
        deleteData = await confirm(`  • Also delete all local data in ${WTCLAUDE_DIR}? [y/N]: `);
        if (!deleteData) console.log('  • Kept your local data. (Re-run with --purge to delete it.)');
      }

      if (deleteData) {
        try { rmSync(WTCLAUDE_DIR, { recursive: true, force: true }); console.log(`  • Deleted ${WTCLAUDE_DIR}.`); }
        catch (err) { console.log(`  • Could not delete ${WTCLAUDE_DIR}: ${err.message}`); }
      }

      console.log('\n  Done. Thanks for trying WTClaude.');
      console.log('  Reinstall anytime with:  wtclaude setup\n');
    });
}
