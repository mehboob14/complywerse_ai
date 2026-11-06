// What a record explorer does with the room it has, as pure functions (`node --test src/components/records/explorerFit.test.ts`). The room is the width of the explorer's own box,
// never the window's: under the application shell the rail takes 88px and the docked Work and context panel another 320 (a window of 1440 leaves the page 986px, a window of 1024
// leaves it 890), and a media query cannot know that. Two decisions, both from a width in px:
//   fitExplorer  the facet rail beside the list, or behind a Filters button; which labels the toolbar can afford
//   fitColumns   which columns of a table stay, and how wide: the first column (the title) keeps `titleMin` and the others give way in `dropRank` order, then the list is cards

/** The facet rail and the gap between it and the list. */
export const RAIL_WIDTH = 224;
export const RAIL_GAP = 16;
/** The narrowest list worth drawing beside the rail: the title column's 300, the frame's 2 and the columns the Documents list keeps beside a rail (tick 44, Status 116, Next review 124, Owner 68, menu 48). */
export const MIN_LIST_WITH_RAIL = 702;
/** A rail that is already there stays until the room is this much under what it needed to appear, so a page scrollbar (up to 17px) coming and going cannot flip it back and forth. */
export const RAIL_KEEP = 24;
/** Under this an explorer is a phone's: the quick chips scroll sideways and the buttons keep their icons only. */
export const COMPACT_BELOW = 640;
/** The toolbar's row (search 160, view switch 168, Sort 74, Expand all 113, Export 119, gaps; with a Filters button 92 more): under this its buttons keep icons only. */
export const TIGHT_BELOW = 680;
export const TIGHT_BELOW_NO_RAIL = 760;
/** What the title column keeps: two lines of a usual title beside its icon and its arrow. */
export const TITLE_MIN = 300;
/** The table frame's own border. */
export const FRAME = 2;

export interface ExplorerFit {
  /** the facet rail is a column beside the list (else a Filters button opens it as a sheet) */
  rail: boolean;
  /** the list column's width; null while the explorer has not been measured */
  list: number | null;
  /** phone-sized: the chips scroll sideways, the buttons keep their icons */
  compact: boolean;
  /** the toolbar's buttons keep their icons only */
  tight: boolean;
}

/** `width`: the explorer's box, null until measured (the wide layout: what the server draws). `railWas`: the last answer, for the margin that keeps the rail from flickering. */
export function fitExplorer(width: number | null, railWas = true, minList = MIN_LIST_WITH_RAIL): ExplorerFit {
  if (width == null) return { rail: true, list: null, compact: false, tight: false };
  const need = RAIL_WIDTH + RAIL_GAP + minList;
  const rail = width >= (railWas ? need - RAIL_KEEP : need);
  const list = rail ? width - RAIL_WIDTH - RAIL_GAP : width;
  return { rail, list, compact: width < COMPACT_BELOW, tight: list < (rail ? TIGHT_BELOW : TIGHT_BELOW_NO_RAIL) };
}

export interface FitColumn {
  key: string;
  /** its width in px */
  px: number;
  /** dropped when the title column would get less than its minimum: 1 goes first, then 2 ... no rank: it stays */
  dropRank?: number;
  /** a wider look (the owner's name beside the avatar) for when the title column would still keep `titleMin` after it */
  wide?: { px: number; titleMin: number };
}

export interface ColumnFit {
  /** the columns that stay, in their order */
  keys: string[];
  widths: Record<string, number>;
  /** the ones that took their wider look */
  wide: string[];
}

/** `columns`: every column but the first (the title takes what they leave). `room`: the table's box; `chrome`: the columns the table adds itself (tick, menu). null: not even the
 *  columns that always stay leave the title its minimum, so the list is cards. */
export function fitColumns(columns: readonly FitColumn[], room: number, chrome = 0, titleMin = TITLE_MIN): ColumnFit | null {
  const avail = room - FRAME - chrome;
  const widths: Record<string, number> = {};
  let shown = columns.slice();
  shown.forEach((c) => { widths[c.key] = c.px; });
  const used = () => shown.reduce((n, c) => n + widths[c.key], 0);
  const giveWay = shown.filter((c) => c.dropRank !== undefined).sort((a, b) => (a.dropRank as number) - (b.dropRank as number));
  for (const c of giveWay) {
    if (avail - used() >= titleMin) break;
    shown = shown.filter((s) => s !== c);
  }
  if (avail - used() < titleMin) return null;
  const wide: string[] = [];
  for (const c of shown) {
    if (c.wide && avail - (used() - widths[c.key] + c.wide.px) >= c.wide.titleMin) { widths[c.key] = c.wide.px; wide.push(c.key); }
  }
  return { keys: shown.map((c) => c.key), widths, wide };
}

/** Every column, as drawn before the table has been measured (the server's answer). */
export function allColumns(columns: readonly FitColumn[]): ColumnFit {
  const widths: Record<string, number> = {};
  columns.forEach((c) => { widths[c.key] = c.px; });
  return { keys: columns.map((c) => c.key), widths, wide: [] };
}
