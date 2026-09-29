#!/usr/bin/env node
// `npm test`: the CLI and collector suite (every *.test.js under src/ and bin/)
// on any Node the CLI supports (engines >=18), from any shell. Not shipped:
// package.json "files" leaves this file out.
//
// Why a script (RC 2026-09-28): `node --test` can't find the files by itself
// on every supported Node. Node 18/20 take directories but not globs; Node
// 21+ take globs but not directories; quoted globs in an npm script never
// expand on 18/20; and `$(find …)` needs a POSIX shell, so it broke `npm
// test` under Windows cmd.exe. Listing the files here works everywhere.
//
//   npm test                               the whole suite
//   npm test -- --test-name-pattern=probe  extra node --test flags pass through
//   npm test -- src/sync/index.test.js     positional paths replace the list
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SUITE_DIRS = ['src', 'bin'];

// Every *.test.js under the suite dirs, relative to root, with forward slashes
// (Node 21+ reads each argument as a glob pattern, where a backslash escapes),
// sorted so runs list files in a stable order.
export function listTestFiles(root = ROOT, dirs = SUITE_DIRS) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.test.js')) out.push(relative(root, p).split(sep).join('/'));
    }
  };
  for (const d of dirs) walk(join(root, d));
  return out.sort();
}

// node --test arguments: flags first, then the given paths or the whole list.
export function testArgs(argv, files) {
  const flags = argv.filter((a) => a.startsWith('-'));
  const paths = argv.filter((a) => !a.startsWith('-'));
  return ['--test', ...flags, ...(paths.length ? paths : files)];
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const files = listTestFiles();
  if (!files.length) {
    console.error('run-tests: no *.test.js files under src/ or bin/');
    process.exit(1);
  }
  const r = spawnSync(process.execPath, testArgs(process.argv.slice(2), files), { cwd: ROOT, stdio: 'inherit' });
  if (r.error) {
    console.error(`run-tests: ${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}
