import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTestFiles, testArgs, SUITE_DIRS } from './run-tests.js';

// RC 2026-09-28: `npm test` was `node --test $(find src bin -name "*.test.js"
// | sort)`, which needs a POSIX shell, so it no longer ran under Windows
// cmd.exe. It is now `node bin/run-tests.js`, which lists the files itself.

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = JSON.parse(readFileSync(join(HERE, '..', 'package.json'), 'utf8'));

test('npm test runs the runner with plain node: no shell expansion, pipes or find', () => {
  assert.equal(PKG.scripts.test, 'node bin/run-tests.js');
  assert.doesNotMatch(PKG.scripts.test, /[$`|;<>*]|\bfind\b/);
  // test:all chains the three suites with &&, which cmd.exe and sh both run.
  assert.equal(PKG.scripts['test:all'], 'npm test && npm --prefix web test && npm --prefix site test');
});

test('the runner is not shipped in the npm tarball', () => {
  assert.ok(PKG.files.includes('!bin/run-tests.js'), 'package.json "files" leaves bin/run-tests.js out');
  assert.equal(Object.values(PKG.bin).includes('bin/run-tests.js'), false);
});

test('listTestFiles finds *.test.js under src/ and bin/ only, sorted, with forward slashes', () => {
  const root = mkdtempSync(join(tmpdir(), 'wtc-runtests-'));
  try {
    const put = (p) => { mkdirSync(join(root, dirname(p)), { recursive: true }); writeFileSync(join(root, p), ''); };
    put('src/sync/index.test.js');
    put('src/sync/index.js');              // not a test
    put('src/a/b/deep.test.js');
    put('src/a/helper.test.mjs');          // not the suite's extension
    put('src/node_modules/dep.test.js');   // dependencies are never the suite
    put('src/.cache/x.test.js');           // nor dot-directories
    put('bin/version.test.js');
    put('web/src/page.test.js');           // web and site have their own suites
    put('site/src/lib/x.test.js');
    assert.deepEqual(listTestFiles(root), ['bin/version.test.js', 'src/a/b/deep.test.js', 'src/sync/index.test.js']);
    // A missing suite dir is skipped, not an error.
    rmSync(join(root, 'bin'), { recursive: true });
    assert.deepEqual(listTestFiles(root), ['src/a/b/deep.test.js', 'src/sync/index.test.js']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('on this repo the list holds this file and known suites, and nothing from web/ or site/', () => {
  assert.deepEqual(SUITE_DIRS, ['src', 'bin']);
  const files = listTestFiles();
  assert.ok(files.includes('bin/run-tests.test.js'));
  assert.ok(files.includes('bin/version.test.js'));
  assert.ok(files.includes('src/sync/index.test.js'));
  assert.ok(files.every((f) => /^(src|bin)\/[^\\]+\.test\.js$/.test(f)), 'relative, forward slashes, *.test.js');
  assert.equal(new Set(files).size, files.length);
  assert.deepEqual(files, [...files].sort());
});

test('testArgs passes flags through and lets positional paths replace the list', () => {
  const all = ['bin/a.test.js', 'src/b.test.js'];
  assert.deepEqual(testArgs([], all), ['--test', 'bin/a.test.js', 'src/b.test.js']);
  assert.deepEqual(testArgs(['--test-name-pattern=probe'], all), ['--test', '--test-name-pattern=probe', 'bin/a.test.js', 'src/b.test.js']);
  assert.deepEqual(testArgs(['src/b.test.js', '--test-only'], all), ['--test', '--test-only', 'src/b.test.js']);
});
