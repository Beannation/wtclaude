// /docs flag lists vs the CLI's own --help (RC check BUILD-018). The docs row for a command
// must list every value the shipped CLI accepts for the flags it names, so a CLI change that
// adds a plan, model or grouping fails here instead of shipping stale docs.
// Hermetic: `--help` never runs a command's action, and HOME / WTCLAUDE_DIR point at empty
// temp dirs with autosync off, so nothing reads or writes the developer's real data.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = dirname(fileURLToPath(import.meta.url));
const BIN = join(SRC, '..', '..', 'bin', 'wtclaude.js');
const DOCS = readFileSync(join(SRC, 'pages', 'docs.astro'), 'utf8');
const SCRATCH = mkdtempSync(join(tmpdir(), 'wtc-docs-cli-'));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

function help(command) {
  const res = spawnSync(process.execPath, [BIN, command, '--help'], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      HOME: SCRATCH,
      WTCLAUDE_DIR: join(SCRATCH, 'wtc'),
      CLAUDE_CONFIG_DIR: join(SCRATCH, 'claude'),
      WTCLAUDE_NO_AUTOSYNC: '1',
      TZ: 'UTC',
      COLUMNS: '200',
    },
  });
  assert.equal(res.status, 0, res.stderr);
  return res.stdout.replace(/\s+/g, ' ');
}

/** The help text of one option, up to the next option. */
function optionHelp(text, flag) {
  const i = text.indexOf(` ${flag} `);
  assert.ok(i >= 0, `${flag} not in help`);
  const rest = text.slice(i + flag.length + 1);
  const next = rest.search(/ (--[a-z]|-[a-zA-Z], )/);
  return next >= 0 ? rest.slice(0, next) : rest;
}

/** The values listed after the option description's colon / "one of" / "by". */
function values(optText, lead) {
  const i = optText.indexOf(lead);
  assert.ok(i >= 0, `"${lead}" not in "${optText}"`);
  return optText.slice(i + lead.length).match(/[a-z][a-z0-9_]*/g);
}

function docsDesc(name) {
  const i = DOCS.indexOf(`name: '${name}'`);
  assert.ok(i >= 0, `docs command "${name}" not found`);
  const d = DOCS.indexOf('desc:', i);
  return DOCS.slice(d, DOCS.indexOf('\n', d));
}

function assertListed(docs, vals, what) {
  const missing = vals.filter((v) => !new RegExp(`(^|[^a-z0-9_])${v}([^a-z0-9_]|$)`).test(docs));
  assert.deepEqual(missing, [], `/docs ${what} is missing ${missing.join(', ')}`);
}

test('/docs setup lists every plan `setup --plan` accepts (Team and Enterprise included)', () => {
  const plans = values(optionHelp(help('setup'), '--plan <plan>'), 'non-interactively:');
  assert.ok(plans.includes('enterprise_premium'), plans.join(','));
  assertListed(docsDesc('setup'), plans, 'setup --plan');
});

test('/docs whatif lists every `--plan` and `--model` value whatif accepts', () => {
  const h = help('whatif');
  const plans = values(optionHelp(h, '--plan [plan]'), 'one of');
  const models = values(optionHelp(h, '--model <model>'), 'single model:');
  assert.ok(models.includes('fable'), models.join(','));
  const docs = docsDesc('whatif');
  assertListed(docs, plans, 'whatif --plan');
  assertListed(docs, models, 'whatif --model');
});

test('/docs today/week/month lists every `--group-by` dimension', () => {
  const dims = values(optionHelp(help('today'), '--group-by <dimension>'), 'down by');
  assertListed(docsDesc('today · week · month'), dims, 'today --group-by');
});
