// node --test "src/app/(dashboard)/governance/documents/_workspace/libraryColumns.test.ts"
// Which columns the register draws at which window width, and the proof that they always fit: for every width from a tablet to a 4K screen, whatever columns the person
// switched on, the drawn columns, the tick box column and the Document column at its least add up to no more than the table's frame, with or without the details panel
// beside it. The widths of the frame are the ones measured in a browser (see GUTTER).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COLUMN_FROM, COLUMN_WIDTH, GUTTER, PEEK_FROM, PEEK_PANEL, TICK_WIDTH, TITLE_MIN, WIDTH_CLASS, cardFields, columnClass, drawn, fitsAt, frameWidth, needAt, peekClass,
  placeClass, roomAt, shownAt, sidebarAt, spanAt,
} from './libraryColumns.ts';
import { COLUMNS, visibleColumns } from './libraryTableLogic.ts';
import { DEFAULT_PREFS, OPTIONAL_COLUMNS } from './libraryPrefs.ts';

const ids = (viewport: number, hidden: readonly string[], peeking = false) => shownAt(viewport, hidden, peeking).map((c) => c.id);
const EVERYTHING: string[] = [];
const WIDTHS = Array.from({ length: (3840 - 768) / 4 + 1 }, (_, i) => 768 + i * 4);

test('the frame is the window less the sidebar and the padding: the widths measured in a browser', () => {
  assert.deepEqual([1440, 1280, 1024, 768].map(sidebarAt), [240, 240, 64, 0]);
  assert.equal(sidebarAt(1279), 64);
  assert.equal(sidebarAt(1023), 0);
  // measured clientWidth of the frame: 1440 -> 1137, 1366 -> 1063, 1280 -> 977, 1024 -> 897, 768 -> 705, 1920 -> 1617
  assert.deepEqual([1440, 1366, 1280, 1024, 768, 1920].map(frameWidth), [1137, 1063, 977, 897, 705, 1617]);
  assert.equal(GUTTER, 63);
});

test('every column has a width, a class for it, and a place: nothing is left out and nothing is made up', () => {
  assert.deepEqual(Object.keys(COLUMN_WIDTH).sort(), COLUMNS.map((c) => c.id).sort());
  assert.deepEqual(Object.keys(COLUMN_FROM).sort(), COLUMNS.map((c) => c.id).sort());
  assert.deepEqual(Object.keys(WIDTH_CLASS).sort(), COLUMNS.map((c) => c.id).sort());
  for (const c of COLUMNS) assert.equal(WIDTH_CLASS[c.id], c.id === 'title' ? '' : `w-[${COLUMN_WIDTH[c.id]}px]`, `the width class of ${c.id}`);     // Tailwind reads the class, the test reads the number
  assert.equal(COLUMN_WIDTH.title, 0);                                                                                           // the Document column takes what is left
  for (const id of OPTIONAL_COLUMNS) assert.ok(COLUMN_FROM[id] >= 0);
});

test('the classes are written out in full, and the first step is the kit\'s own priority class', () => {
  assert.equal(columnClass('title'), '');
  assert.equal(columnClass('lifecycle'), '');
  assert.equal(columnClass('actions'), '');
  assert.equal(columnClass('review'), 'hidden md:table-cell');                  // the kit's priorityClass(2): from 768px
  assert.equal(columnClass('owner'), 'hidden min-[830px]:table-cell');
  assert.equal(columnClass('frameworks'), 'hidden min-[1080px]:table-cell');
  assert.equal(columnClass('attestation'), 'hidden min-[1366px]:table-cell');
  assert.equal(columnClass('type'), 'hidden min-[1470px]:table-cell');
  for (const c of COLUMNS) {
    const from = COLUMN_FROM[c.id];
    assert.ok(from === 0 || columnClass(c.id).includes(from === 768 ? 'md:' : `min-[${from}px]:`), `${c.id} is drawn from ${from}`);
  }
});

test('with the person\'s default columns nothing scrolls sideways at the widths of real screens, and the Document column is never squeezed', () => {
  for (const viewport of [768, 800, 829, 830, 900, 1023, 1024, 1079, 1080, 1279, 1280, 1336, 1366, 1440, 1469, 1470, 1536, 1600, 1680, 1920, 2560]) {
    assert.ok(fitsAt(viewport, DEFAULT_PREFS.hidden), `${viewport}: needs ${needAt(viewport, DEFAULT_PREFS.hidden)}px of ${roomAt(viewport)}px`);
    assert.ok(roomAt(viewport) - (needAt(viewport, DEFAULT_PREFS.hidden) - TITLE_MIN) >= TITLE_MIN, `${viewport}: the Document column has ${roomAt(viewport) - (needAt(viewport, DEFAULT_PREFS.hidden) - TITLE_MIN)}px`);
  }
});

test('and whatever the person switched ON, at EVERY width from 768 to 3840 the drawn columns fit: a column they chose is drawn where there is room for it, never beyond', () => {
  for (const viewport of WIDTHS) {
    assert.ok(fitsAt(viewport, EVERYTHING), `${viewport}: every column on needs ${needAt(viewport, EVERYTHING)}px of ${roomAt(viewport)}px`);
    assert.ok(fitsAt(viewport, EVERYTHING, false, false), `${viewport}: without the tick column`);
    assert.ok(fitsAt(viewport, DEFAULT_PREFS.hidden), `${viewport}: the default columns`);
  }
});

test('a step appears as late as it must and as early as it can: each column is drawn from the first width where it fits with everything before it', () => {
  // "as early as it can": one step before its width the column would not fit (so the thresholds are not just safe, they are the room there is)
  for (const id of ['review', 'owner', 'frameworks', 'attestation', 'type', 'department', 'version', 'updated'] as const) {
    const from = COLUMN_FROM[id];
    assert.ok(fitsAt(from, EVERYTHING), `${id} fits at ${from}`);
    const earlier = from - 24;                                           // a few pixels to spare, not a different layout
    const need = TITLE_MIN + TICK_WIDTH + visibleColumns(EVERYTHING).filter((c) => (COLUMN_FROM[c.id] <= earlier) || c.id === id).reduce((s, c) => s + COLUMN_WIDTH[c.id], 0);
    assert.ok(need > roomAt(earlier) || from === 768, `${id} would not have fitted at ${earlier}: needs ${need}px of ${roomAt(earlier)}px`);
  }
});

test('a column the person switched off is never drawn, at any width', () => {
  for (const viewport of [768, 1280, 1920, 3840]) {
    for (const off of ['owner', 'frameworks', 'review', 'lifecycle', 'type', 'attestation']) assert.ok(!ids(viewport, [off]).includes(off as never), `${off} at ${viewport}`);
    assert.deepEqual(ids(viewport, [...OPTIONAL_COLUMNS]), ['title', 'actions']);                    // the title and the actions cannot be switched off
  }
  assert.deepEqual(ids(1920, []), ['title', 'type', 'lifecycle', 'owner', 'department', 'frameworks', 'attestation', 'review', 'version', 'updated', 'actions']);
});

test('columns drop as the window narrows, the order they were asked for: the title, the status and the menu are always there', () => {
  assert.deepEqual(ids(1470, DEFAULT_PREFS.hidden), ['title', 'type', 'lifecycle', 'owner', 'frameworks', 'attestation', 'review', 'actions']);
  assert.deepEqual(ids(1440, DEFAULT_PREFS.hidden), ['title', 'lifecycle', 'owner', 'frameworks', 'attestation', 'review', 'actions']);
  assert.deepEqual(ids(1280, DEFAULT_PREFS.hidden), ['title', 'lifecycle', 'owner', 'frameworks', 'review', 'actions']);
  assert.deepEqual(ids(1024, DEFAULT_PREFS.hidden), ['title', 'lifecycle', 'owner', 'review', 'actions']);
  assert.deepEqual(ids(768, DEFAULT_PREFS.hidden), ['title', 'lifecycle', 'review', 'actions']);
  for (let viewport = 0; viewport <= 3840; viewport += 8) for (const id of ['title', 'lifecycle', 'actions']) assert.ok(COLUMN_FROM[id as 'title'] === 0 && ids(viewport, []).includes(id as never));
});

test('with the details panel beside the register (from 1024px) only the columns being read stay, and they fit in what the panel leaves', () => {
  assert.equal(PEEK_PANEL, 416);
  for (const viewport of WIDTHS.filter((w) => w >= 1024)) {
    assert.ok(fitsAt(viewport, EVERYTHING, true), `${viewport}: the register beside the panel needs ${needAt(viewport, EVERYTHING, true)}px of ${roomAt(viewport, true)}px`);
    assert.ok(fitsAt(viewport, EVERYTHING, true, false), `${viewport}: without the tick column`);
  }
  assert.deepEqual(ids(1024, DEFAULT_PREFS.hidden, true), ['title', 'lifecycle', 'actions']);
  assert.deepEqual(ids(1280, DEFAULT_PREFS.hidden, true), ['title', 'lifecycle', 'actions']);
  assert.deepEqual(ids(1440, DEFAULT_PREFS.hidden, true), ['title', 'lifecycle', 'review', 'actions']);
  assert.deepEqual(ids(1500, DEFAULT_PREFS.hidden, true), ['title', 'lifecycle', 'owner', 'review', 'actions']);
  // the classes that do it: a column that is never kept is hidden whenever the panel is open; one kept from a width is hidden below it
  assert.equal(peekClass('frameworks'), '[[data-peek]_&]:hidden');
  assert.equal(peekClass('title'), '');
  assert.equal(peekClass('review'), '[[data-peek]_&]:max-[1439px]:hidden');
  assert.equal(peekClass('owner'), '[[data-peek]_&]:max-[1499px]:hidden');
  assert.equal(placeClass('review'), 'hidden md:table-cell [[data-peek]_&]:max-[1439px]:hidden');
  assert.equal(placeClass('title'), '');
  assert.ok(Object.keys(PEEK_FROM).every((id) => COLUMNS.some((c) => c.id === id)));
});

test('a phone card says the status always, and the owner and the next review unless the person switched that column off', () => {
  assert.deepEqual(cardFields([]), ['lifecycle', 'owner', 'review']);
  assert.deepEqual(cardFields(DEFAULT_PREFS.hidden), ['lifecycle', 'owner', 'review']);               // department, version and updated are not on a card
  assert.deepEqual(cardFields(['owner']), ['lifecycle', 'review']);
  assert.deepEqual(cardFields(['review']), ['lifecycle', 'owner']);
  assert.deepEqual(cardFields(['lifecycle']), ['lifecycle', 'owner', 'review']);                      // the status is not optional on a card: a document with no status said is a document unsaid
  assert.deepEqual(cardFields(['owner', 'review', 'lifecycle']), ['lifecycle']);
});

test('a row that spans the whole table spans what is drawn, never more: the count the browser measured in the header (a longer span adds a column of its own to a fixed layout)', () => {
  const chosen = visibleColumns(DEFAULT_PREFS.hidden);
  // measured header cells (the tick box column included): 1440 -> 8, 1280 -> 7, 1024 -> 6, 768 -> 5
  assert.deepEqual([1440, 1280, 1024, 768].map((w) => spanAt(chosen, w, false, true)), [8, 7, 6, 5]);
  assert.equal(spanAt(chosen, 1500, false, true), 9);                                  // the Type column appears from 1470
  assert.equal(spanAt(chosen, 1280, false, false), 6);                                 // a person with no bulk action has no tick column
  assert.equal(spanAt(chosen, 1280, true, true), 4);                                   // the details panel beside it: the tick box, the Document, the status, the menu
  assert.deepEqual(drawn(chosen.filter((c) => c.id !== 'department'), 1920, false).map((c) => c.id), shownAt(1920, DEFAULT_PREFS.hidden).map((c) => c.id));   // the Folders view leaves Department out
  for (const w of WIDTHS) assert.equal(spanAt(visibleColumns(EVERYTHING), w, false, true), shownAt(w, EVERYTHING).length + 1);
});
