// The rules of the library table that need no React: which columns are drawn, which rows a page holds, what the tick boxes and the
// bulk bar do, who may do what to a row. Pure, so `node --test` runs libraryTableLogic.test.ts against it.
import { bulkActionIds } from './archive.ts';
import type { TreeDoc, TreeEntry } from './docTree.ts';
import type { SortKey } from './libraryModel.ts';

// ─── Columns ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ColumnId = 'title' | 'type' | 'lifecycle' | 'owner' | 'department' | 'frameworks' | 'attestation' | 'review' | 'version' | 'updated' | 'actions';
export interface Column {
  id: ColumnId;
  label: string;
  /** the order a click on the header gives (the actions column has none) */
  sort?: SortKey;
  /** px; the title column has none: it takes what the others leave */
  width?: number;
}

/** In the order they are drawn. The ids of the optional ones are libraryPrefs.OPTIONAL_COLUMNS; the title and the actions are always there. */
export const COLUMNS: Column[] = [
  { id: 'title', label: 'Document', sort: 'title' },
  { id: 'type', label: 'Type', sort: 'type', width: 100 },
  { id: 'lifecycle', label: 'Lifecycle', sort: 'lifecycle', width: 208 },
  { id: 'owner', label: 'Owner', sort: 'owner', width: 184 },
  { id: 'department', label: 'Department', sort: 'department', width: 168 },
  { id: 'frameworks', label: 'Frameworks', sort: 'frameworks', width: 248 },
  { id: 'attestation', label: 'Attestation', sort: 'attestation', width: 120 },
  { id: 'review', label: 'Next review', sort: 'review', width: 168 },
  { id: 'version', label: 'Version', sort: 'version', width: 96 },
  { id: 'updated', label: 'Updated', sort: 'updated', width: 100 },
  { id: 'actions', label: 'Actions', width: 104 },
];

/** px the Document column keeps however narrow the card gets (the table scrolls sideways instead). */
export const TITLE_MIN_WIDTH = 320;

export function visibleColumns(hidden: readonly string[]): Column[] {
  return COLUMNS.filter((c) => c.id === 'title' || c.id === 'actions' || !hidden.includes(c.id));
}

export const tableMinWidth = (columns: readonly Column[]): number => TITLE_MIN_WIDTH + columns.reduce((sum, c) => sum + (c.width ?? 0), 0);

// ─── Rows of a page ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** How far a row is open: all the way (its versions and the documents under it), only the documents under it, or closed. */
export type Open = 'all' | 'docs' | null;

export interface DrawnRow<T> {
  doc: T;
  depth: number;
  /** false: shown only because a document under it matches (greyed, never ticked) */
  match: boolean;
  childCount: number;
  open: Open;
  /** the document it sits under in the table; null at the top */
  parent: T | null;
}

/** The top-level rows of a page and, under each open one, the documents under it, depth first: what the table draws. */
export function drawnRows<T extends TreeDoc>(top: readonly T[], at: ReadonlyMap<number, TreeEntry<T>>, openOf: (id: number) => Open): DrawnRow<T>[] {
  const out: DrawnRow<T>[] = [];
  const walk = (docs: readonly T[], parent: T | null) => {
    for (const doc of docs) {
      const entry = at.get(doc.id);
      const open = openOf(doc.id);
      out.push({ doc, depth: entry?.depth ?? 0, match: entry?.match ?? true, childCount: entry?.children.length ?? 0, open, parent });
      if (open != null && entry) walk(entry.children, doc);
    }
  };
  walk(top, null);
  return out;
}

/** One page (1-based) of the top-level rows. */
export const pageOf = <T>(top: readonly T[], page: number, pageSize: number): T[] => top.slice((page - 1) * pageSize, page * pageSize);

// ─── Tick boxes ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TickState = 'none' | 'some' | 'all';

/** The header box: how many of the tickable rows on the page are ticked. */
export function tickState(selected: ReadonlySet<number>, tickable: readonly number[]): TickState {
  const n = tickable.filter((id) => selected.has(id)).length;
  return n === 0 ? 'none' : n === tickable.length ? 'all' : 'some';
}

/** The header box: all ticked → untick this page's rows; otherwise tick them all. Rows ticked on other pages stay as they were. */
export function toggleAll(selected: ReadonlySet<number>, tickable: readonly number[]): Set<number> {
  const next = new Set(selected);
  const all = tickState(selected, tickable) === 'all';
  tickable.forEach((id) => (all ? next.delete(id) : next.add(id)));
  return next;
}

export function toggleOne(selected: ReadonlySet<number>, id: number): Set<number> {
  const next = new Set(selected);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** The documents a bulk action is for: the ticked ones, in the table's order; a row shown only as a parent is never acted on. */
export function actionableIds(selected: ReadonlySet<number>, entries: readonly { doc: { id: number }; match: boolean }[]): number[] {
  return entries.filter((e) => e.match && selected.has(e.doc.id)).map((e) => e.doc.id);
}

export const selectedLabel = (n: number): string => `${n} ${n === 1 ? 'document' : 'documents'} selected`;

// ─── Bulk bar and row actions ────────────────────────────────────────────────────────────────────────────────────────────

/** Every bulk action the register has, with the words on its button. Never Approve: a document is approved by its approvers signing it. */
export const BULK_ACTIONS = [
  { id: 'publish', label: 'Publish', danger: false },
  { id: 'assign-owner', label: 'Assign owner', danger: false },
  { id: 'set-review', label: 'Set review date', danger: false },
  { id: 'archive', label: 'Archive', danger: true },
  { id: 'restore', label: 'Restore', danger: false },
] as const;
export type BulkId = (typeof BULK_ACTIONS)[number]['id'];

/** What the bulk bar offers this person: nothing without the edit right; on the Archived list Restore only (and only where the page
 *  can restore); on the working list the rest. No tick boxes are drawn when this is empty. */
export function bulkActionsFor(canEdit: boolean, showingArchived: boolean, canRestore: boolean) {
  if (!canEdit) return [];
  const offered = new Set(bulkActionIds(showingArchived));
  return BULK_ACTIONS.filter((a) => offered.has(a.id) && (a.id !== 'restore' || canRestore));
}

export interface RowRightsInput<T> {
  canEdit?: boolean;
  canEditRow?: (d: T) => boolean;
  canArchiveRow?: (d: T) => boolean;
  canRestoreRow?: (d: T) => boolean;
  /** the page gave a way to restore */
  canRestore: boolean;
}

/** What the row's menu offers beside Open and Download: the per-row rule where the page gave one, else the page-wide edit right;
 *  Restore only where the page can restore and says this row may be. */
export function rowRights<T>(r: RowRightsInput<T>, d: T): { edit: boolean; archive: boolean; restore: boolean } {
  return {
    edit: r.canEditRow ? r.canEditRow(d) : !!r.canEdit,
    archive: r.canArchiveRow ? r.canArchiveRow(d) : !!r.canEdit,
    restore: r.canRestore && !!r.canRestoreRow?.(d),
  };
}
