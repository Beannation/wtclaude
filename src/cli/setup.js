import { existsSync, readFileSync, chmodSync } from 'node:fs';
import { hostname } from 'node:os';
import { createInterface } from 'node:readline/promises';
import { ensureDataDirs, claudeSettingsPath, WTCLAUDE_DIR, CONFIG_FILE } from '../utils/paths.js';
import { getConfig, saveConfig, stripLegacySecrets } from '../sync/index.js';
import { generateSalt, newId } from '../utils/hash.js';
import { getDualPoolActivationDate } from '../utils/config.js';
import { getLatestPricing } from '../utils/pricing.js';
import {
  OWN_COLLECTOR, OWN_VERSION, shellQuote, shellPath, unquoteCommand, isOwnCollectorCommand, ownCommandRunnable,
  readClaudeSettings, statusLineState, resolveCollector, writeClaudeSettings,
  npxPinnedRunnable, commandTarget, collectorVersion, isOlderVersion,
} from '../utils/claude-settings.js';

// `wtclaude setup` (build-spec M6) — the 60-second first-run flow.
//   1. create ~/.wtclaude/ data dirs
//   2. write the v1.9 config (per-install salt + anonymous_id + device_id, plan,
//      empty cost_center_map, display_currency=USD, dual_pool_activation_date)
//      — IDEMPOTENT: existing values are kept, never clobbered or rotated
//      (rotating the salt would orphan every existing project_hash — R-14)
//   3. wire the collector into Claude Code's statusline ({ type: 'command' },
//      in the CLAUDE_CONFIG_DIR-aware settings file; never clobbering a file
//      it can't parse, never pinning the npx cache)
//   4. close with "you're capturing now" — ONLY when the statusLine now runs
//      the collector — + the terminal-CLI-only caveat (D-9)

// Every plan the rate sheet's Fable plan rows know (QA-0928-170): Fable bills
// differently on Team/Enterprise Standard vs Premium seats, so those users need
// to be able to record their seat type. Labels and prices come from the sheet's
// `plans` block (Enterprise is usage-based, so it has no price there).
const PLAN_KEYS = ['pro', 'max_5x', 'max_20x', 'team_standard', 'team_premium', 'enterprise_standard', 'enterprise_premium'];
const PLAN_FLAG_HINT = 'pro | max5 | max20 | team_standard | team_premium | enterprise_standard | enterprise_premium';
const PLAN_FALLBACK_LABELS = { enterprise_standard: 'Enterprise Standard', enterprise_premium: 'Enterprise Premium' };

function normalizePlan(input) {
  if (!input) return null;
  const n = String(input).toLowerCase().trim().replace(/[\s-]/g, '_').replace(/×/g, 'x');
  const map = {
    pro: 'pro',
    max: 'max_5x', max5: 'max_5x', max_5: 'max_5x', max_5x: 'max_5x', max5x: 'max_5x',
    max20: 'max_20x', max_20: 'max_20x', max_20x: 'max_20x', max20x: 'max_20x',
    team_standard: 'team_standard', team_std: 'team_standard',
    team_premium: 'team_premium', team_prem: 'team_premium',
    enterprise_standard: 'enterprise_standard', ent_standard: 'enterprise_standard',
    enterprise_premium: 'enterprise_premium', ent_premium: 'enterprise_premium',
  };
  return map[n] || null;
}

function planLabel(key) {
  const p = (getLatestPricing().plans || {})[key];
  const label = (p && p.label) || PLAN_FALLBACK_LABELS[key] || key;
  if (!p || typeof p.price_monthly !== 'number') return label;
  return `${label} ($${p.price_monthly}/mo${p.per_seat ? ' per seat' : ''})`;
}

async function promptPlan(existing, opts) {
  // Non-interactive paths: explicit --plan, or no TTY / --yes → keep/skip silently.
  const flagPlan = normalizePlan(opts.plan);
  if (flagPlan) return flagPlan;
  if (opts.yes || opts.nonInteractive || !process.stdin.isTTY) return existing || null;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const skip = PLAN_KEYS.length + 1;
    console.log('  Which Claude plan are you on?  (sets accurate limits, credits + forecasts)');
    PLAN_KEYS.forEach((k, i) => console.log(`    ${i + 1}) ${planLabel(k)}`));
    console.log(`    ${skip}) Skip for now`);
    const keepHint = existing ? ` [Enter = keep ${planLabel(existing)}]` : ' [Enter = skip]';
    const answer = (await rl.question(`  Choose 1-${skip}${keepHint}: `)).trim();
    if (answer === '') return existing || null;
    const idx = parseInt(answer, 10);
    if (idx >= 1 && idx <= PLAN_KEYS.length) return PLAN_KEYS[idx - 1];
    return existing || null; // skip / anything else
  } catch {
    return existing || null; // never let a prompt error break setup
  } finally {
    rl.close();
  }
}

const snippet = (cmd) => `"statusLine": { "type": "command", "command": ${JSON.stringify(cmd)} }`;

// The command to keep for an entry that is already ours, or null when it
// can't run and there is nothing stable to repoint it at. Only a command
// /bin/sh can actually run is kept (QA-0928-44): a bare `wtclaude-collector`
// only while a stable one is on PATH, a path only while it is an executable
// file outside the npx cache. Anything else (what setup wrote when `which`
// failed, a pruned npx cache, a moved install) is repointed at the stable
// collector. A legacy unquoted path with a space is quoted; an unquoted
// command with whitespace that isn't one existing file is never rewritten
// (isOwnCollectorCommand already calls it a wrapper — QA-0928-47).
function repairedCommand(current, collector) {
  const p = unquoteCommand(current);
  const unquoted = p === current.trim();
  if (unquoted && /\s/.test(p) && !isOwnCollectorCommand(current)) return current;
  if (!ownCommandRunnable(current, collector)) return collector.path ? shellQuote(collector.path) : null;
  return unquoted && /\s/.test(p) ? shellQuote(shellPath(current)) : current;
}

// Wire the collector into Claude Code's statusLine. Returns { status, command }
// (command: what the statusLine runs now, when it is ours), status being
//   'added' | 'repaired' | 'already'  — the statusLine now runs the collector
//   'conflict' | 'wrapped'            — someone else's statusLine; left alone
//   'unreadable' | 'failed'           — settings file left untouched; manual snippet printed
//   'npx'                             — no stable collector to point at; left untouched
//   'npx-pinned'                      — our entry runs a collector in the npx cache: it
//                                       captures now, but npm may prune it; left untouched
//
// Claude Code only runs a statusLine whose "type" is "command" (statusline
// docs, read 2026-09-28: 'Set `type` to "command" and point `command` to a
// script path'). Every tag from v0.1.3 to 0.3.1 wrote { command } alone, so a
// fresh install captured nothing (QA-0928-10); an entry of ours without it is
// repaired here, and a re-run changes nothing.
function wireStatusline(settingsPath, collector) {
  const pad = '         ';
  const manualCmd = collector.path ? shellQuote(collector.path) : null;
  const printManual = () => {
    if (manualCmd) console.log(`${pad}  ${snippet(manualCmd)}`);
    else console.log(`${pad}  (install wtclaude globally first: npm i -g wtclaude — then re-run: wtclaude setup)`);
  };

  const read = readClaudeSettings(settingsPath);
  if (read.state === 'unreadable') {
    // QA-0928-11: never overwrite a file we can't fully parse — JSONC, a BOM,
    // a truncated file or a non-object would lose the user's other settings.
    console.log(`${pad}Could not safely edit ${settingsPath}:`);
    if ((read.kind === 'empty' || read.kind === 'non-object') && manualCmd) {
      // RC 2026-09-28: an empty file, or null / [] / a scalar, has no
      // top-level { } to add anything inside — give the whole document.
      console.log(`${pad}${read.reason}. Setup left it untouched. Replace its contents with:`);
      console.log(`${pad}  { ${snippet(manualCmd)} }`);
    } else {
      console.log(`${pad}${read.reason}. Setup left it untouched. Add this inside its top-level { … }:`);
      printManual();
    }
    return { status: 'unreadable' };
  }

  const settings = read.settings;
  const state = statusLineState(settings, [collector.path].filter(Boolean));
  if (state === 'foreign' || state === 'wrapped') {
    const existing = settings.statusLine && typeof settings.statusLine.command === 'string'
      ? settings.statusLine.command : JSON.stringify(settings.statusLine);
    console.log(`${pad}You already have a statusLine command configured in ${settingsPath}:`);
    console.log(`${pad}  ${existing}`);
    if (state === 'wrapped') {
      console.log(`${pad}It mentions wtclaude, so it may wrap the collector — setup can't verify that and left it alone.`);
      console.log(`${pad}For capture, it must pipe Claude Code's JSON to the collector. To use the collector directly, set:`);
    } else {
      console.log(`${pad}Setup left it alone. To use WTClaude instead, set this in ${settingsPath}:`);
    }
    printManual();
    return { status: state === 'wrapped' ? 'wrapped' : 'conflict' };
  }

  let command;
  if (state === 'ours' || state === 'ours-untyped') {
    const current = settings.statusLine.command;
    // Pinned into the npx cache with nothing stable to repoint at: it runs
    // now, so say that — and that npm can prune it (RC 2026-09-28).
    if (state === 'ours' && !collector.path && npxPinnedRunnable(current)) return { status: 'npx-pinned', command: current };
    command = repairedCommand(current, collector);
    if (command == null) return { status: 'npx' };
    if (state === 'ours' && command === current) return { status: 'already', command };
    const { type: _type, command: _cmd, ...rest } = settings.statusLine; // keep padding / refreshInterval
    settings.statusLine = { type: 'command', command, ...rest };
  } else {
    if (!collector.path) return { status: 'npx' };
    command = shellQuote(collector.path);
    settings.statusLine = { type: 'command', command };
  }

  try {
    const backup = writeClaudeSettings(settingsPath, settings);
    if (backup) console.log(`${pad}(backup of the previous file: ${backup})`);
    return { status: state === 'none' ? 'added' : 'repaired', command };
  } catch (err) {
    console.log(`${pad}Could not write ${settingsPath}: ${err.message}`);
    console.log(`${pad}Add this inside its top-level { … } yourself:`);
    printManual();
    return { status: 'failed' };
  }
}

// An unparsable config.json must never be treated as missing (QA-0928-07):
// rewriting it would mint a new anonymous id — the only key to any synced
// data — and a new salt, orphaning every project hash. Returns the problem, or
// null when the file is absent or a JSON object.
function configProblem() {
  if (!existsSync(CONFIG_FILE)) return null;
  let raw;
  try { raw = readFileSync(CONFIG_FILE, 'utf8'); } catch (err) { return `can't be read (${err.code || err.message})`; }
  try {
    const c = JSON.parse(raw);
    if (!c || typeof c !== 'object' || Array.isArray(c)) return 'is not valid JSON (its top level is not an object)';
  } catch (err) {
    return `is not valid JSON (${err.message})`;
  }
  return null;
}

export function registerSetup(program) {
  program
    .command('setup')
    .description('Configure WTClaude (per-install identity + plan + the Claude Code statusline)')
    .option('--plan <plan>', `Set plan non-interactively: ${PLAN_FLAG_HINT}`)
    .option('--yes', 'Non-interactive: accept defaults, keep existing values, no prompts')
    .option('--non-interactive', 'Alias for --yes')
    .action(async (opts) => {
      const o = opts || {};

      // Refuse before anything is written (QA-0928-153): an unrecognised plan
      // used to be dropped silently, so `--plan team` "worked" and set nothing.
      if (o.plan != null && !normalizePlan(o.plan)) {
        console.error(`\n  Unknown plan "${o.plan}". Use one of: ${PLAN_FLAG_HINT}\n`);
        process.exitCode = 1;
        return;
      }
      const problem = configProblem();
      if (problem) {
        console.error(`\n  ✗ ${CONFIG_FILE} ${problem}.`);
        console.error('    Setup won\'t overwrite it: it holds your anonymous id (the only key to any');
        console.error('    synced data) and the salt behind every project hash, and a rewrite would');
        console.error('    replace them. Fix the file by hand (e.g. remove a trailing comma), or move');
        console.error('    it aside if you really want a fresh identity, then re-run:  wtclaude setup\n');
        process.exitCode = 1;
        return;
      }

      console.log('\n  WTClaude Setup');
      console.log('  ==============\n');

      // ── [1/4] data dirs ── (0700: QA-0928-142; mkdir's mode only covers new dirs)
      ensureDataDirs();
      try { chmodSync(WTCLAUDE_DIR, 0o700); } catch { /* best effort */ }
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
      try { chmodSync(CONFIG_FILE, 0o600); } catch { /* best effort */ }

      // ── [4/4] statusline ── (CLAUDE_CONFIG_DIR-aware: QA-0928-46)
      const settingsPath = claudeSettingsPath();
      const collector = resolveCollector();
      const { status, command } = wireStatusline(settingsPath, collector);
      const wired = status === 'added' || status === 'repaired' || status === 'already';
      if (status === 'already') console.log(`  [4/4] Claude Code's statusline already runs the wtclaude collector (${settingsPath})`);
      else if (status === 'added') console.log(`  [4/4] Added the wtclaude collector to your Claude Code statusline (${settingsPath})`);
      else if (status === 'repaired') console.log(`  [4/4] Repaired your wtclaude statusline entry so Claude Code runs it (${settingsPath})`);
      else if (status === 'npx') {
        console.log('  [4/4] Not capturing yet: setup is running from the npx cache, which npm can');
        console.log('        prune at any time, so it won\'t point Claude Code there. Install once, then re-run:');
        console.log('          npm i -g wtclaude');
        console.log('          wtclaude setup');
      } else if (status === 'npx-pinned') {
        console.log(`  [4/4] Your status line points into the npx cache (${shellPath(command)}).`);
        console.log('        It works now, but npm can prune it at any time. Install once, then re-run:');
        console.log('          npm i -g wtclaude');
        console.log('          wtclaude setup');
      } else if (status === 'wrapped') console.log('  [4/4] Capture not verified: your own statusLine command is left in place (see note above)');
      else console.log('  [4/4] Not capturing yet: the statusline was not configured (see note above)');
      if (wired && command === shellQuote(OWN_COLLECTOR)) {
        console.log('        · wtclaude-collector isn\'t on your PATH, so this points at this copy of');
        console.log('          wtclaude. Move or delete it and capture stops; `npm i -g wtclaude` then');
        console.log('          `wtclaude setup` gives a stable path.');
      }
      // RC 2026-09-28: the collector the status line runs may be an OLDER
      // wtclaude than this one (`npx wtclaude@new setup` with an old global
      // install first on PATH). It captures, but without this version's
      // collector fixes — say which version it is and how to update.
      let stale = null;
      if (wired) {
        const target = commandTarget(command, collector);
        const v = collectorVersion(target);
        if (v && OWN_VERSION && isOlderVersion(v, OWN_VERSION)) stale = { version: v, target, onPath: target === collector.path };
      }
      if (stale) {
        console.log(`        ! The wtclaude-collector ${stale.onPath ? 'on your PATH' : 'your status line runs'} is version ${stale.version}, older than this`);
        console.log(`          wtclaude (${OWN_VERSION}): ${stale.target}`);
        console.log('          Claude Code will run that older collector, without this version\'s fixes.');
        console.log('          Update it, then re-run setup:');
        console.log(`            npm i -g wtclaude@${OWN_VERSION}`);
        console.log('            wtclaude setup');
      }

      // ── closer ── "capturing" only when the statusLine now runs the collector (QA-0928-45)
      console.log('');
      if (wired && stale) {
        console.log(`  ! Capturing, but with the older ${stale.version} collector — update it as shown in [4/4].`);
        console.log('    Then take a turn in a Claude Code terminal session and run:  wtclaude today');
      } else if (status === 'npx-pinned') {
        console.log('  Capturing for now, but capture stops if npm prunes that cache — install');
        console.log('  globally as shown in [4/4].');
      } else if (wired) {
        console.log('  ✓ You\'re all set — and capturing starts now.');
        console.log('');
        console.log('  Next:');
        console.log('    1. Start (or continue) a Claude Code session in your terminal');
        console.log('    2. Take one turn, then run:  wtclaude today');
        console.log('    3. See how off your old tracker was:  wtclaude compare');
      } else if (status === 'wrapped') {
        console.log('  Your config is saved. Capture depends on your own statusLine command passing');
        console.log('  Claude Code\'s JSON to wtclaude-collector — take a turn, then check:  wtclaude today');
      } else {
        console.log('  ! Your config is saved, but nothing is being captured yet — finish step [4/4]');
        console.log('    above, then start a Claude Code session in your terminal.');
      }
      console.log('');
      console.log('  Note: capture runs in the terminal CLI only — the desktop app and');
      console.log('  Cowork don\'t emit the statusline, so those turns aren\'t tracked yet.');
      if (!chosen) console.log(`  Tip: set your plan anytime with  wtclaude setup --plan <${PLAN_FLAG_HINT.replace(/ \| /g, '|')}>`);
      console.log('');
    });
}
