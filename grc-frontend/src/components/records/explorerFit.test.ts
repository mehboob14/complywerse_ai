// node --test "src/components/records/explorerFit.test.ts"
// What an explorer does with the room it has: the rail beside the list or behind a button, which toolbar words stay, which columns of a table stay and how wide.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { COMPACT_BELOW, FRAME, MIN_LIST_WITH_RAIL, RAIL_GAP, RAIL_KEEP, RAIL_WIDTH, TIGHT_BELOW, TITLE_MIN, allColumns, fitColumns, fitExplorer, fitExplorerTop, type FitColumn } from './explorerFit.ts';

const COLUMNS: FitColumn[] = [
  { key: 'status', px: 100 },
  { key: 'date', px: 100 },
  { key: 'owner', px: 60, dropRank: 2, wide: { px: 160, titleMin: 400 } },
  { key: 'tags', px: 80, dropRank: 1 },
];

test('an explorer that has not been measured draws the wide layout (the server\'s answer), and so does a table', () => {
  assert.deepEqual(fitExplorer(null), { rail: true, list: null, compact: false, tight: false });
  assert.deepEqual(allColumns(COLUMNS).keys, ['status', 'date', 'owner', 'tags']);
  assert.equal(allColumns(COLUMNS).widths.owner, 60);
});

test('the rail sits beside the list when the list keeps its minimum, else it is behind a button; the list is what the rail leaves', () => {
  const need = RAIL_WIDTH + RAIL_GAP + MIN_LIST_WITH_RAIL;
  assert.equal(fitExplorer(need, false).rail, true);
  assert.equal(fitExplorer(need - 1, false).rail, false);
  assert.equal(fitExplorer(need, false).list, MIN_LIST_WITH_RAIL);
  assert.equal(fitExplorer(need - 1, false).list, need - 1);
  assert.equal(fitExplorer(1000, true).list, 1000 - RAIL_WIDTH - RAIL_GAP);
});

test('a rail that is there stays through the width a page scrollbar takes, so it cannot flicker; one that is not there needs the full room to appear', () => {
  const need = RAIL_WIDTH + RAIL_GAP + MIN_LIST_WITH_RAIL;
  assert.equal(fitExplorer(need - 17, true).rail, true);                 // a scrollbar of 17px appeared and the rail stays
  assert.equal(fitExplorer(need - RAIL_KEEP - 1, true).rail, false);
  assert.equal(fitExplorer(need - 17, false).rail, false);               // and it does not come back until the room is whole
  assert.equal(fitExplorer(need, false).rail, true);
});

test('under 640 an explorer is compact; the toolbar keeps icons only when its row would not fit, sooner when a Filters button is in it', () => {
  assert.equal(fitExplorer(COMPACT_BELOW - 1).compact, true);
  assert.equal(fitExplorer(COMPACT_BELOW).compact, false);
  assert.equal(fitExplorer(736, false).tight, true);                      // no rail: the Filters button and every label do not fit in 736
  assert.equal(fitExplorer(890, false).tight, false);
  assert.equal(fitExplorer(986, true).tight, false);                      // the shell's 1440 with the panel docked: rail and list, every label
});

test('with the filters in a bar above the list there is no rail and the list has the whole box; a phone-sized box gives the bar up for the Filters button', () => {
  assert.deepEqual(fitExplorerTop(null), { rail: false, list: null, compact: false, tight: false });          // not measured: the wide layout, as the server draws it
  for (const width of [320, 390, COMPACT_BELOW - 1, COMPACT_BELOW, 700, 986, 1200, 2000]) {
    const fit = fitExplorerTop(width);
    assert.equal(fit.rail, false, `${width}`);
    assert.equal(fit.list, width, `${width}`);
    assert.equal(fit.compact, width < COMPACT_BELOW, `${width}`);
  }
  assert.equal(fitExplorerTop(TIGHT_BELOW - 1).tight, true);
  assert.equal(fitExplorerTop(TIGHT_BELOW).tight, false);
  // the side rail's answers are not touched by it: the same inputs still give the same fit
  assert.deepEqual(fitExplorer(1200, true), { rail: true, list: 1200 - RAIL_WIDTH - RAIL_GAP, compact: false, tight: false });
  assert.equal(fitExplorer(700, true).rail, false);
});

test('the columns give way in rank order until the title keeps its minimum, and the list is cards when the ones that stay leave it less', () => {
  const room = (avail: number, chrome = 0) => avail + FRAME + chrome;
  // 340 for the title column with everything (100 + 100 + 60 + 80 = 340 used): 640 in all
  assert.deepEqual(fitColumns(COLUMNS, room(340 + TITLE_MIN))?.keys, ['status', 'date', 'owner', 'tags']);
  assert.deepEqual(fitColumns(COLUMNS, room(340 + TITLE_MIN - 1))?.keys, ['status', 'date', 'owner']);           // tags first
  assert.deepEqual(fitColumns(COLUMNS, room(260 + TITLE_MIN - 1))?.keys, ['status', 'date']);                    // then owner
  assert.equal(fitColumns(COLUMNS, room(200 + TITLE_MIN - 1)), null);                                           // status and date stay: cards
  assert.deepEqual(fitColumns(COLUMNS, room(200 + TITLE_MIN))?.keys, ['status', 'date']);
});

test('the tick and menu columns the table adds are part of what the title has to leave room for', () => {
  const without = fitColumns(COLUMNS, 700, 0);
  const withChrome = fitColumns(COLUMNS, 700, 92);
  assert.ok(without && withChrome);
  assert.ok(without.keys.length > withChrome.keys.length);
});

test('a column takes its wider look only when the title still keeps what the wide look asks for, and then it is counted in what is left for the others', () => {
  const plenty = fitColumns(COLUMNS, FRAME + 340 + 500);                 // the title has 500 with every column: the owner's 100 more would leave it 400, which is what the wide look asks for
  assert.deepEqual(plenty?.wide, ['owner']);
  assert.equal(plenty?.widths.owner, 160);
  const tight = fitColumns(COLUMNS, FRAME + 340 + 499);                  // 499: 399 after it
  assert.deepEqual(tight?.wide, []);
  assert.equal(tight?.widths.owner, 60);
});

test('the fit never leaves the title less than its minimum, at any width a table is drawn at', () => {
  for (let room = 300; room <= 2400; room += 7) {
    const fit = fitColumns(COLUMNS, room);
    if (!fit) continue;
    const used = fit.keys.reduce((n, k) => n + fit.widths[k], 0);
    assert.ok(room - FRAME - used >= TITLE_MIN, `${room}`);
  }
});
