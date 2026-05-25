import { checkBadges, getAllBadgeDefinitions } from '../badges/check.js';

export function registerBadges(program) {
  program
    .command('badges')
    .description('Show your earned badges')
    .action(() => {
      const earned = checkBadges();
      const all = getAllBadgeDefinitions();
      const earnedTypes = new Set(earned.map(b => b.type));

      console.log('\n  Badges');
      console.log('  ======\n');

      for (const badge of all) {
        const icon = earnedTypes.has(badge.type) ? '[x]' : '[ ]';
        console.log(`  ${icon} ${badge.label} — ${badge.description}`);
      }

      console.log(`\n  ${earned.length}/${all.length} earned\n`);
    });
}
