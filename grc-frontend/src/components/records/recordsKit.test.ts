// node --test "src/components/records/recordsKit.test.ts"
// The facet explorer stays what it was built to be, read from its sources (the repo's habit for screens): on the design-system kit's token rules, with no control that appears only on
// hover, no native dialog, no knowledge of any module (so Evidence, Tasks, the Risk register, Vendors and Assets can configure it later), and a keyboard layer that acts only through
// the tested decision (explorerModel.keyAction).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { findViolations } from '../ui/ds/kitRules.ts';

const DIR = new URL('./', import.meta.url);
const names = readdirSync(DIR).filter((n) => /\.tsx?$/.test(n) && !/\.test\.ts$/.test(n));
const read = (name: string) => readFileSync(new URL(name, DIR), 'utf8');
const lines = (src: string) => src.split(/\r?\n/);
const code = (line: string) => line.replace(/(^|\s)\/\/\s.*$/, '$1').replace(/^\s*(\*|\/\*)/, '');

test('the explorer holds the kit token rules: no named text size, palette colour, hex, named shadow or radius, no text under 12px', () => {
  const found: string[] = [];
  for (const name of names) for (const v of findViolations(read(name))) found.push(`${name}:${v.line} ${v.rule} ${v.text}`);
  assert.deepEqual(found, []);
});

test('no control appears only on hover, and there is no native dialog', () => {
  const found: string[] = [];
  for (const name of names) lines(read(name)).forEach((line, i) => {
    const c = code(line);
    if (/opacity-0\b[^'"`]*group-(hover|focus)|group-(hover|focus)[^'"`]*opacity-(100|[1-9]\d)/.test(c)) found.push(`${name}:${i + 1} hover-only`);
    if (/\bwindow\.(confirm|alert|prompt)\s*\(|(^|[^.\w])(alert|prompt)\s*\(/.test(c)) found.push(`${name}:${i + 1} native dialog`);
  });
  assert.deepEqual(found, []);
});

test('the explorer knows no module: it imports the kit, the library of shared helpers and itself, never a page or a feature folder', () => {
  const found: string[] = [];
  for (const name of names) lines(read(name)).forEach((line, i) => {
    const m = /from '([^']+)'/.exec(line);
    if (!m) return;
    const from = m[1];
    if (from.startsWith('./') || from.startsWith('../') && !/\(dashboard\)|governance/.test(from)) return;
    if (/^@\/(components\/ui|lib\/)/.test(from) || /^(react|react-dom|lucide-react|clsx|@tanstack\/react-query)$/.test(from)) return;
    found.push(`${name}:${i + 1} ${from}`);
  });
  assert.deepEqual(found, []);
});

test('the keyboard layer acts only through keyAction, and never from a field, a menu or a dialog', () => {
  const keys = read('useExplorerKeys.ts');
  assert.ok(keys.includes('keyAction(') && keys.includes('placeOf(e.target)') && keys.includes('overlayIsOpen()'));
  assert.ok(keys.includes("document.addEventListener('keydown'") && keys.includes("document.removeEventListener('keydown'"));
});

test('the list draws the table OR the cards by the room its own box has, each row opens from the keyboard, and the card targets are 44px', () => {
  const table = read('RecordTable.tsx');
  assert.ok(table.includes('useContainerWidth(box)') && table.includes('fitColumns(asked, room, chrome)') && table.includes(') : ('));
  assert.ok(table.includes('onActivate={() => onActivate(record)}') && table.includes('data-record-row={id}'));
  assert.ok(table.includes('min-w-[44px]') && table.includes("'w-[44px]'"));
});

test('no part of the explorer decides its layout by the window: no breakpoint variant, no viewport height, no media query for a width (the room is the explorer\'s own box)', () => {
  const found: string[] = [];
  for (const name of names) lines(read(name)).forEach((line, i) => {
    const c = code(line);
    if (/(^|[\s"'`])(max-)?(sm|md|lg|xl|2xl):/.test(c)) found.push(`${name}:${i + 1} breakpoint variant`);
    if (/\b\d*(d|s|l)?vh\b|calc\(100v/.test(c)) found.push(`${name}:${i + 1} viewport height`);
    if (/matchMedia|\(min-width|\(max-width|innerWidth|innerHeight/.test(c)) found.push(`${name}:${i + 1} window width`);
  });
  assert.deepEqual(found, []);
});

test('nothing in the explorer is fixed to the window or pinned under a bar the page may not have: the bulk bar floats at the foot of the page\'s own scroll, the table scrolls with the page', () => {
  const bar = read('BulkBar.tsx').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(!/\bfixed\b/.test(bar));
  assert.ok(bar.includes('sticky bottom-[12px]'));
  assert.ok(!/sticky top-\[/.test(read('RecordExplorer.tsx')));                       // the rail is in the page's flow, not pinned under a bar
  assert.ok(read('RecordTable.tsx').includes('overflow-clip'));                       // a rounded frame that is not a scroll box: the header sticks to the page's scroll
});
