// node --test "src/app/(dashboard)/reports/_library/fileModel.test.ts"
// What a library download writes: a CSV a spreadsheet cannot turn into a formula, the file's name, the words when it is done, and the honest note when the rows are only part of the register.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { csvCell, toSafeCsv } from './safeCsv.ts';
import { downloadWords, fileBase, fileName } from './fileModel.ts';
import { CLIENT_LIMITS, coverage } from '../_reports/rowCoverage.ts';

test('a text cell that starts with = + - @ tab or CR is written as text: a leading apostrophe', () => {
  for (const evil of ['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)', '=HYPERLINK("http://x","y")', '\t=1', '\r=1']) {
    const cell = csvCell(evil);
    assert.ok(cell.startsWith("'") || cell.startsWith('"\''), `${JSON.stringify(evil)} -> ${JSON.stringify(cell)}`);
  }
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('-5 days'), "'-5 days");
});

test('a number stays a number, a missing value is empty, and ordinary text is left alone', () => {
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell(0), '0');
  assert.equal(csvCell(3.5), '3.5');
  assert.equal(csvCell(NaN), '');
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(undefined), '');
  assert.equal(csvCell(true), 'Yes');
  assert.equal(csvCell('Open risks'), 'Open risks');
  assert.equal(csvCell('a=b'), 'a=b', 'only the first character makes a formula');
});

test('commas, quotes and line breaks are quoted with the quotes doubled, and a formula that also has them is both escaped and quoted', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('two\nlines'), '"two\nlines"');
  assert.equal(csvCell('=A1,B1'), '"\'=A1,B1"');
});

test('the file has a byte-order mark, a header, CRLF between lines and one at the end', () => {
  const text = toSafeCsv(['Title', 'Score'], [['=cmd', 12], ['Plain, with comma', -3]]);
  assert.equal(text, "﻿Title,Score\r\n'=cmd,12\r\n\"Plain, with comma\",-3\r\n");
  assert.equal(toSafeCsv(['A'], []), '﻿A\r\n');
});

test('a header cell is escaped like any other (a column label a person typed)', () => {
  assert.equal(toSafeCsv(['=evil'], []), "﻿'=evil\r\n");
});

test('a file name drops what a file name cannot hold, keeps a long title to 80 characters, and never ends up empty', () => {
  assert.equal(fileName('Risks: high/critical', 'csv', '2026-11-08'), 'Risks high critical 2026-11-08.csv');
  assert.equal(fileName('a/b\\c:d*e?"f<g>h|i', 'excel', '2026-11-08'), 'a b c d e f g h i 2026-11-08.xlsx');
  assert.equal(fileName('', 'word', '2026-11-08'), 'Report 2026-11-08.docx');
  assert.equal(fileName('...', 'csv', '2026-11-08'), 'Report 2026-11-08.csv');
  assert.equal(fileBase('x'.repeat(300), '2026-11-08').length, 80 + 1 + '2026-11-08'.length);
});

test('a finished download names the report, the format and the rows; partial data is said in the same message', () => {
  const full = coverage({ serverMode: true, loaded: 214, total: 214 });
  assert.deepEqual(downloadWords('Open risks', 'csv', 214, full), { title: 'CSV file ready', message: '“Open risks”: 214 rows.', partial: false });
  assert.equal(downloadWords('Open risks', 'excel', 1, full).message, '“Open risks”: 1 row.');
  assert.equal(downloadWords('Open risks', 'word', 3, full).title, 'Word file ready');
  const cut = coverage({ serverMode: true, loaded: 5000, total: 5310 });
  const words = downloadWords('Open risks', 'csv', 5000, cut);
  assert.equal(words.partial, true);
  assert.match(words.message, /^“Open risks”: 5,000 rows\. Only the first 5,000 of 5,310 rows were read\./);
  assert.equal(downloadWords('Open risks', 'pdf', 0, full).title, 'Opened for printing');
});

test('a server dataset is partial when it matched more than was read, and says so with the true numbers', () => {
  assert.equal(coverage({ serverMode: true, loaded: 5000, total: 5000 }).partial, false);
  assert.equal(coverage({ serverMode: true, loaded: 40, total: 40 }).text, '');
  const c = coverage({ serverMode: true, loaded: 5000, total: 12345 });
  assert.equal(c.short, 'first 5,000 of 12,345 rows');
  assert.match(c.text, /Only the first 5,000 of 12,345 rows were read/);
});

test('a module list API does not say what it held back: a load of exactly its batch size may be cut, any other size is complete', () => {
  for (const n of CLIENT_LIMITS) {
    const c = coverage({ serverMode: false, loaded: n, total: n });
    assert.equal(c.partial, true, String(n));
    assert.equal(c.short, `may be only the first ${n.toLocaleString('en-US')} rows`);
    assert.match(c.text, /there may be more/);
  }
  for (const n of [0, 1, 99, 101, 250, 4999]) assert.deepEqual(coverage({ serverMode: false, loaded: n, total: n }), { partial: false, text: '', short: '' }, String(n));
});
