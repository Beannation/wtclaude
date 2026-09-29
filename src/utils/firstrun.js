// Cold-start / first-run UX (FEAT-018). A brand-new user with no captured turns
// should never hit a bare "no data" screen — branch on whether `setup` has run
// and tell them exactly what to do next. Honest: no fabricated numbers.

import { loadConfig } from './config.js';
import { listSessions } from './sessions.js';
import { collectorWiring } from './claude-settings.js';
import { readConfigStrict, ConfigError, markConfigProblemShown, configProblemWasShown } from '../sync/index.js';

// Setup is "complete enough" once the per-install salt exists (BUILD-025).
export function setupComplete(config = loadConfig()) {
  return !!(config && config.edit_hash_salt);
}

// QA-0928-07: a config.json that exists but can't be read or parsed is not a
// fresh install — it holds the install's ids, and "run setup" is the advice
// that would replace them. Returns the one-line ConfigError message (file,
// line/column, what to do), or null when the config is fine or simply absent.
export function configProblem() {
  try {
    readConfigStrict();
    return null;
  } catch (err) {
    if (err instanceof ConfigError) return err.message;
    throw err;
  }
}

// RC 2026-09-28: the one-line warning a read command prints (stderr, once)
// when config.json can't be read. Read commands keep working on the local data
// — without the plan, display currency or sync settings in that file — and the
// file is never rewritten. null when the config is fine or absent, or when this
// process already showed the problem.
export function configWarning() {
  if (configProblemWasShown()) return null;
  const problem = configProblem();
  if (!problem) return null;
  const what = problem.split('. ')[0];
  return `  ! ${what} — showing your data without it (plan, display currency and sync are off until it is fixed). Fix the file or restore a backup; wtclaude won't overwrite it.`;
}

export function hasAnyData() {
  return listSessions().some(id => id);
}

// Friendly lines for an empty read command. `what` is the human range label.
export function coldStartLines(what) {
  const lines = [`\n  No usage data for ${what} yet.`];
  const problem = configProblem();
  if (problem) {
    markConfigProblemShown();
    lines.push('');
    lines.push(`  ${problem}`);
  } else if (!setupComplete()) {
    lines.push('');
    lines.push('  Looks like a fresh install. Run setup first:');
    lines.push('    wtclaude setup');
    lines.push('  It takes ~60s — wires the collector into Claude Code and starts capture.');
  } else {
    // "Set up" is not "capturing" (QA-0928-45): Claude Code only runs the
    // collector when the settings file it reads (CLAUDE_CONFIG_DIR-aware) has
    // our statusLine WITH "type": "command".
    const { state, settingsPath, command } = collectorWiring();
    lines.push('');
    if (state === 'ours') {
      lines.push('  You\'re set up and capturing. Take a turn in a Claude Code terminal');
      lines.push('  session, then run this again — your first turn will show up here.');
    } else if (state === 'wrapped') {
      lines.push('  You\'re set up. Your statusLine is your own command that mentions wtclaude;');
      lines.push('  capture works only if it passes Claude Code\'s JSON to wtclaude-collector.');
    } else {
      const why = {
        'ours-untyped': 'its statusLine entry lacks "type": "command", so Claude Code never runs it',
        // QA-0928-44: a bare name that isn't on PATH, or a path that is gone.
        'ours-unrunnable': command && !/[\\/]/.test(command)
          ? `its statusLine runs ${command}, which is not on your PATH`
          : 'its statusLine points at a collector that is missing or not executable',
        unreadable: 'it could not be read as plain JSON',
        foreign: 'its statusLine runs a different command',
        none: 'it has no statusLine entry',
      }[state] || 'it has no statusLine entry';
      lines.push('  You\'re set up, but the collector is not wired into Claude Code yet, so');
      lines.push('  nothing is being captured:');
      lines.push(`    ${settingsPath} — ${why}.`);
      lines.push('  Run  wtclaude setup  to wire it (it prints the exact entry if it can\'t).');
    }
    lines.push('  (Capture is terminal-CLI only; the desktop app/Cowork aren\'t tracked.)');
  }
  lines.push('');
  return lines;
}

export function coldStartMessage(what) {
  return coldStartLines(what).join('\n');
}
