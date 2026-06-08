import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir, hostname } from 'node:os';
import { execSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { ensureDataDirs } from '../utils/paths.js';
import { getConfig, saveConfig, stripLegacySecrets } from '../sync/index.js';
import { generateSalt, newId } from '../utils/hash.js';
import { getDualPoolActivationDate } from '../utils/config.js';
import { getLatestPricing } from '../utils/pricing.js';

// `wtclaude setup` (build-spec M6) — the 60-second first-run flow.
//   1. create ~/.wtclaude/ data dirs
//   2. write the v1.9 config (per-install salt + anonymous_id + device_id, plan,
//      empty cost_center_map, display_currency=USD, dual_pool_activation_date)
//      — IDEMPOTENT: existing values are kept, never clobbered or rotated
//      (rotating the salt would orphan every existing project_hash — R-14)
//   3. wire the collector into Claude Code's statusline
//   4. close with "you're capturing now" + the terminal-CLI-only caveat (D-9)

const PLAN_CHOICES = [
  { key: 'pro', label: 'Pro', price: 20 },
  { key: 'max_5x', label: 'Max 5×', price: 100 },
  { key: 'max_20x', label: 'Max 20×', price: 200 },
];

function normalizePlan(input) {
  if (!input) return null;
  const n = String(input).toLowerCase().replace(/[\s-]/g, '_').replace(/×/g, 'x');
  const map = { pro: 'pro', max: 'max_5x', max5: 'max_5x', max_5x: 'max_5x', max5x: 'max_5x', max20: 'max_20x', max_20x: 'max_20x', max20x: 'max_20x' };
  return map[n] || null;
}

function planLabel(key) {
  const p = PLAN_CHOICES.find(c => c.key === key);
  return p ? `${p.label} ($${p.price}/mo)` : key;
}

async function promptPlan(existing, opts) {
  // Non-interactive paths: explicit --plan, or no TTY / --yes → keep/skip silently.
  const flagPlan = normalizePlan(opts.plan);
  if (flagPlan) return flagPlan;
  if (opts.yes || opts.nonInteractive || !process.stdin.isTTY) return existing || null;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log('  Which Claude plan are you on?  (sets accurate limits, credits + forecasts)');
    PLAN_CHOICES.forEach((c, i) => console.log(`    ${i + 1}) ${c.label.padEnd(8)} ($${c.price}/mo)`));
    console.log('    4) Skip for now');
    const keepHint = existing ? ` [Enter = keep ${planLabel(existing)}]` : ' [Enter = skip]';
    const answer = (await rl.question(`  Choose 1-4${keepHint}: `)).trim();
    if (answer === '') return existing || null;
    const idx = parseInt(answer, 10);
    if (idx >= 1 && idx <= 3) return PLAN_CHOICES[idx - 1].key;
    return existing || null; // 4 / anything else = skip
  } catch {
    return existing || null; // never let a prompt error break setup
  } finally {
    rl.close();
  }
}

function wireStatusline() {
  let collectorPath;
  try {
    collectorPath = execSync('which wtclaude-collector', { encoding: 'utf8' }).trim();
  } catch {
    collectorPath = 'wtclaude-collector'; // not globally installed — npx/bin name
  }

  const settingsPath = join(homedir(), '.claude', 'settings.json');
  let settings = {};
  if (existsSync(settingsPath)) {
    try { settings = JSON.parse(readFileSync(settingsPath, 'utf8')); } catch { settings = {}; }
  }

  const existingCommand = settings.statusLine?.command;
  if (existingCommand && existingCommand.includes('wtclaude')) {
    return 'already';
  } else if (existingCommand) {
    console.log('         WARNING: you already have a statusline command configured:');
    console.log(`           "${existingCommand}"`);
    console.log('         To use WTClaude, set this in ~/.claude/settings.json manually:');
    console.log(`           "statusLine": { "command": "${collectorPath}" }`);
    return 'conflict';
  }
  settings.statusLine = { command: collectorPath };
  try {
    mkdirSync(dirname(settingsPath), { recursive: true }); // a fresh box may not have ~/.claude yet
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
    return 'added';
  } catch (err) {
    console.log(`         Could not write ${settingsPath}: ${err.message}`);
    console.log(`         Add manually: "statusLine": { "command": "${collectorPath}" }`);
    return 'failed';
  }
}

export function registerSetup(program) {
  program
    .command('setup')
    .description('Configure WTClaude (per-install identity + plan + the Claude Code statusline)')
    .option('--plan <plan>', 'Set plan non-interactively: pro | max5 | max20')
    .option('--yes', 'Non-interactive: accept defaults, keep existing values, no prompts')
    .option('--non-interactive', 'Alias for --yes')
    .action(async (opts) => {
      const o = opts || {};
      console.log('\n  WTClaude Setup');
      console.log('  ==============\n');

      // ── [1/4] data dirs ──
      ensureDataDirs();
      console.log('  [1/4] Created ~/.wtclaude/ data directories');

      // ── [2/4] identity + config (idempotent) ──
      const config = getConfig();
      const created = [];
      const kept = [];

      // Per-install SALT (R-14 / BUILD-025). NEVER rotate an existing salt —
      // it would orphan every project_hash already recorded.
      if (!config.edit_hash_salt) { config.edit_hash_salt = generateSalt(); created.push('per-install salt'); }
      else kept.push('salt');

      if (!config.anonymous_id) { config.anonymous_id = newId(); created.push('anonymous id'); }
      else kept.push('anonymous id');
      if (!config.user_identifier) config.user_identifier = config.anonymous_id;

      if (!config.device_id) { config.device_id = newId(); created.push('device id'); }
      else kept.push('device id');
      if (!config.device_label) config.device_label = hostname() || 'this-device';

      if (config.cost_center_map == null) config.cost_center_map = {};
      if (!config.display_currency) config.display_currency = 'USD';

      // QA-BUG-08: strip any disabled legacy service/secret key left in config.
      const strippedSecrets = stripLegacySecrets(config);
      if (!config.dual_pool_activation_date) {
        config.dual_pool_activation_date = (getLatestPricing().dual_pool_activation_date) || getDualPoolActivationDate();
      }

      console.log(`  [2/4] Wrote per-install config${created.length ? ` (new: ${created.join(', ')})` : ''}`);
      console.log('         · salt + ids are random per install — your project hashes are');
      console.log('           one-way and never correlatable with anyone else (no paths stored).');
      if (kept.length) console.log(`         · kept existing ${kept.join(', ')} (setup is safe to re-run).`);
      if (strippedSecrets.length) console.log(`         · removed a disabled legacy secret key (${strippedSecrets.join(', ')}) — the CLI never needs it.`);

      // ── [3/4] plan ──
      const before = config.plan || null;
      const chosen = await promptPlan(before, o);
      if (chosen) config.plan = chosen;
      if (chosen) console.log(`  [3/4] Plan: ${planLabel(chosen)}${before && before !== chosen ? ` (changed from ${planLabel(before)})` : ''}`);
      else console.log('  [3/4] Plan: not set — limits/forecasts stay generic until you set one');

      saveConfig(config);

      // ── [4/4] statusline ──
      const status = wireStatusline();
      if (status === 'already') console.log('  [4/4] Claude Code statusline already points at wtclaude');
      else if (status === 'added') console.log('  [4/4] Added the wtclaude collector to your Claude Code statusline');
      else console.log('  [4/4] Statusline not auto-configured (see note above)');

      // ── closer ──
      console.log('');
      console.log('  ✓ You\'re all set — and capturing starts now.');
      console.log('');
      console.log('  Next:');
      console.log('    1. Start (or continue) a Claude Code session in your terminal');
      console.log('    2. Take one turn, then run:  wtclaude today');
      console.log('    3. See how off your old tracker was:  wtclaude compare');
      console.log('');
      console.log('  Note: capture runs in the terminal CLI only — the desktop app and');
      console.log('  Cowork don\'t emit the statusline, so those turns aren\'t tracked yet.');
      if (!chosen) console.log('  Tip: set your plan anytime with  wtclaude setup --plan pro|max5|max20');
      console.log('');
    });
}
