// What a chart says in words, apart from React so `node --test` can pin it (chartText.test.ts): the table of its numbers that a screen reader reads in
// place of the picture, and the props that turn off recharts 3's own keyboard layer. The component is ChartFrame.tsx.

export type ChartCell = string | number | null | undefined;

export interface ChartData {
  /** the column names: the first names what each row is (the month, the status), the rest are the numbers the chart draws ("Created", "Published") */
  columns: readonly string[];
  /** one row per category, a cell per column: a number, or text; nothing is "No data", never 0 */
  rows: ReadonlyArray<readonly ChartCell[]>;
}

/** What a cell with no number says. A missing value is not a 0 to the person who hears it. */
export const NO_DATA = 'No data';
/** A table longer than this is cut, and says how many rows it left out. */
export const MAX_ROWS = 60;

// en-US on purpose, like lib/format.ts: every viewer reads the same text. Up to two decimals: a chart value of 7.5 is not "8".
const NUMBER = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

/** A number cell as words: "1,234", "7.5", "7.46"; text as it is; nothing, a blank, NaN and Infinity are "No data". */
export function chartCell(cell: ChartCell): string {
  if (typeof cell === 'number') return Number.isFinite(cell) ? NUMBER.format(cell === 0 ? 0 : cell) : NO_DATA;       // `=== 0`: -0 would print "-0"
  if (typeof cell === 'string') return cell.trim() === '' ? NO_DATA : cell;
  return NO_DATA;
}

/** The name of a row, from its first cell: text as it is, a number as plain digits (a year is "2026", not "2,026"); with none, "Row 3". */
function rowName(cell: ChartCell, index: number): string {
  if (typeof cell === 'string' && cell.trim() !== '') return cell;
  if (typeof cell === 'number' && Number.isFinite(cell)) return String(cell);
  return `Row ${index + 1}`;
}

export interface ChartTable {
  columns: string[];
  /** every row has a cell for every column */
  rows: string[][];
  /** how many rows were left out because there are more than `max` */
  more: number;
}

/** The table of a chart's numbers, as text. Every row has a cell for every column (a short row is filled with "No data", a cell beyond the last column
 *  is dropped), the first cell of a row names it, and more than `max` rows are cut with `more` saying how many were left out. */
export function chartTable(data: ChartData, max: number = MAX_ROWS): ChartTable {
  const columns = data.columns.map(String);
  const limit = Number.isFinite(max) ? Math.max(0, Math.floor(max)) : MAX_ROWS;
  const rows = data.rows.slice(0, limit).map((row, r) => columns.map((_, i) => (i === 0 ? rowName(row[0], r) : chartCell(row[i]))));
  return { columns, rows, more: Math.max(0, data.rows.length - limit) };
}

/** The props that turn off recharts 3's default keyboard layer: put them on the chart (`<AreaChart {...chartFocusOff()}>`) and on a `<Pie>`. Without
 *  them every chart is a tab stop of its own, announced as an "application" with no name, that grabs the arrow keys. `accessibilityLayer: false` is the
 *  chart's (the root svg is no tab stop and no application any more); `rootTabIndex: -1` is the Pie's (its group is a tab stop of its own otherwise).
 *  A chart that is a picture of numbers a table already gives (ChartFrame) has nothing to focus. */
export function chartFocusOff(): { accessibilityLayer: false; rootTabIndex: -1 } {
  return { accessibilityLayer: false, rootTabIndex: -1 };
}
