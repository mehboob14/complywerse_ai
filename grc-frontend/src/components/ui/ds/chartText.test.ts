// node --test "src/components/ui/ds/chartText.test.ts"
// ChartFrame. What a chart says in words (the table of its numbers) and the props that turn off recharts 3's keyboard layer are pure and tested here; the
// markup the frame promises is read from source (there is no renderer in this repo). That recharts really leaves no tab stop and no "application" role
// with these props was checked in a browser on the style guide: the accessibility probe counted no focusable element inside a chart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from './kitRules.ts';
import { MAX_ROWS, NO_DATA, chartCell, chartFocusOff, chartTable } from './chartText.ts';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

// ── a cell ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('a number is read with thousands separators and its decimals (up to two), the same for every viewer', () => {
  assert.equal(chartCell(1234), '1,234');
  assert.equal(chartCell(1234567.891), '1,234,567.89');
  assert.equal(chartCell(7.5), '7.5');                                   // not "8": the numbers of a chart are the chart's
  assert.equal(chartCell(7.456), '7.46');
  assert.equal(chartCell(-3), '-3');
  assert.equal(chartCell(0), '0');                                       // 0 is a value
  assert.equal(chartCell(-0), '0');
});

test('nothing, a blank, NaN and Infinity are "No data", never 0', () => {
  for (const cell of [null, undefined, '', '   ', Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) assert.equal(chartCell(cell), NO_DATA, String(cell));
});

test('text is read as it is', () => {
  assert.equal(chartCell('Jan'), 'Jan');
  assert.equal(chartCell('12%'), '12%');
});

// ── the table ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const months = { columns: ['Month', 'Created', 'Published'], rows: [['Jun', 3, 2], ['Jul', 1234, 4], ['Aug', 0, null]] as Array<Array<string | number | null>> };

test('the table has the columns and a text cell for every number', () => {
  assert.deepEqual(chartTable(months), {
    columns: ['Month', 'Created', 'Published'],
    rows: [['Jun', '3', '2'], ['Jul', '1,234', '4'], ['Aug', '0', NO_DATA]],
    more: 0,
  });
});

test('a month with nothing recorded says so; a 0 stays a 0', () => {
  const row = chartTable(months).rows[2];
  assert.equal(row[1], '0');
  assert.equal(row[2], NO_DATA);
});

test('a short row is filled with "No data" and a cell beyond the last column is dropped, so every row fits the header', () => {
  const t = chartTable({ columns: ['Status', 'Count', 'Share'], rows: [['Draft', 5], ['Approved', 8, 61.5, 'extra'], ['Expired']] });
  assert.deepEqual(t.rows, [['Draft', '5', NO_DATA], ['Approved', '8', '61.5'], ['Expired', NO_DATA, NO_DATA]]);
  for (const row of t.rows) assert.equal(row.length, 3);
});

test('the first cell names the row: a year is plain digits, a missing name is "Row n"', () => {
  const t = chartTable({ columns: ['Year', 'Documents'], rows: [[2026, 41], [null, 3], ['', 4], ['  ', 5], [Number.NaN, 6]] });
  assert.deepEqual(t.rows.map((r) => r[0]), ['2026', 'Row 2', 'Row 3', 'Row 4', 'Row 5']);
});

test('a long table is cut, and says how many rows it left out', () => {
  const rows = Array.from({ length: MAX_ROWS + 15 }, (_, i) => [`Day ${i + 1}`, i]);
  const t = chartTable({ columns: ['Day', 'Count'], rows });
  assert.equal(t.rows.length, MAX_ROWS);
  assert.equal(t.more, 15);
  assert.equal(t.rows[MAX_ROWS - 1][0], `Day ${MAX_ROWS}`);
  assert.equal(chartTable({ columns: ['Day', 'Count'], rows }, 10).more, rows.length - 10);
  assert.equal(chartTable({ columns: ['Day', 'Count'], rows }, 1e9).more, 0);
});

test('a chart with no rows has an empty table, and a cut of 0 or a bad cut does not break it', () => {
  assert.deepEqual(chartTable({ columns: ['Month', 'Created'], rows: [] }), { columns: ['Month', 'Created'], rows: [], more: 0 });
  assert.equal(chartTable(months, 0).rows.length, 0);
  assert.equal(chartTable(months, 0).more, 3);
  assert.equal(chartTable(months, -4).rows.length, 0);
  assert.equal(chartTable(months, Number.NaN).rows.length, 3);
});

test('the input is not touched', () => {
  const before = JSON.stringify(months);
  chartTable(months, 1);
  assert.equal(JSON.stringify(months), before);
});

// ── recharts' own focus ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

test('the focus helper turns off the chart\'s keyboard layer and the Pie\'s tab stop, and hands out a fresh object each time', () => {
  assert.deepEqual(chartFocusOff(), { accessibilityLayer: false, rootTabIndex: -1 });
  const a = chartFocusOff();
  (a as { rootTabIndex: number }).rootTabIndex = 0;                         // a caller that changes its copy changes nobody else's
  assert.equal(chartFocusOff().rootTabIndex, -1);
});

// ── the markup the frame promises ─────────────────────────────────────────────────────────────────────────────────────────────────────

const source = read('src/components/ui/ds/ChartFrame.tsx');
const code = strip(source);

test('the frame is a figure named by its visible title, which is a <p> with a size of its own (the shell gives a bare one 11.5px)', () => {
  assert.match(code, /<figure aria-labelledby=\{`\$\{id\}-title`\}/);
  assert.match(code, /<p id=\{`\$\{id\}-title`\} className="text-ds-body font-\[600\] text-ds-fg">\{title\}<\/p>/);
  assert.match(code, /\{note && <p className="text-ds-label font-normal text-ds-fg-muted">\{note\}<\/p>\}/);
});

test('the picture is hidden from assistive technology and has the height the page gave it', () => {
  assert.match(code, /<div aria-hidden="true" className="mt-\[8px\] w-full min-w-0" style=\{\{ height \}\}>/);
  assert.match(code, /height = 240/);
});

test('the same numbers are a table only a screen reader sees: sr-only, named by the title, built from the kit table primitives with row and column headers', () => {
  assert.match(code, /<div className="sr-only">\s*<Table caption=\{title\}>/);
  assert.match(code, /<Th key=\{i\}>\{name\}<\/Th>/);
  assert.match(code, /i === 0 \? <RowHeaderCell key=\{i\}>\{cell\}<\/RowHeaderCell> : <Td key=\{i\}>\{cell\}<\/Td>/);
  assert.match(code, /table\.more > 0 && /);                                          // a cut table says so
  assert.doesNotMatch(code, /<(?:table|th|td|tr)[\s>]/, 'the kit primitives, not bare table tags');
});

test('the chart gets the focus-off props through its children, so nothing inside the frame takes focus', () => {
  assert.match(code, /children: ReactNode \| \(\(focusOff: ReturnType<typeof chartFocusOff>\) => ReactNode\);/);
  assert.match(code, /typeof children === 'function' \? children\(chartFocusOff\(\)\) : children/);
});

test('the frame does not import recharts: that would join every page that imports the kit', () => {
  assert.doesNotMatch(code, /from 'recharts'/);
  assert.doesNotMatch(strip(read('src/components/ui/ds/chartText.ts')), /from 'recharts'/);
});

test('it follows the kit rules: tokens and arbitrary values only', () => {
  assert.deepEqual(findViolations(source), []);
  assert.deepEqual(findViolations(read('src/components/ui/ds/chartText.ts')), []);
});

test('it is exported from the kit index and from the ui barrel, with the focus helper', () => {
  assert.match(read('src/components/ui/ds/index.ts'), /export \{ ChartFrame, type ChartFrameProps, type ChartData \} from '\.\/ChartFrame';\nexport \{ chartFocusOff \} from '\.\/chartText';/);
  assert.match(read('src/components/ui/index.ts'), /export \{ ChartFrame, type ChartFrameProps, type ChartData \} from '\.\/ds\/ChartFrame';\nexport \{ chartFocusOff \} from '\.\/ds\/chartText';/);
});
