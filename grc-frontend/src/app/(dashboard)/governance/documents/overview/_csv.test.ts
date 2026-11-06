// node --test "src/app/(dashboard)/governance/documents/overview/_csv.test.ts"
// The CSV text of an export: quoting, the byte-order mark, and a cell a spreadsheet would run as a formula written as text.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { csvCell, csvName, csvText } from './_csv.ts';
const BOM = String.fromCharCode(0xfeff);                                         // the byte-order mark: Excel reads the file as UTF-8

test('a cell is quoted when it holds a comma, a quote or a line break; a quote is doubled; nothing and a number are plain', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(-3), '-3');                                                  // a number is a number: never a formula
  assert.equal(csvCell(Number.NaN), '');
});

test('text that a spreadsheet would run as a formula starts with a quote mark, and is then quoted if it needs to be', () => {
  for (const t of ['=1+1', '+1', '-2', '@SUM(A1)', '\tTabbed']) assert.equal(csvCell(t), `'${t}`, JSON.stringify(t));
  assert.equal(csvCell('\rReturned'), `"'\rReturned"`);                           // a return needs the quotes too
  assert.equal(csvCell('=HYPERLINK("http://x","y")'), `"'=HYPERLINK(""http://x"",""y"")"`);
  assert.equal(csvCell('Finance - Legal'), 'Finance - Legal');                      // a dash inside is nothing
  assert.equal(csvCell('a=b'), 'a=b');
});

test('the file is UTF-8 with a byte-order mark (Excel reads it right), CRLF between the rows and one at the end', () => {
  const text = csvText([['Name', 'Count'], ['Operations', 5], ['Sales, EMEA', 2]]);
  assert.ok(text.startsWith(BOM + 'Name,Count\r\n'));
  assert.equal(text, BOM + 'Name,Count\r\nOperations,5\r\n"Sales, EMEA",2\r\n');
  assert.equal(csvText([]), BOM + '\r\n');
});

test('the file name says what is in it, for what, and the day', () => {
  const day = new Date(2026, 10, 5);
  assert.equal(csvName('Departments', 'Whole organisation', day), 'departments-whole-organisation-2026-11-05.csv');
  assert.equal(csvName('At a glance', 'Operations › Support', day), 'at-a-glance-operations-support-2026-11-05.csv');
  assert.equal(csvName('', '', day), 'export-2026-11-05.csv');
  assert.equal(csvName('Documents', '###', day), 'documents-2026-11-05.csv');
  assert.equal(csvName('At a glance', 'Operations', day, 'pdf'), 'at-a-glance-operations-2026-11-05.pdf');
});
