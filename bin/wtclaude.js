#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { registerToday } from '../src/cli/today.js';
import { registerWeek } from '../src/cli/week.js';
import { registerMonth } from '../src/cli/month.js';
import { registerCompare } from '../src/cli/compare.js';
import { registerWhatIf } from '../src/cli/whatif.js';
import { registerCompareModels } from '../src/cli/compare-models.js';
import { registerDebrief } from '../src/cli/debrief.js';
import { registerSetup } from '../src/cli/setup.js';
import { registerInvite } from '../src/cli/invite.js';
import { registerSync } from '../src/cli/sync.js';
import { registerBadges } from '../src/cli/badges.js';
import { registerShare } from '../src/cli/share.js';
import { registerDashboard } from '../src/cli/dashboard.js';
import { registerLimit } from '../src/cli/limit.js';
import { registerSession } from '../src/cli/session.js';
import { registerBlocks } from '../src/cli/blocks.js';
import { registerStatusline } from '../src/cli/statusline.js';
import { registerWatch } from '../src/cli/watch.js';
import { registerProject } from '../src/cli/project.js';
import { registerTasks } from '../src/cli/tasks.js';
import { registerQuality } from '../src/cli/quality.js';
import { registerDevices } from '../src/cli/devices.js';
import { registerReport } from '../src/cli/report.js';
import { registerCredits } from '../src/cli/credits.js';
import { registerForecast } from '../src/cli/forecast.js';
import { registerFable } from '../src/cli/fable.js';
import { registerWaste } from '../src/cli/waste.js';
import { registerReadiness } from '../src/cli/readiness.js';
import { registerLeaderboard } from '../src/cli/leaderboard.js';
import { registerUninstall } from '../src/cli/uninstall.js';
import { registerExport } from '../src/cli/export.js';
import { maybeBackgroundSync } from '../src/sync/autosync.js';
import { pendingUnreadableNote } from '../src/utils/sessions.js';
import { configWarning } from '../src/utils/firstrun.js';

const program = new Command();

// Read the version from package.json so `--version` can never drift from the
// published version again (it was hardcoded and silently left at 0.1.2 while the
// package shipped 0.1.3 — a launch-day support footgun: users verify the fix by
// running --version).
const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
);

program
  .name('wtclaude')
  .description('WTClaude — billing-grade cost tracking for Claude Code. Reads the statusline (the source behind your bill), not the session logs.')
  .version(pkg.version);

registerToday(program);
registerWeek(program);
registerMonth(program);
registerCompare(program);
registerWhatIf(program);
registerCompareModels(program);
registerDebrief(program);
registerSetup(program);
registerInvite(program);
registerSync(program);
registerBadges(program);
registerShare(program);
registerDashboard(program);
registerLimit(program);
registerSession(program);
registerBlocks(program);
registerStatusline(program);
registerWatch(program);
registerProject(program);
registerTasks(program);
registerQuality(program);
registerDevices(program);
registerReport(program);
registerCredits(program);
registerForecast(program);
registerFable(program);
registerWaste(program);
registerReadiness(program);
registerLeaderboard(program);
registerUninstall(program);
registerExport(program);

// A session line the reads had to skip is named by every read command
// (QA-0928-14; RC 2026-09-28: only some did). Commands that print the note
// themselves are not repeated; it goes to stderr so --json/--csv stay clean.
// Not after `statusline` (Claude Code's status line), `watch` (a live screen)
// or the commands that write settings.
const NO_READ_NOTE = new Set(['statusline', 'watch', 'setup', 'uninstall']);
program.hook('postAction', (_root, actionCommand) => {
  if (NO_READ_NOTE.has(actionCommand.name())) return;
  const note = pendingUnreadableNote();
  if (note) console.error(note);
  // A config.json that doesn't parse (RC 2026-09-28): read commands keep
  // working on the local data and say so once, on stderr. Commands that would
  // write it refuse and name it themselves (withConfigGuard, setup); the
  // cold-start copy names it too — neither is repeated here.
  const warning = configWarning();
  if (warning) console.error(warning);
});

// Opportunistic, fully-detached background push — only when the user has opted
// in (`sync --enable`) and local data has changed since the last sync. Debounced
// and non-blocking; a no-op for everyone else. Never runs on the collector path.
maybeBackgroundSync(process.argv, program.commands.map((c) => c.name()));

program.parse();
