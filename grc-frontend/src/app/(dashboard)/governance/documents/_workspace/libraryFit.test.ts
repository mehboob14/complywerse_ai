// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryFit.test.ts"
// The Documents list under the application shell: for every width the explorer can have (a window of 390 to 2560, with the shell's 88px rail, with its docked panel and without it),
// the title column keeps at least what two lines of a usual title need, or the list is cards; the widths the shell really gives (measured in a browser, 2026-11-06) are named.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FRAME, MIN_LIST_WITH_RAIL, RAIL_KEEP, TITLE_MIN, fitColumns, fitExplorer } from '../../../../../components/records/explorerFit.ts';
import { DOCUMENT_FIT_COLUMNS } from './libraryFit.ts';

const TICK = 44;
const MENU = 48;
const CHROME = TICK + MENU;

/** What the Documents explorer's list has at a given explorer width: the width of the list column, and what the table makes of it. */
function listAt(width: number, railWas = true) {
  const fit = fitExplorer(width, railWas);
  return { fit, cols: fit.list == null ? null : fitColumns(DOCUMENT_FIT_COLUMNS, fit.list, CHROME) };
}
const titleWidth = (width: number): number | null => {
  const { fit, cols } = listAt(width);
  if (!cols || fit.list == null) return null;
  return fit.list - FRAME - CHROME - cols.keys.reduce((n, k) => n + cols.widths[k], 0);
};

test('the widths the shell really gives the library: 986 (a 1440 window, panel docked), 1306 (panel shut), 1146 (1280), 890 (1024), 736 (768)', () => {
  // 1440 with the panel docked: the rail stays and the list is a table whose title column has well over 300, with Status, Next review and Owner (Frameworks gave way)
  const docked = listAt(986);
  assert.equal(docked.fit.rail, true);
  assert.deepEqual(docked.cols?.keys, ['status', 'review', 'owner']);
  assert.ok((titleWidth(986) ?? 0) >= 330);
  // 1440 with the panel shut: every column, and the owner's name
  assert.deepEqual(listAt(1306).cols?.keys, ['status', 'review', 'owner', 'frameworks']);
  assert.deepEqual(listAt(1306).cols?.wide, ['owner']);
  assert.ok((titleWidth(1306) ?? 0) >= 420);
  // 1280: the rail and every column, the owner as an avatar
  assert.equal(listAt(1146).fit.rail, true);
  assert.deepEqual(listAt(1146).cols?.keys, ['status', 'review', 'owner', 'frameworks']);
  assert.deepEqual(listAt(1146).cols?.wide, []);
  assert.ok((titleWidth(1146) ?? 0) >= 380);
  // 1024: no room for a rail AND a list worth reading, so the filters are one button away and the table has every column
  assert.equal(listAt(890, false).fit.rail, false);
  assert.deepEqual(listAt(890, false).cols?.keys, ['status', 'review', 'owner', 'frameworks']);
  assert.ok((titleWidth(890) ?? 0) >= 380);
  // 768: a table without Frameworks
  assert.deepEqual(listAt(736, false).cols?.keys, ['status', 'review', 'owner']);
});

test('whatever width the explorer has, the title column keeps TITLE_MIN or the list is cards, and the cards come before the columns a person cannot do without are lost', () => {
  let railWas = true;
  for (let width = 300; width <= 2400; width += 3) {
    const { fit, cols } = listAt(width, railWas);
    railWas = fit.rail;
    if (!cols) {
      assert.ok((fit.list ?? 0) - FRAME - CHROME - 116 - 124 < TITLE_MIN, `cards at ${width} with room`);        // Status and Next review stay
      continue;
    }
    assert.ok(cols.keys.includes('status') && cols.keys.includes('review'), `${width}`);
    const used = cols.keys.reduce((n, k) => n + cols.widths[k], 0);
    assert.ok((fit.list ?? 0) - FRAME - CHROME - used >= TITLE_MIN, `${width}`);
  }
});

test('the rail is never drawn where the list beside it would be more than the keep margin under its minimum', () => {
  for (let width = 300; width <= 2400; width += 3) {
    const fit = fitExplorer(width, true);
    if (fit.rail) assert.ok((fit.list ?? 0) >= MIN_LIST_WITH_RAIL - RAIL_KEEP, `${width}`);
  }
});

test('the list minimum with the rail is the title, the tick, Status, Next review, the owner and the menu: a table beside the rail never loses the owner', () => {
  const beside = fitColumns(DOCUMENT_FIT_COLUMNS, MIN_LIST_WITH_RAIL, CHROME);
  assert.ok(beside?.keys.includes('owner'));
});
