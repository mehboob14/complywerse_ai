// The decisions of a facet explorer that are not drawing, apart from React so `node --test` pins them (explorerModel.test.ts): the selection (ticks on a page, "select all N
// matching", what stays ticked), where the j / k cursor goes, what a key does and does not do, how a board groups records, what an option list shows before "Show N more", and the tree an
// indented option list (the departments) is read as.
import { formatCount } from '../../lib/format.ts';

// ── the selection ────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TickState = 'none' | 'some' | 'all';

/** The state of a tick box over `ids` (the rows it stands for): none, some or all of them ticked. No rows: none. */
export function tickState(selected: ReadonlySet<number>, ids: readonly number[]): TickState {
  if (ids.length === 0) return 'none';
  const n = ids.reduce((c, id) => c + (selected.has(id) ? 1 : 0), 0);
  return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
}

/** The header's tick box: all ticked -> untick them; otherwise tick them all. The ticks outside `ids` stay. */
export function toggleAll(selected: ReadonlySet<number>, ids: readonly number[]): Set<number> {
  const next = new Set(selected);
  if (tickState(selected, ids) === 'all') ids.forEach((id) => next.delete(id));
  else ids.forEach((id) => next.add(id));
  return next;
}

export function toggleOne(selected: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** "Select all N matching": every record that matches the filters, also the ones not on the page. */
export const selectAllMatching = (matching: readonly number[]): Set<number> => new Set(matching);

/** The selection kept to the records that still match (a ticked record that a filter has taken out is not acted on). */
export function keepMatching(selected: ReadonlySet<number>, matching: ReadonlySet<number>): number[] {
  return Array.from(selected).filter((id) => matching.has(id));
}

export const selectedLabel = (n: number): string => `${formatCount(n)} selected`;

/** "Select all 1,247" is offered while the selection is less than what matches. */
export const canSelectAll = (selected: number, matching: number): boolean => matching > selected;

// ── the cursor (j / k) ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The row the cursor moves to: from nothing, j goes to the first row and k to the last; at either end it stays. `ids`: the rows as they are drawn, in order. */
export function moveCursor(ids: readonly number[], current: number | null, dir: 1 | -1): number | null {
  if (ids.length === 0) return null;
  const i = current == null ? -1 : ids.indexOf(current);
  if (i < 0) return dir === 1 ? ids[0] : ids[ids.length - 1];
  return ids[Math.min(ids.length - 1, Math.max(0, i + dir))];
}

// ── the keyboard ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type KeyAction = 'search' | 'next' | 'previous' | 'open' | 'escape' | null;

/** Where the key was pressed: a text field, inside a menu / dialog / list (an overlay), on a control (button, link, tab: it handles Enter itself) or on the page itself. */
export type KeyPlace = 'field' | 'overlay' | 'control' | 'page';

export interface KeyPress { key: string; ctrl?: boolean; meta?: boolean; alt?: boolean; defaultPrevented?: boolean; composing?: boolean }

/**
 * What a key does on the explorer's page. "/" focuses the search, j / k move the cursor, Enter opens the record under it, Escape closes the details or clears the selection.
 * Never while a modifier is held (the browser's and the platform's shortcuts), never from a text field (the person is typing), and never from inside a menu or a dialog (their
 * keys are theirs). Enter and Escape on a control belong to the control: a focused button is pressed by Enter, not the row under the cursor opened.
 */
export function keyAction(k: KeyPress, place: KeyPlace, overlayOpen: boolean): KeyAction {
  if (k.defaultPrevented || k.composing || k.ctrl || k.meta || k.alt) return null;
  if (place === 'field' || place === 'overlay') return null;
  if (k.key === 'Escape') return overlayOpen ? null : 'escape';
  if (overlayOpen) return null;
  if (k.key === '/') return 'search';
  if (k.key === 'j') return 'next';
  if (k.key === 'k') return 'previous';
  if (k.key === 'Enter') return place === 'page' ? 'open' : null;
  return null;
}

// ── a board: records in columns by a rule ────────────────────────────────────────────────────────────────────────────────

export interface BoardColumnDef<R> {
  id: string;
  label: string;
  /** the first column whose test a record passes holds it */
  test: (row: R) => boolean;
}

export interface BoardColumn<R> { id: string; label: string; rows: R[] }

/** The records in the first column that takes them, the columns in the order given; a record no column takes is left out (the last column should take the rest). */
export function groupBoard<R>(rows: readonly R[], columns: readonly BoardColumnDef<R>[]): BoardColumn<R>[] {
  const out: BoardColumn<R>[] = columns.map((c) => ({ id: c.id, label: c.label, rows: [] }));
  for (const row of rows) {
    const at = columns.findIndex((c) => c.test(row));
    if (at >= 0) out[at].rows.push(row);
  }
  return out;
}

// ── an option list ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** How many options a group shows before "Show N more": all of them while the person is searching in the group or has chosen one that would be hidden. */
export function shownOptions<T extends { value: string }>(options: readonly T[], limit: number | undefined, expanded: boolean, searching: boolean, chosen: readonly string[]): { shown: T[]; hidden: number } {
  if (!limit || expanded || searching || options.length <= limit) return { shown: options.slice(), hidden: 0 };
  const head = options.slice(0, limit);
  const rest = options.slice(limit);
  const kept = rest.filter((o) => chosen.includes(o.value));                         // a choice is never hidden behind "Show more"
  const shown = head.concat(kept);
  return { shown, hidden: options.length - shown.length };
}

// ── an option tree ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** One option of an indented list, with its place in the tree the indent describes. */
export interface OptionNode<T> {
  option: T;
  /** how many ancestors it has (the indent, with any skipped level closed up) */
  depth: number;
  /** index of its parent in the list, -1 for a top option */
  parent: number;
  /** indexes of its children, in list order */
  children: number[];
}

/**
 * The tree an option list describes by its `indent`: the list is in pre-order (a parent, then everything under it), and an option's parent is the nearest option above it with a smaller
 * indent. A level the data skips (an indent of 2 under an indent of 0) is closed up, never an empty step; no indent is a top option. The nodes keep the list's order and indexes.
 */
export function optionTree<T extends { indent?: number }>(options: readonly T[]): OptionNode<T>[] {
  const nodes: OptionNode<T>[] = [];
  const levels: number[] = [];
  const stack: number[] = [];                                                     // the path from the top to the option before this one
  options.forEach((option, i) => {
    const level = Math.max(0, option.indent ?? 0);
    while (stack.length > 0 && levels[stack[stack.length - 1]] >= level) stack.pop();
    const parent = stack.length > 0 ? stack[stack.length - 1] : -1;
    nodes.push({ option, depth: stack.length, parent, children: [] });
    levels.push(level);
    if (parent >= 0) nodes[parent].children.push(i);
    stack.push(i);
  });
  return nodes;
}

/** The values of every option above the ones in `values` (their parents, their parents' parents ...): what a tree opens so a chosen option is not hidden inside a shut branch. */
export function ancestorValues<T extends { value: string }>(nodes: readonly OptionNode<T>[], values: Iterable<string>): Set<string> {
  const want = new Set(values);
  const out = new Set<string>();
  nodes.forEach((n) => {
    if (!want.has(n.option.value)) return;
    for (let p = n.parent; p >= 0; p = nodes[p].parent) out.add(nodes[p].option.value);
  });
  return out;
}

/** What a hit found out of its tree says under its name: the whole name of the option (`title`, "Security › Cyber Defence › Access") without the option's own part at its end. A title that
 *  is only the label, or says nothing, gives ''. */
export function pathAbove(title: string | undefined, label: string): string {
  const t = (title ?? '').trim();
  if (!t || t === label) return '';
  return (t.endsWith(label) ? t.slice(0, t.length - label.length) : t).replace(/[\s>›»/·,:-]+$/, '');
}
