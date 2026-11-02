// node --test "src/components/ui/ds/registerCards.test.ts"
// Source-text guards (the tableGuard.test.ts style) for the two additions to the register's cards: `cardCell` (a column's own cell for the card, so an
// inline control is not drawn twice) and `cardActions` (a row-actions slot on the card). Both are additive: a register that passes neither is drawn as
// it always was. There is no DOM here, so these read RegisterTable.tsx; the behaviour was checked in a browser on the style guide at 390 px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { INTERACTIVE_SELECTOR, isInteractiveTarget } from './tableModel.ts';

const read = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const withoutComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/\s.*$/gm, '$1');
const raw = read('src/components/ui/ds/RegisterTable.tsx');
const register = withoutComments(raw);
const CARDS = '<ul role="list"';
const tablePart = register.slice(register.indexOf('<div className="hidden md:block">'), register.indexOf(CARDS));
const cardsPart = register.slice(register.indexOf(CARDS));

/** The body of an interface: from `interface Name … {` to the closing brace at column 0. */
function body(source: string, iface: string): string {
  const head = new RegExp(`interface\\s+${iface}\\b[^{]*\\{`).exec(source);
  assert.ok(head, `no interface ${iface}`);
  return source.slice(head.index + head[0].length).split(/\n\}/)[0];
}
const names = (text: string): string[] => Array.from(text.matchAll(/^ {2}(?:'([^']+)'|([A-Za-z_$][\w$]*))\??:/gm), (m) => m[1] ?? m[2]);

test('both additions are optional props of the register, and every prop it had is still there under the same name', () => {
  const column = names(body(register, 'RegisterColumn'));
  const props = names(body(register, 'RegisterTableProps'));
  for (const name of ['key', 'header', 'cell', 'priority', 'align', 'sortable', 'firstDir', 'width', 'isRowHeader', 'card', 'cardLabel']) assert.ok(column.includes(name), `column.${name}`);
  for (const name of ['caption', 'columns', 'rows', 'getRowId', 'sort', 'onSortChange', 'onRowActivate', 'selectedId', 'loading', 'loadingRows', 'error', 'empty', 'footer', 'cardTitle', 'stickyHead', 'hideHeader', 'maxHeight']) assert.ok(props.includes(name), `props.${name}`);
  assert.match(register, /cardCell\?: \(row: T\) => ReactNode;/);
  assert.match(register, /cardActions\?: \(row: T\) => ReactNode;/);
  assert.match(register, /cell: \(row: T\) => ReactNode;/);                                   // `cell` is still required, with the same signature
});

test('the card line draws the column\'s cardCell when it has one, else its cell; the table never draws a cardCell', () => {
  assert.match(cardsPart, /<dd className="[^"]*">\{\(c\.cardCell \?\? c\.cell\)\(row\)\}<\/dd>/);
  assert.doesNotMatch(tablePart, /cardCell/);
  assert.match(tablePart, /\{c\.cell\(row\)\}/);                                              // the table cell is exactly what it was
  assert.equal((tablePart.match(/\bc\.cell\(row\)/g) ?? []).length, 1);
});

test('only a column on the card (card: "meta") has a line, so a cardCell is for those; a column off the card is still off it', () => {
  assert.match(register, /const meta = columns\.filter\(\(c\) => c\.card === 'meta'\);/);
  assert.match(cardsPart, /\{meta\.map\(\(c\) => \(/);
});

test('the actions slot is on the card only: not in the table, not in the loading or failed cards', () => {
  assert.doesNotMatch(tablePart, /cardActions/);
  const loadingAndFailed = cardsPart.slice(0, cardsPart.indexOf('rows.map((row) => {'));
  assert.doesNotMatch(loadingAndFailed, /cardActions/);
  assert.equal((cardsPart.match(/cardActions\(row\)/g) ?? []).length, 1);
});

test('without cardActions the card title is drawn exactly as before, and with it the title and the slot share a row', () => {
  assert.match(cardsPart, /const title = <div className="min-w-0 text-ds-body font-medium text-ds-fg \[overflow-wrap:anywhere\]">\{cardTitle\(row\)\}<\/div>;/);
  assert.match(cardsPart, /\{cardActions \? \(\s*<div className="flex items-start justify-between gap-2">\s*\{title\}\s*<div data-row-ignore className="-my-\[12px\] shrink-0">\{cardActions\(row\)\}<\/div>\s*<\/div>\s*\) : title\}/);
});

test('a press anywhere in the actions slot is not a press on the card (data-row-ignore), and the rule that decides it knows the attribute', () => {
  assert.match(cardsPart, /<div data-row-ignore className="-my-\[12px\] shrink-0">/);
  assert.ok(INTERACTIVE_SELECTOR.includes('[data-row-ignore]'));
  // the same function the card's click handler uses: a click that lands inside an element matching the selector, within the row, is not the row's
  const row = { contains: (n: unknown) => n !== outside };
  const outside = {};
  const inSlot = { closest: (sel: string) => (sel === INTERACTIVE_SELECTOR ? { slot: true } : null) };
  const onText = { closest: () => null };
  assert.equal(isInteractiveTarget(inSlot as never, row as never), true);
  assert.equal(isInteractiveTarget(onText as never, row as never), false);
});

test('the card is still a list item that opens through rowHandlers, and the slot did not add a click handler of its own', () => {
  assert.match(cardsPart, /\{\.\.\.rowHandlers<HTMLLIElement>\(open\)\}/);
  const slot = cardsPart.slice(cardsPart.indexOf('<div data-row-ignore'), cardsPart.indexOf('<div data-row-ignore') + 120);
  assert.doesNotMatch(slot, /onClick|onKeyDown/);
});

test('the header comment says it: a cell is drawn twice, and what to do about an input that must exist once', () => {
  assert.match(raw, /a column's `cell` is rendered twice per row: no ids in it\. A cell that must exist once/);
  assert.match(raw, /`cardCell`/);
  assert.match(raw, /`cardActions`/);
});

test('the style guide says it too, in the props and in the warning', () => {
  const docs = read('src/app/(dashboard)/admin/ui-kit/_components/docs.ts');
  assert.match(docs, /prop\('cardCell'/);
  assert.match(docs, /prop\('cardActions'/);
  assert.match(docs, /a cell is drawn twice, in the table and on the card \(a `cardCell` gives the card its own version\)/);
});
