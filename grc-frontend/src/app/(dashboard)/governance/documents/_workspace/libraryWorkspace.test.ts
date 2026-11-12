// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryWorkspace.test.ts"
// The Workspace's own files (Group by, the grouped List, the Calendar, the Group menu) hold the library's promises, read from the sources as libraryKit.test.ts does for the rest of the folder:
// the kit's token rules, the room (not the window) decides the layout, no bare <p>/<td>/<th>/<h2>/<h3>, a header that is a real button, nothing that appears only on hover or is dragged,
// and the model files that `node --test` loads import their neighbours with the .ts extension and never React.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { findViolations } from '../../../../../components/ui/ds/kitRules.ts';

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
const COMPONENTS = ['GroupedRows.tsx', 'CalendarView.tsx', 'GroupMenu.tsx'];
const MODELS = ['libraryGroups.ts', 'libraryCalendar.ts', 'libraryViews.ts'];
const code = (line: string) => line.replace(/(^|\s)\/\/\s.*$/, '$1').replace(/^\s*(\*|\/\*)/, '');

test('the Workspace components hold the kit\'s token rules: no named text size, palette colour, hex, named shadow or radius, no text under 12px', () => {
  const found: string[] = [];
  for (const name of COMPONENTS) for (const v of findViolations(read(name))) found.push(`${name}:${v.line} ${v.rule} ${v.text}`);
  assert.deepEqual(found, []);
});

test('the room decides, not the window: no breakpoint variant and no viewport height in the Workspace components', () => {
  const found: string[] = [];
  for (const name of COMPONENTS) {
    read(name).split(/\r?\n/).forEach((line, i) => {
      const c = code(line);
      if (/(^|[\s"'`])(max-)?(sm|md|lg|xl|2xl):/.test(c)) found.push(`${name}:${i + 1} breakpoint variant`);
      if (/\b\d*(d|s|l)?vh\b|calc\(100v/.test(c)) found.push(`${name}:${i + 1} viewport height`);
    });
  }
  assert.deepEqual(found, []);
});

test('no bare <p>, <td>, <th>, <h2> or <h3>: each names a text size (the platform CSS gives a bare one 11.5px)', () => {
  const found: string[] = [];
  for (const name of COMPONENTS) {
    const src = read(name).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of Array.from(src.matchAll(/<(p|td|th|h2|h3)(?=[\s>])([^>]*)>/g))) {
      if (!/!?text-ds-(title|section|body|label)/.test(m[2])) found.push(`${name}: <${m[1]}${m[2].slice(0, 70)}`);
    }
  }
  assert.deepEqual(found, []);
});

test('a group\'s header is a real button that says whether it is open, its tick box is not a click on the row, it is pinned to the left and never clipped', () => {
  const rows = read('GroupedRows.tsx');
  assert.ok(rows.includes('aria-expanded={open}') && rows.includes('aria-label={groupAria(group)}'));
  assert.ok(rows.includes("closest('[data-no-peek], input, label')"));
  assert.ok(rows.includes('sticky left-[12px]'));
  assert.ok(!/overflow-hidden/.test(rows));                                                 // overflow would unpin the header
  assert.ok(rows.includes('data-folder-row={group.key}'));                                   // the explorer's skip link lands on a header or a record
  // a document's full row is the table's own (ticks, cursor, drawer), one level under its header; the slim lines are not rows
  assert.ok(rows.includes('recordRows(p.rows, 1, i.toggleRow)') && rows.includes("kind: 'more'") && rows.includes("kind: 'group'"));
});

test('nothing appears only on hover or is dragged: the calendar is read-only, every action is a button', () => {
  for (const name of COMPONENTS) {
    const src = read(name);
    assert.ok(!/opacity-0\b[^'"`]*group-(hover|focus)|group-(hover|focus)[^'"`]*opacity-(100|[1-9]\d)/.test(src), name);
    assert.ok(!/draggable|onDrag|onDrop/.test(src), name);
    assert.ok(!/\bwindow\.(confirm|alert|prompt)\s*\(/.test(src), name);
    assert.ok(!/\b(gpt|openai|anthropic|claude)\b/i.test(src), name);
  }
  const calendar = read('CalendarView.tsx');
  assert.ok(calendar.includes('grid-cols-[repeat(auto-fill,minmax(220px,1fr))]'));          // as many cards as the box holds, one on a phone
  assert.ok(calendar.includes('onClick={() => onOpen(d)}') && calendar.includes('aria-current'));
});

test('the Group by menu is the kit\'s Menu with one radio item for each grouping, the choice checked, the grouping in the button\'s label', () => {
  const menu = read('GroupMenu.tsx');
  assert.ok(menu.includes('<Menu label={groupButtonLabel(value)}') && menu.includes('radio: true') && menu.includes('checked: value === k'));
});

test('the model files are pure: no React, and every neighbour is imported with its .ts extension (so node --test loads them)', () => {
  for (const name of MODELS) {
    const src = read(name);
    assert.ok(!/from 'react'|from "react"/.test(src), name);
    const bad = Array.from(src.matchAll(/from '(\.[^']*)'/g)).map((m) => m[1]).filter((p) => !p.endsWith('.ts'));
    assert.deepEqual(bad, [], name);
  }
});
