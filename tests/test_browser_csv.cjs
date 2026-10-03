'use strict';
// Run: node tests/test_browser_csv.cjs
// Tests the same dependency-free parser used by the local browser inspector.
const assert = require('node:assert/strict');
const { parseCSV, inspectCSV, reconcileText, SAMPLE } = require('../site/app.js');
const cases = [
  ['', []],
  ['\uFEFF', []],
  ['a,b\r\n001,2\r\n', [['a', 'b'], ['001', '2']]],
  ['a,b\n1,2', [['a', 'b'], ['1', '2']]],
  ['a,b\r1,2', [['a', 'b'], ['1', '2']]],
  ['a,', [['a', '']]],
  [',', [['', '']]],
  ['"a,b","line\r\nnext","say ""hi"""', [['a,b', 'line\r\nnext', 'say "hi"']]],
  ['a\n\n', [['a'], ['']]],
  ['""', [['']]],
  ['"a"', [['a']]],
  ['a\n""', [['a'], ['']]],
  ['\uFEFFid,name\n00008,<script>', [['id', 'name'], ['00008', '<script>']]]
];
for (const [source, expected] of cases) assert.deepEqual(parseCSV(source), expected);
for (const bad of ['a"b', '"a" b', '"open', '"""', '"a""b']) assert.throws(() => parseCSV(bad));
assert.throws(() => parseCSV(null), TypeError);
const sample = inspectCSV(SAMPLE);
assert.equal(sample.rows[0][0], '00127');
assert.equal(sample.rows[0][1], 'North, studio');
assert.equal(sample.rows[0][2], 'Two lines:\nkeep both');
assert.equal(sample.rows[1][2], 'She said "ready"');
assert.deepEqual(sample.issues, []);
const notices = inspectCSV('x,x\n=1,  @SUM(A1)\nshort\n');
assert.equal(notices.mismatchCount, 1);
assert.equal(notices.formulaCount, 2);
assert(notices.issues.some(issue => issue.code === 'duplicate-header'));
const exact = inspectCSV('x,x\n001,\nsolo\n');
assert.deepEqual(JSON.parse(JSON.stringify({ headers: exact.headers, rows: exact.rows })), { headers: ['x', 'x'], rows: [['001', ''], ['solo']] });
const original = 'id,note\r\n001,"line\r\nnext"\r\n';
const display = original.replace(/\r\n?/g, '\n');
assert.equal(reconcileText(original, display), original);
assert.equal(reconcileText(original, display.replace('001', '002')), original.replace('001', '002'));
assert.equal(reconcileText(original, display + 'new'), original + 'new');
assert.equal(reconcileText(original, display.replace('line\nnext', 'line next')), original.replace('line\r\nnext', 'line next'));
assert.equal(reconcileText(original, 'id,note\n'), 'id,note\r\n');
assert.equal(parseCSV(original)[1][1], 'line\r\nnext');
const quote = value => '"' + value.replaceAll('"', '""') + '"';
const alphabet = ['a', '0', ',', '"', '\n', '\r', ' ', '\t', 'é', '𝒜', '<', '>'];
let seed = 7127;
const rand = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
for (let i = 0; i < 500; i++) {
  const rows = Array.from({ length: rand(7) + 1 }, () => Array.from({ length: rand(6) + 1 }, () => Array.from({ length: rand(25) }, () => alphabet[rand(alphabet.length)]).join('')));
  const encoded = rows.map(row => row.map(quote).join(',')).join(i % 2 ? '\r\n' : '\n') + (i % 3 ? '' : '\r\n');
  assert.deepEqual(parseCSV(encoded), rows);
}
const wide = inspectCSV(Array(10000).fill('x').join(','));
assert.equal(wide.headers.length, 10000);
assert(wide.issues.length <= 100);
assert.equal(wide.noticeCount, 10000);
console.log('PASS: 13 CSV examples, 5 malformed-input cases, type validation, synthetic sample, diagnostics, string-preserving JSON, CRLF edit preservation, 500 deterministic quoted-field round trips, and bounded wide-header diagnostics.');
