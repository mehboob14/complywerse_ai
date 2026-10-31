// Which columns of the library's register are drawn at which window width, so that the table never scrolls sideways where it does not have to. Pure (no React):
// `node --test` runs libraryColumns.test.ts against it. libraryTableLogic.ts still says WHICH columns exist (ids, labels, sort keys, the person's own choice of what
// to switch off); this says how wide each is and from which window width it may be drawn.
//
// The window's width is what CSS can see, so the rule is written as classes (`hidden md:table-cell`: the kit's priorityClass for the first step, then one class for each
// wider step) and there is no flash of the wrong layout. A column the person has switched off is never drawn; a column they have switched on is drawn where there is room
// for it. `fitsAt` is the proof, and the test runs it for every window width from a tablet up: the columns drawn, the tick box column and the Document column at its least
// add up to no more than the table's frame, whatever columns the person chose. The room is measured, not guessed: the frame is the window less the shell's sidebar
// (240px from 1280, a 64px rail from 1024, none below) less 63px of the page's own padding and the frame's scrollbar.
import { priorityClass } from '../../../../../components/ui/ds/tableModel.ts';
import { visibleColumns, type Column, type ColumnId } from './libraryTableLogic.ts';

/** px each column asks for, padding included (the kit's cells have 12px on each side). The Document column takes what the others leave. */
export const COLUMN_WIDTH: Record<ColumnId, number> = {
  title: 0, type: 100, lifecycle: 128, owner: 168, department: 160, frameworks: 184, attestation: 112, review: 128, version: 88, updated: 104, actions: 56,
};
/** The same widths as classes, written out in full for Tailwind (libraryColumns.test.ts holds the two together). */
export const WIDTH_CLASS: Record<ColumnId, string> = {
  title: '', type: 'w-[100px]', lifecycle: 'w-[128px]', owner: 'w-[168px]', department: 'w-[160px]', frameworks: 'w-[184px]', attestation: 'w-[112px]', review: 'w-[128px]',
  version: 'w-[88px]', updated: 'w-[104px]', actions: 'w-[56px]',
};
/** The column with the tick boxes, drawn only for a person who has a bulk action to use it for. */
export const TICK_WIDTH = 44;
/** The least room the Document column is given: a title wraps to two or three lines, then is cut. */
export const TITLE_MIN = 232;

/** The window width (px) from which a column may be drawn; 0 is always. Each step is where the room first holds everything before it, with a few pixels to spare
 *  (the earliest widths, measured against the frame: 819, 1067, 1355, 1455, 1615, 1703, 1807). */
export const COLUMN_FROM: Record<ColumnId, number> = {
  title: 0, lifecycle: 0, actions: 0,
  review: 768,
  owner: 830,
  frameworks: 1080,
  attestation: 1366,
  type: 1470,
  department: 1630, version: 1720, updated: 1820,
};

/** The Tailwind classes that draw a cell from that window width up. Written out in full: Tailwind finds a class by reading the source. */
const FROM_CLASS: Record<number, string> = {
  0: '',
  768: priorityClass(2),                                    // 'hidden md:table-cell'
  830: 'hidden min-[830px]:table-cell',
  1080: 'hidden min-[1080px]:table-cell',
  1366: 'hidden min-[1366px]:table-cell',
  1470: 'hidden min-[1470px]:table-cell',
  1630: 'hidden min-[1630px]:table-cell',
  1720: 'hidden min-[1720px]:table-cell',
  1820: 'hidden min-[1820px]:table-cell',
};
export const columnClass = (id: ColumnId): string => FROM_CLASS[COLUMN_FROM[id]] ?? '';

// ── the details panel beside the register (from 1024px) ──────────────────────────────────────────────────────────────────────────────────────
/** px the open details panel takes from the register, its gap included. */
export const PEEK_PANEL = 416;
/** While the panel is beside the register only these stay, from the width given: the register keeps what the person is reading. */
export const PEEK_FROM: Partial<Record<ColumnId, number>> = { title: 0, lifecycle: 0, actions: 0, review: 1440, owner: 1500 };
/** `[[data-peek]_&]` is "inside an element that has data-peek": the classes that drop a column while the panel is open. */
const PEEK_CLASS: Record<number, string> = {
  [-1]: '[[data-peek]_&]:hidden',
  1440: '[[data-peek]_&]:max-[1439px]:hidden',
  1500: '[[data-peek]_&]:max-[1499px]:hidden',
};
export const peekClass = (id: ColumnId): string => {
  const from = PEEK_FROM[id];
  return from === undefined ? PEEK_CLASS[-1] : from === 0 ? '' : PEEK_CLASS[from] ?? '';
};

/** Every class a cell of this column carries to find its place: where it is drawn, and whether it stays while the panel is open. */
export const placeClass = (id: ColumnId): string => `${columnClass(id)} ${peekClass(id)}`.trim();

// ── the room the table has ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The shell's sidebar at a window width: 240px from 1280, a 64px rail from 1024, none below. */
export const sidebarAt = (viewport: number): number => (viewport >= 1280 ? 240 : viewport >= 1024 ? 64 : 0);
/** The page's own side padding around the register's frame, and the frame's scrollbar, px (measured at 768, 900, 1024, 1280, 1366, 1440, 1536, 1680, 1920). */
export const GUTTER = 63;
/** The width of the register's frame at a window width. */
export const frameWidth = (viewport: number): number => viewport - sidebarAt(viewport) - GUTTER;

/** Of these columns, the ones drawn at a window width (the same rule the classes say: `placeClass`). */
export function drawn(columns: readonly Column[], viewport: number, peeking = false): Column[] {
  return columns.filter((c) => COLUMN_FROM[c.id] <= viewport && (!peeking || (PEEK_FROM[c.id] ?? Infinity) <= viewport));
}

/** The columns drawn at a window width, in order, for the person's choice (`hidden`: the optional columns they switched off). */
export function shownAt(viewport: number, hidden: readonly string[], peeking = false): Column[] {
  return drawn(visibleColumns(hidden), viewport, peeking);
}

/** How many cells a row that spans the whole table must span at a window width: the drawn columns, and the tick box column. A span of more than the table has adds a column
 *  of its own to a fixed layout and takes its share of the width, so this is the count of what is DRAWN, not of what is chosen. */
export const spanAt = (columns: readonly Column[], viewport: number, peeking: boolean, selectable: boolean): number =>
  drawn(columns, viewport, peeking).length + (selectable ? 1 : 0);

/** The width the drawn columns ask for: the Document column at its least, the tick box column when there is one. */
export const needAt = (viewport: number, hidden: readonly string[], peeking = false, selectable = true): number =>
  TITLE_MIN + (selectable ? TICK_WIDTH : 0) + shownAt(viewport, hidden, peeking).reduce((sum, c) => sum + COLUMN_WIDTH[c.id], 0);

/** The room the register has: the frame, less the details panel when it is open beside it. */
export const roomAt = (viewport: number, peeking = false): number => frameWidth(viewport) - (peeking ? PEEK_PANEL : 0);

export const fitsAt = (viewport: number, hidden: readonly string[], peeking = false, selectable = true): boolean =>
  needAt(viewport, hidden, peeking, selectable) <= roomAt(viewport, peeking);

// ── the phone's cards (below 768px) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export type CardField = 'lifecycle' | 'owner' | 'review';
/** What a card says besides the title and its menu: the status always, the owner and the next review unless the person switched that column off. */
export function cardFields(hidden: readonly string[]): CardField[] {
  return (['lifecycle', 'owner', 'review'] as const).filter((f) => f === 'lifecycle' || !hidden.includes(f));
}
