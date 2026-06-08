// Cold-start / first-run UX (FEAT-018). A brand-new user with no captured turns
// should never hit a bare "no data" screen — branch on whether `setup` has run
// and tell them exactly what to do next. Honest: no fabricated numbers.

import { loadConfig } from './config.js';
import { listSessions } from './sessions.js';

// Setup is "complete enough" once the per-install salt exists (BUILD-025).
export function setupComplete(config = loadConfig()) {
  return !!(config && config.edit_hash_salt);
}

export function hasAnyData() {
  return listSessions().some(id => id);
}

// Friendly lines for an empty read command. `what` is the human range label.
export function coldStartLines(what) {
  const lines = [`\n  No usage data for ${what} yet.`];
  if (!setupComplete()) {
    lines.push('');
    lines.push('  Looks like a fresh install. Run setup first:');
    lines.push('    wtclaude setup');
    lines.push('  It takes ~60s — wires the collector into Claude Code and starts capture.');
  } else {
    lines.push('');
    lines.push('  You\'re set up and capturing. Take a turn in a Claude Code terminal');
    lines.push('  session, then run this again — your first turn will show up here.');
    lines.push('  (Capture is terminal-CLI only; the desktop app/Cowork aren\'t tracked.)');
  }
  lines.push('');
  return lines;
}

export function coldStartMessage(what) {
  return coldStartLines(what).join('\n');
}
