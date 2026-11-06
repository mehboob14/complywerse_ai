// The pure part of the table kit (Table.tsx, RegisterTable.tsx): which way a click on a header sorts, what a header says about it
// (aria-sort), how rows are put in order on the client, which columns give way on a narrower window, when a click or a key on a row means
// "open this row", and how many rows to say there are. No React, so `node --test` runs tableModel.test.ts against it.
import { formatCount } from '../../../lib/format.ts';

// ── sorting ──────────────────────────────────────────────────────────────────
export type SortDir = 'asc' | 'desc';
/** The column the rows are in the order of, and which way; null is the order the rows came in. */
export type SortState = { key: string; dir: SortDir } | null;
/** `asc-desc-none`: ascending, descending, then back to the order the rows came in. `asc-desc`: the two directions only. */
export type SortCycle = 'asc-desc-none' | 'asc-desc';

/** The sort a click on the header of column `key` asks for. A column starts in `firstDir` (ascending unless the column answers its
 *  question the other way round, e.g. "Updated" newest first), the next click reverses it, the one after clears the sort (or, with the
 *  `asc-desc` cycle, starts over). Another column always starts at `firstDir`. */
export function nextSort(current: SortState, key: string, cycle: SortCycle = 'asc-desc-none', firstDir: SortDir = 'asc'): SortState {
  if (!current || current.key !== key) return { key, dir: firstDir };
  if (current.dir === firstDir) return { key, dir: firstDir === 'asc' ? 'desc' : 'asc' };
  return cycle === 'asc-desc' ? { key, dir: firstDir } : null;
}

export type AriaSort = 'ascending' | 'descending' | 'none';

/** The `aria-sort` of a column header: undefined when the column cannot be sorted (the attribute is left off), else which way, or 'none'. */
export function ariaSort(columnKey: string, sort: SortState, sortable: boolean): AriaSort | undefined {
  if (!sortable) return undefined;
  if (!sort || sort.key !== columnKey) return 'none';
  return sort.dir === 'asc' ? 'ascending' : 'descending';
}

/** What a column holds for sorting. A Date is its moment (parseUtc(...) from lib/serverTime.ts fits); nothing, blank text and NaN are empty. */
export type SortValue = string | number | Date | null | undefined;

// The comparison `a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })` makes, built once ("Item 2" before "Item 10", "a" = "A").
const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** null = empty. 0 is a value. */
function keyOf(value: SortValue): number | string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value === 'number') return Number.isNaN(value) ? null : value;
  return value.trim() === '' ? null : value;
}

const compare = (a: number | string, b: number | string): number =>
  typeof a === 'number' && typeof b === 'number' ? (a < b ? -1 : a > b ? 1 : 0) : COLLATOR.compare(String(a), String(b));

/** `rows` in the order `sort` asks for, as a new array (the input is not touched). Numbers go by value, text in natural order, and a row with
 *  nothing in the column is last whichever way it sorts. Rows that compare equal keep the order they came in, descending too. No sort: a copy. */
export function sortRows<T>(rows: readonly T[], sort: SortState, valueOf: (row: T, key: string) => SortValue): T[] {
  if (!sort) return rows.slice();
  const sign = sort.dir === 'asc' ? 1 : -1;
  const keyed = rows.map((row, index) => ({ row, index, key: keyOf(valueOf(row, sort.key)) }));
  keyed.sort((a, b) => {
    if (a.key === null || b.key === null) return a.key === b.key ? a.index - b.index : a.key === null ? 1 : -1;
    const c = compare(a.key, b.key) * sign;
    return c !== 0 ? c : a.index - b.index;
  });
  return keyed.map((k) => k.row);
}

// ── columns that give way ────────────────────────────────────────────────────
/** 1 is always shown; 2 from 768px; 3 from 1024px. */
export type ColumnPriority = 1 | 2 | 3;

/** Classes for a header or body cell of a column of this priority. CSS decides (no script, so no flash of the wrong layout). The full class
 *  names are written out here for Tailwind to find. */
export function priorityClass(priority: ColumnPriority = 1): string {
  return priority === 2 ? 'hidden md:table-cell' : priority === 3 ? 'hidden lg:table-cell' : '';
}

// ── pressing a row ───────────────────────────────────────────────────────────
/** What inside a row handles its own click and Enter (the existing registers' lists, joined): a click or key there is not a click on the row. */
export const INTERACTIVE_SELECTOR =
  'a, button, input, select, textarea, label, summary, [role="button"], [role="menu"], [role="dialog"], [data-row-ignore]';

/** A click that landed on (or inside) a control of the row. `row` bounds the search: a control around the whole row does not count, and React
 *  also bubbles a click from a menu portaled out of a cell up to the row, which is not inside it either. */
export function isInteractiveTarget(el: Element | null | undefined, row?: Element | null): boolean {
  const hit = el?.closest(INTERACTIVE_SELECTOR);
  if (!hit) return false;
  return !row || (hit !== row && row.contains(hit));
}

/** Enter or Space pressed while the row itself has focus (on a button inside it the key is the button's). */
export function shouldActivateRow({ key, targetIsRow }: { key: string; targetIsRow: boolean }): boolean {
  return targetIsRow && (key === 'Enter' || key === ' ');
}

// ── choosing and opening rows ────────────────────────────────────────────────
/** A row's identity: what `getRowId` returns. Compared as text (an id that comes back from an address as "7" is the row 7). */
export type RowId = string | number;
/** What the header's tick shows: none of the rows listed are chosen, some are (the "mixed" tick), or all are. */
export type ChosenState = 'none' | 'some' | 'all';

const same = (a: RowId, b: RowId): boolean => String(a) === String(b);
const has = (ids: readonly RowId[], id: RowId): boolean => ids.some((x) => same(x, id));

/** The state of the header's tick: only the rows LISTED count (an id chosen on another page is not a row of this one). No rows listed is none. */
export function chosenState(listed: readonly RowId[], chosen: readonly RowId[]): ChosenState {
  if (listed.length === 0) return 'none';
  const n = listed.filter((id) => has(chosen, id)).length;
  return n === 0 ? 'none' : n === listed.length ? 'all' : 'some';
}

/** The ids after one row's tick (or toggle) was pressed: the id is added at the end, or taken out; every other id and the order are kept. */
export function toggleId(ids: readonly RowId[], id: RowId): RowId[] {
  return has(ids, id) ? ids.filter((x) => !same(x, id)) : ids.concat([id]);
}

/** The chosen ids after the header's tick was pressed: every listed row is chosen when some or none were, none of them when all were. Ids chosen on other
 *  pages stay as they were: this tick is "this page", never "everything" (the page offers "Select all N matching" for that). */
export function toggleAllListed(listed: readonly RowId[], chosen: readonly RowId[]): RowId[] {
  if (listed.length === 0) return chosen.slice();
  if (chosenState(listed, chosen) === 'all') return chosen.filter((id) => !has(listed, id));
  return chosen.concat(listed.filter((id) => !has(chosen, id)));
}

/** Whether a row is among the chosen (or the open) ones. */
export function includesId(ids: readonly RowId[], id: RowId): boolean {
  return has(ids, id);
}

// ── how many rows ────────────────────────────────────────────────────────────
/** "25 of 312 documents" when the list is cut, "312 documents" when it is all there, "1 document". null while the list loads, after it failed,
 *  or when the total is not known: a count is never made up (0, or the size of the page that happened to load). `plural` for a noun that
 *  does not just take an "s" ("policy" / "policies"). */
export function rowCountText({ shown, total, noun, plural = `${noun}s`, loading = false, failed = false }: {
  shown: number;
  total: number | null | undefined;
  noun: string;
  plural?: string;
  loading?: boolean;
  failed?: boolean;
}): string | null {
  if (loading || failed || total == null || !Number.isFinite(total)) return null;
  const word = total === 1 ? noun : plural;
  return shown < total ? `${formatCount(shown)} of ${formatCount(total)} ${word}` : `${formatCount(total)} ${word}`;
}
