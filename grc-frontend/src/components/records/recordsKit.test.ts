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
    if (/^@\/(components\/ui|lib\/)/.test(from) || /^(react|react-dom|lucide-react|clsx)$/.test(from)) return;
    found.push(`${name}:${i + 1} ${from}`);
  });
  assert.deepEqual(found, []);
});

test('the keyboard layer acts only through keyAction, and never from a field, a menu or a dialog', () => {
  const keys = read('useExplorerKeys.ts');
  assert.ok(keys.includes('keyAction(') && keys.includes('placeOf(e.target)') && keys.includes('overlayIsOpen()'));
  assert.ok(keys.includes("document.addEventListener('keydown'") && keys.includes("document.removeEventListener('keydown'"));
});

test('the list draws the table OR the cards for the window, each row opens from the keyboard, and the phone targets are 44px', () => {
  const table = read('RecordTable.tsx');
  assert.ok(table.includes('useMinWidth(768)') && table.includes('wide ? ('));
  assert.ok(table.includes('onActivate={() => onActivate(record)}') && table.includes('data-record-row={id}'));
  assert.ok(table.includes('min-w-[44px]') && table.includes('max-md:w-[44px]'));
});
