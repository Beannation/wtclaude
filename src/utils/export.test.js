import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCSV } from './export.js';

// QA-0928-162: a cell a spreadsheet would evaluate as a formula opens as text.
// Git allows branch names like these, so a cloned repo can carry one into a CSV.

test('toCSV prefixes a single quote on cells starting with = + - @ tab or CR', () => {
  const rows = [
    { v: '=HYPERLINK("http://example.invalid","x")' },
    { v: '+1+1' }, { v: '-2+3' }, { v: '@SUM(A1)' }, { v: '\tlead' }, { v: '\rlead' },
  ];
  const lines = toCSV(rows, [{ key: 'v' }]).split('\n');
  assert.equal(lines[1], `"'=HYPERLINK(""http://example.invalid"",""x"")"`);
  assert.equal(lines[2], "'+1+1");
  assert.equal(lines[3], "'-2+3");
  assert.equal(lines[4], "'@SUM(A1)");
  assert.equal(lines[5], "'\tlead");
  assert.ok(toCSV([{ v: '\rlead' }], [{ key: 'v' }]).endsWith(`"'\rlead"`), 'a CR cell is prefixed and quoted');
});

test('toCSV leaves numbers (including negatives) and ordinary text alone', () => {
  const out = toCSV([{ a: -10.69, b: 0, c: 'main', d: 'feature/x-1' }]);
  assert.equal(out, 'a,b,c,d\n-10.69,0,main,feature/x-1');
});
