#!/usr/bin/env node

import { Command } from 'commander';
import { registerToday } from '../src/cli/today.js';
import { registerWeek } from '../src/cli/week.js';
import { registerMonth } from '../src/cli/month.js';
import { registerCompare } from '../src/cli/compare.js';
import { registerWhatIf } from '../src/cli/whatif.js';
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
import { registerReadiness } from '../src/cli/readiness.js';
import { registerLeaderboard } from '../src/cli/leaderboard.js';
import { registerUninstall } from '../src/cli/uninstall.js';
import { registerExport } from '../src/cli/export.js';

const program = new Command();

program
  .name('wtclaude')
  .description('WTClaude — billing-grade cost tracking for Claude Code. Reads the statusline (the source behind your bill), not the session logs.')
  .version('0.1.2');

registerToday(program);
registerWeek(program);
registerMonth(program);
registerCompare(program);
registerWhatIf(program);
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
registerReadiness(program);
registerLeaderboard(program);
registerUninstall(program);
registerExport(program);

program.parse();
