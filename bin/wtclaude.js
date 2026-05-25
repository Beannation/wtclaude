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

const program = new Command();

program
  .name('wtclaude')
  .description('The first accurate Claude Code usage tracker')
  .version('0.1.0');

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

program.parse();
