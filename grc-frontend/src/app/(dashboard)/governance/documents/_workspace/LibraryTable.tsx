'use client';

/**
 * The library's register, on the design-system table kit (TableFrame, Table, Th with aria-sort, Tr that opens from the keyboard): the table from 768px up with its columns
 * dropped as the window narrows (libraryColumns.ts: the person's own choice of columns stays theirs and is drawn where there is room), and below 768px the same rows as cards
 * (title, status, owner, next review, the row's menu). A slim strip (Expand all / Collapse all, only where a document has documents under it), the bulk bar while rows are
 * ticked, the table or the cards, and the kit's pager. The page owns the data, the order (`sort`), the columns and the density; this draws them.
 *
 * What it keeps from the table it replaced, exactly: documents nested under their parent (docTree), the arrow that opens a document's versions and the documents under
 * it, "Parent of a match" rows greyed and never ticked, the way to every match open while a search or filter is on (what the person closed belongs to one set of matches),
 * the bulk actions and the per-row rights (the rows get tick boxes only when the bulk bar has something for this person), the sticky first columns and no Approve.
 * What it changes: every action of a row is in its menu (no control that appears only on hover), the title is the link that opens the document, the header sorts with
 * aria-sort, the rows and cards open from the keyboard, and the pager is the kit's, which says how many of how many.
 *
 * The Folders view is this same table: given `folders` (libraryFolders.ts) it draws a header row for each department folder across the table and, under an open one, the
 * folders inside it and then its documents as the same rows, one level deeper, with the same columns (minus Department: the folder is the department), versions, nesting,
 * tick boxes, bulk bar and sticky header; the pager gives way to "Show N more" under each folder. "Move to…" is in the row menu and the bulk bar of both layouts.
 * On a phone the folders are cards of their own with the documents under them as cards.
 *
 * The kit's table survives the platform CSS (important modifiers, a doubled padding class), so a cell needs no hacks of its own; the pinned cells (a sticky cell must hide
 * what scrolls under it) paint their own opaque background for each state of the row.
 */
import { Fragment, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Archive, ArchiveRestore, CalendarClock, ChevronsDownUp, ChevronsUpDown, FolderInput, Send, UserPlus, type LucideIcon } from 'lucide-react';
import { Button, Checkbox, Pager, PersonChip, Skeleton, Table, TableFrame, TBody, Td, Th, THead, Tr, RowHeaderCell, type SortState } from '@/components/ui/ds';
import { rowHandlers } from '@/components/ui/ds/Table';
import type { GovDoc } from './lib';
import {
  ActionsCell, AttestationCell, DepartmentCell, DocumentCell, LifecycleCell, OwnerCell, ReviewCell, TitleBlock, ToggleArrow, TypeCell, UpdatedCell, VersionCell, toggleLabel,
} from './cells';
import { ReviewDate } from './atoms';
import { FrameworksCell } from './FrameworksCell';
import { STEP, Versions } from './Versions';
import { FolderHeadCard, FolderHeadRow, FoldersToolbar, ShowMoreCard, ShowMoreRow } from './FolderRows';
import { MovePopover } from './MovePopover';
import { NOTHING_OPEN, buildTree, collapseAll, expandAll, flip, openness, treeEntries, type Fold } from './docTree';
import {
  FIRST_SHOWN, allFolders, commonDepartment, expandable, flipFolder, folderEntries, folderIsOpen, matchedIds, planFolders, setAllFolders,
  showMoreStep, shownLimit,
  type FoldChange, type FoldView, type FolderNode, type MoveTarget,
} from './libraryFolders';
import { clampPage } from './libraryFormat';
import { WIDTH_CLASS, cardFields, placeClass, spanAt } from './libraryColumns';
import { compareDocs, nextSort, type Lookups, type Sort } from './libraryModel';
import { isCut, pagerNoun } from './libraryNumbers';
import { PAGE_SIZES, type Density } from './libraryPrefs';
import { useViewport } from './useMinWidth';
import {
  actionableIds, bulkActionsFor, drawnRows, pageOf, rowRights, selectedLabel, tickState, toggleAll, toggleOne, visibleColumns,
  type BulkId, type Column, type DrawnRow, type Open, type TickState,
} from './libraryTableLogic';

export interface LibraryTableProps {
  /** the documents that match the filters */
  docs: GovDoc[];
  /** every document the list is drawn from: the documents above a match come from here (docTree) */
  scope: GovDoc[];
  /** a search or filter is on: the way to every match is open, the documents above it greyed (docTree.openness) */
  filtering: boolean;
  /** departments (id -> name), frameworks (id -> short label and name), attestation % per document, the signed-in person */
  lookups: Lookups;
  /** "4/5" under the attestation ring; may be empty */
  counts: Record<number, { done: number; total: number }>;
  /** Filters.frameworks: their chips come first in a Frameworks cell */
  preferFrameworks: string[];
  /** the order: controlled; a click on a header asks for nextSort(sort, key) */
  sort: Sort;
  onSort: (next: Sort) => void;
  /** libraryPrefs.OPTIONAL_COLUMNS switched off (the title and the actions are always there) */
  hiddenColumns: string[];
  density: Density;
  pageSize: number;
  onPageSize: (n: number) => void;
  /** the document open in the details panel: its row is highlighted */
  activeId: number | null;
  /** the details panel is open beside the register (from 1024px): the columns the person is not reading give way (libraryColumns.PEEK_FROM) */
  peeking?: boolean;
  /** a row was clicked (or Enter/Space on it): open the details panel */
  onPeek: (id: number) => void;
  /** the document's own page */
  onOpenDoc: (id: number) => void;
  /** a framework chip or a row of the full list was clicked: the page filters by it */
  onPickFramework: (id: number) => void;
  onEdit: (doc: GovDoc) => void;
  onDownload: (doc: GovDoc) => void;
  /** documents are archived, never deleted */
  onArchive: (doc: GovDoc) => void;
  onRestore?: (doc: GovDoc) => void;
  canEdit?: boolean;
  /** per row: the owner and the author may change or archive their own document without the role permission */
  canEditRow?: (d: GovDoc) => boolean;
  canArchiveRow?: (d: GovDoc) => boolean;
  canRestoreRow?: (d: GovDoc) => boolean;
  /** the list shows the archived documents: its bulk bar offers Restore only */
  showingArchived?: boolean;
  onBulkPublish: (ids: number[]) => void;
  onBulkArchive: (ids: number[]) => void;
  onBulkAssignOwner: (ids: number[]) => void;
  onBulkSetReviewDate: (ids: number[]) => void;
  onBulkRestore?: (ids: number[]) => void;
  loading?: boolean;
  /** what the body shows when nothing matches (the page composes it) */
  emptyState: ReactNode;
  /** How many documents the page loaded and how many exist (libraryNumbers.ts): when they differ the pager and the folders' count say "loaded". */
  listSize?: { loaded: number; total: number | null | undefined };
  /** The Folders view: the folders (libraryFolders.buildFolders) the documents are drawn in. Left out or null: the plain table. */
  folders?: FolderNode<GovDoc>[] | null;
  /** The folders the person left open or closed (folder key -> open), and how a change is remembered */
  folderOpen?: Record<string, boolean>;
  onFolderOpen?: (next: Record<string, boolean>) => void;
  /** Move to…: where a document can go, and the move itself: it answers with the ids that could NOT be moved (they stay ticked) */
  moveTargets?: MoveTarget[];
  onMove?: (ids: number[], to: MoveTarget) => Promise<number[]>;
  /** per row: the person may change this document (the server decides again) */
  canMoveRow?: (d: GovDoc) => boolean;
}

const NONE: ReadonlySet<number> = new Set<number>();
const NO_KEYS: ReadonlySet<string> = new Set<string>();
const NO_CHOICES: Readonly<Record<string, boolean>> = {};
const SKELETON_ROWS = 8;
const BULK_ICON: Record<BulkId, LucideIcon> = { publish: Send, 'assign-owner': UserPlus, 'set-review': CalendarClock, archive: Archive, restore: ArchiveRestore };

// The frame holds the sticky header; it is as tall as the rows, up to what the window leaves under the page's own header and cards (Tailwind needs the whole class name
// written out). The strip, bulk bar and pager are outside it and always in view. scroll-pt/pl keep a control the keyboard reaches from landing under the sticky header or
// the pinned columns.
const FRAME_HEIGHT = 'max-h-[calc(100vh-14rem)]';
const FRAME_SCROLL = 'scroll-pl-[300px] scroll-pt-[40px]';
// The pinned cells: the tick box and the Document column stay at the left edge; once the table has scrolled sideways the last of them casts a hairline and a soft shadow.
const PIN_TICK = 'sticky left-0 z-[1]';
const PIN_TITLE = 'sticky left-0 z-[1]';
const PIN_TITLE_AFTER_TICK = 'sticky left-[44px] z-[1]';
const EDGE_SHADOW = 'shadow-[1px_0_0_0_var(--ds-border-strong),6px_0_8px_-6px_rgba(31,41,51,0.25)]';
const TICK_COLUMN = 'w-[44px] [&&]:!pr-0';

/** A tick box with a target of its own (the label around it is as big as a control, and a press anywhere on it ticks), which is not a click on the row. */
function Tick({ label, checked, state, onChange }: { label: string; checked?: boolean; state?: TickState; onChange: () => void }) {
  return (
    <label data-no-peek className="-m-[8px] grid h-[var(--ds-control-h)] w-[var(--ds-control-h)] shrink-0 cursor-pointer place-items-center">
      <Checkbox aria-label={label} checked={checked ?? state === 'all'} indeterminate={state === 'some'} onChange={onChange} />
    </label>
  );
}

/** " · +4 nested": the pages count the documents at the top of the tree, the ones nested under them come with them. */
const nestedNote = (n: number) => (n === 0 ? '' : ` · +${n} nested`);

function HeadRow({ columns, sort, onSort, selectable, tick, tickLabel, onTickAll, scrolled }: {
  columns: Column[]; sort: Sort; onSort: (next: Sort) => void; selectable: boolean; tick: TickState; tickLabel: string; onTickAll: () => void; scrolled: boolean;
}) {
  const state: SortState = { key: sort.key, dir: sort.dir };
  return (
    <Tr>
      {selectable && (
        <Th sticky className={`${TICK_COLUMN} left-0 !z-[3]`}>
          <Tick label={tickLabel} state={tick} onChange={onTickAll} />
        </Th>
      )}
      {columns.map((c) => {
        const first = c.id === 'title';
        return (
          <Th
            key={c.id}
            sticky
            sortKey={c.sort}
            sort={state}
            onSortChange={c.sort ? () => onSort(nextSort(sort, c.sort!)) : undefined}
            className={clsx(WIDTH_CLASS[c.id], placeClass(c.id), first && `${selectable ? 'left-[44px]' : 'left-0'} !z-[3]`, first && scrolled && EDGE_SHADOW)}
          >
            {c.id === 'actions' ? <span className="sr-only">Actions</span> : c.label}
          </Th>
        );
      })}
    </Tr>
  );
}

export function LibraryTable({
  docs, scope, filtering, lookups, counts, preferFrameworks, sort, onSort, hiddenColumns, density, pageSize, onPageSize, activeId, peeking = false,
  onPeek, onOpenDoc, onPickFramework, onEdit, onDownload, onArchive, onRestore, canEdit = false, canEditRow, canArchiveRow, canRestoreRow,
  showingArchived = false, onBulkPublish, onBulkArchive, onBulkAssignOwner, onBulkSetReviewDate, onBulkRestore, loading = false, emptyState,
  listSize, folders = null, folderOpen = NO_CHOICES, onFolderOpen, moveTargets = [], onMove, canMoveRow,
}: LibraryTableProps) {
  const compact = density === 'compact';
  const uid = useId();
  // the Folders view has no Department column: the folder is the department
  const columns = visibleColumns(hiddenColumns).filter((c) => !(folders && c.id === 'department'));
  const hasDepartmentColumn = columns.some((c) => c.id === 'department');
  const rowHeight = compact ? 'h-[36px]' : 'h-[56px]';
  const cut = !!listSize && isCut(listSize.loaded, listSize.total);

  // the documents in the order chosen (children follow it), each under its parent; with a search or filter, the matches and the
  // documents above them (docTree.ts). In the Folders view each folder has its own tree (libraryFolders.ts), the same rules.
  const ordered = useMemo(() => (folders ? [] : [...scope].sort(compareDocs({ key: sort.key, dir: sort.dir }, lookups))), [folders, scope, sort.key, sort.dir, lookups]);
  const matchIds = useMemo(() => new Set(docs.map((d) => d.id)), [docs]);
  const roots = useMemo(() => buildTree(ordered, matchIds), [ordered, matchIds]);
  const entries = useMemo(() => (folders ? folderEntries(folders) : treeEntries(roots)), [folders, roots]);
  const at = useMemo(() => new Map(entries.map((e) => [e.doc.id, e])), [entries]);
  const top = useMemo(() => roots.map((n) => n.doc), [roots]);
  const parents = entries.filter((e) => e.children.length > 0).map((e) => e.doc.id);

  // What the person closed, ticked and paged to belongs to one set of matches, one order and one page size: when they change, the
  // way to every match opens again, the ticks go and the table is back on page 1 (state adjusted while rendering, not in an effect,
  // so a stale tick is never drawn).
  const matchKey = useMemo(() => docs.map((d) => d.id).join(','), [docs]);
  const viewKey = `${matchKey}|${sort.key}:${sort.dir}|${pageSize}`;
  const [fold, setFold] = useState<Fold>(NOTHING_OPEN);
  const [selected, setSelected] = useState<ReadonlySet<number>>(NONE);
  const [pageNo, setPageNo] = useState(1);
  // Folders view: the folders closed by hand while a search or filter was on, the documents asked for beyond a folder's first ones, and
  // the "Move to…" popover (the documents it is for, and the box of the button it came from)
  const [shut, setShut] = useState<ReadonlySet<string>>(NO_KEYS);
  const [extra, setExtra] = useState<Record<string, number>>({});
  const [moving, setMoving] = useState<{ ids: number[]; anchor: DOMRect | null } | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  // The documents a move could not move: they stay ticked through the first change of the list that follows (the refresh after a move
  // lists the documents that were just updated first, which is a new set of matches as far as the ticks are concerned)
  const [kept, setKept] = useState<{ ids: number[]; until: number } | null>(null);
  const [seen, setSeen] = useState({ match: matchKey, view: viewKey });
  if (seen.view !== viewKey) {
    if (seen.match !== matchKey) {
      setFold((f) => ({ ...f, shut: NONE }));
      setSelected(kept && kept.until > Date.now() ? new Set(kept.ids.filter((id) => matchIds.has(id))) : NONE);
      setKept(null);
      setShut(NO_KEYS);
    }
    setPageNo(1);
    setExtra({});
    setSeen({ match: matchKey, view: viewKey });
  }
  const [scrolled, setScrolled] = useState(false);

  const openOf = (id: number, f: Fold = fold): Open => openness(f, id, (at.get(id)?.children.length ?? 0) > 0, filtering);

  // pages hold top-level rows; the documents under an open one follow it
  const page = clampPage(pageNo, pageSize, top.length);
  const pageRows = drawnRows(pageOf(top, page, pageSize), at, openOf);

  // The Folders view draws the folders (each open one: the folders inside it, then the first of its own documents) instead of a page.
  // The folders open the way libraryFolders.folderIsOpen says; the person's choice is remembered by the page (not while filtering).
  const foldView: FoldView = { saved: folderOpen, shut, filtering, docCount: docs.length };
  const plan = folders
    ? planFolders(folders, {
        isOpen: (n) => folderIsOpen(foldView, n.key),
        limit: (n) => shownLimit(extra[n.key]),
        rowsOf: (n, limit) => drawnRows(n.top.slice(0, limit), at, openOf),
      })
    : null;
  const rows = plan ? plan.reduce<DrawnRow<GovDoc>[]>((all, item) => (item.kind === 'docs' ? all.concat(item.rows) : all), []) : pageRows;
  const tickable = rows.filter((r) => r.match).map((r) => r.doc.id);
  const everyFolder = folders ? allFolders(folders) : [];
  const foldable = everyFolder.filter(expandable);
  const applyFold = (change: FoldChange) => { if (filtering) setShut(change.shut); else onFolderOpen?.(change.saved); };
  const allFoldersOpen = foldable.every((n) => folderIsOpen(foldView, n.key));
  const toggleAllFolders = () => {
    const open = !allFoldersOpen;
    applyFold(setAllFolders(foldView, foldable.map((n) => n.key), open));
    setFold((f) => (open ? expandAll(f) : collapseAll(parents)));            // the documents that have documents under them follow
  };
  const headId = (n: FolderNode<GovDoc>) => `${uid}-folder-${n.key}`;
  const docsId = (n: FolderNode<GovDoc>) => `${uid}-docs-${n.key}`;

  // the rows get tick boxes only when the bulk bar has something for this person to do; no Approve: a document is approved by its
  // approvers signing it in its review (the server refuses a bulk approval), and Publish publishes only approved documents
  const bulkActions = bulkActionsFor(canEdit, showingArchived, !!onBulkRestore);
  const selectable = bulkActions.length > 0;
  // the cells a full-width row (a folder, the versions, "Show more") spans: what the window draws, never more (libraryColumns.spanAt)
  const span = useViewport((w) => spanAt(columns, w, peeking, selectable), columns.length + (selectable ? 1 : 0));
  const ticked = actionableIds(selected, entries);
  const runBulk = (id: BulkId, ids: number[]) => {
    switch (id) {
      case 'publish': return onBulkPublish(ids);
      case 'assign-owner': return onBulkAssignOwner(ids);
      case 'set-review': return onBulkSetReviewDate(ids);
      case 'archive': return onBulkArchive(ids);
      case 'restore': return onBulkRestore?.(ids);
    }
  };
  const rights = { canEdit, canEditRow, canArchiveRow, canRestoreRow, canRestore: !!onRestore };

  // Move to…: the popover chooses the department; the page moves the documents and says what happened. The documents that moved leave
  // the selection, the ones that could not be moved stay ticked (also through the list being refreshed under them: `kept`).
  const moveDocs = moving ? moving.ids.map((id) => at.get(id)?.doc).filter((d): d is GovDoc => !!d) : [];
  const pickTarget = async (target: MoveTarget) => {
    if (!moving || !onMove || moveBusy) return;
    const ids = moving.ids;
    const ticks = ids.filter((id) => selected.has(id));
    setMoveBusy(true);
    let failed: number[] = [];
    try {
      failed = await onMove(ids, target);
    } finally {
      setMoveBusy(false);
      setMoving(null);
    }
    const stay = ticks.filter((id) => failed.includes(id));
    setSelected((s) => {
      const next = new Set(s);
      ids.forEach((id) => next.delete(id));
      stay.forEach((id) => next.add(id));
      return next;
    });
    setKept(stay.length > 0 ? { ids: stay, until: Date.now() + 10_000 } : null);
  };
  const tickFolder = (node: FolderNode<GovDoc>): ReactNode => {
    if (bulkActions.length === 0) return null;
    const mine = matchedIds(node);
    if (mine.length === 0) return <span className="w-[16px] shrink-0" aria-hidden />;
    return (
      <Tick
        label={`Select ${mine.length === 1 ? '1 document' : `all ${mine.length} documents`} in ${node.name}`}
        state={tickState(selected, mine)}
        onChange={() => setSelected((s) => toggleAll(s, mine))}
      />
    );
  };

  /** What a cell of this column says for this row: the table's cells and the card's lines are the same pieces. */
  const cell = (r: DrawnRow<GovDoc>, id: Column['id']): ReactNode => {
    const { doc } = r;
    const department = doc.department_id != null ? lookups.departments[String(doc.department_id)] : undefined;
    switch (id) {
      case 'type': return <TypeCell doc={doc} />;
      case 'lifecycle': return <LifecycleCell doc={doc} />;
      case 'owner': return <OwnerCell doc={doc} department={hasDepartmentColumn || folders ? undefined : department} compact={compact} />;      // the column (or the folder) says it already
      case 'department': return <DepartmentCell name={department} />;
      case 'frameworks': return <FrameworksCell doc={doc} info={lookups.frameworks} prefer={preferFrameworks} onPick={onPickFramework} />;
      case 'attestation': return <AttestationCell pct={lookups.coverage[doc.id]} count={counts[doc.id]} compact={compact} />;
      case 'review': return <ReviewCell doc={doc} compact={compact} />;
      case 'version': return <VersionCell doc={doc} compact={compact} />;
      case 'updated': return <UpdatedCell value={doc.updated_at} />;
      case 'actions': return (
        <ActionsCell
          doc={doc}
          rights={rowRights(rights, doc)}
          onOpenDoc={onOpenDoc}
          onEdit={onEdit}
          onDownload={onDownload}
          onArchive={onArchive}
          onRestore={onRestore}
          canMove={!!onMove && !!canMoveRow?.(doc)}
          onMove={(d, anchor) => setMoving({ ids: [d.id], anchor: anchor ?? null })}
        />
      );
      default: return null;
    }
  };

  // `offset`: how many levels deeper than the table's own the row sits (the Folders view: under its folder)
  const renderRow = (r: DrawnRow<GovDoc>, offset = 0) => {
    const { doc } = r;
    const active = activeId === doc.id;
    const isTicked = selected.has(doc.id);
    // every cell paints its own background: a pinned one must hide what scrolls under it, and the row's tint is on the cells
    const bg = active || isTicked ? '!bg-ds-primary-soft' : r.match ? 'bg-ds-surface group-hover/row:bg-ds-surface-hover' : 'bg-ds-surface-subtle group-hover/row:bg-ds-surface-hover';
    const tick = r.match
      ? <Tick label={`Select ${doc.title}`} checked={isTicked} onChange={() => setSelected((s) => toggleOne(s, doc.id))} />
      : <span className="block w-[16px]" aria-hidden />;
    return (
      <Fragment key={doc.id}>
        <Tr
          data-doc-row={doc.id}
          selected={active}
          onActivate={() => onPeek(doc.id)}
          className={`group/row ${rowHeight}`}
        >
          {selectable && <Td className={clsx(TICK_COLUMN, PIN_TICK, bg)}>{tick}</Td>}
          {columns.map((c) => c.id === 'title' ? (
            <RowHeaderCell key={c.id} className={clsx(selectable ? PIN_TITLE_AFTER_TICK : PIN_TITLE, bg, scrolled && EDGE_SHADOW)}>
              <DocumentCell
                doc={doc}
                depth={r.depth + offset}
                match={r.match}
                childCount={r.childCount}
                open={r.open}
                parentTitle={r.parent?.title}
                compact={compact}
                showVersion={!columns.some((x) => x.id === 'version')}
                onToggle={() => setFold((f) => flip(f, doc.id, openOf(doc.id, f) != null))}
                onOpenDoc={onOpenDoc}
              />
            </RowHeaderCell>
          ) : (
            <Td key={c.id} className={clsx(placeClass(c.id), bg)} align={c.id === 'actions' ? 'right' : 'left'}>{cell(r, c.id)}</Td>
          ))}
        </Tr>
        {r.open === 'all' && (
          <Tr>
            <Td colSpan={span} className="bg-ds-surface-subtle [&&]:!py-[4px]">
              {/* pinned to the left edge, so the versions stay in view when the table has scrolled sideways */}
              <div className="sticky left-[12px] w-full max-w-[min(44rem,calc(100vw-4rem))] py-[4px]" style={{ paddingLeft: selectable ? 24 : 0 }}>
                <Versions doc={doc} depth={r.depth + offset} />
              </div>
            </Td>
          </Tr>
        )}
      </Fragment>
    );
  };

  // the phone's card for one row: title, status, owner, next review and the row's menu; the arrow, the tick box and the versions as in the table
  const lines = cardFields(hiddenColumns);
  const renderCard = (r: DrawnRow<GovDoc>, offset = 0) => {
    const { doc } = r;
    const active = activeId === doc.id;
    const isTicked = selected.has(doc.id);
    const depth = r.depth + offset;
    return (
      <Fragment key={doc.id}>
        <li
          data-doc-row={doc.id}
          tabIndex={0}
          aria-current={active || undefined}
          {...rowHandlers<HTMLLIElement>(() => onPeek(doc.id))}
          style={{ marginLeft: depth * 16 }}
          className={clsx(
            'cursor-pointer rounded-ds-card border p-3 focus-visible:outline-none focus-visible:shadow-ds-ring',
            active || isTicked ? 'border-ds-primary bg-ds-primary-soft' : r.match ? 'border-ds-border bg-ds-surface' : 'border-ds-border bg-ds-surface-subtle',
          )}
        >
          <div className="flex items-start gap-2">
            {selectable && (r.match
              ? <Tick label={`Select ${doc.title}`} checked={isTicked} onChange={() => setSelected((s) => toggleOne(s, doc.id))} />
              : <span className="block w-[16px] shrink-0" aria-hidden />)}
            <ToggleArrow open={r.open != null} label={toggleLabel(doc, r.open, r.childCount)} onToggle={() => setFold((f) => flip(f, doc.id, openOf(doc.id, f) != null))} />
            <div className="min-w-0 flex-1">
              <TitleBlock doc={doc} match={r.match} childCount={r.childCount} open={r.open} parentTitle={r.parent?.title} compact={false} showVersion onOpenDoc={onOpenDoc} />
            </div>
            {cell(r, 'actions')}
          </div>
          <dl className="mt-2 flex flex-col gap-1">
            {lines.map((f) => (
              <div key={f} className="grid grid-cols-[minmax(0,34%)_minmax(0,1fr)] items-center gap-x-2">
                <dt className="text-ds-label text-ds-fg-muted">{f === 'lifecycle' ? 'Status' : f === 'owner' ? 'Owner' : 'Next review'}</dt>
                <dd className="min-w-0 text-ds-body text-ds-fg-body">
                  {f === 'lifecycle' ? <LifecycleCell doc={doc} /> : f === 'owner' ? <PersonChip name={doc.owner_name} /> : <ReviewDate doc={doc} />}
                </dd>
              </div>
            ))}
          </dl>
        </li>
        {r.open === 'all' && (
          <li className="py-1" style={{ marginLeft: depth * 16 }}><Versions doc={doc} /></li>
        )}
      </Fragment>
    );
  };

  const empty = !loading && (folders ? docs.length === 0 : top.length === 0);
  if (empty && scrolled) setScrolled(false);        // the frame is gone; the next one starts at the left edge
  // Move to… in the bulk bar: for the working list (where Archive is), never the Archived list (the server refuses changing those)
  const bulkMove = (
    <Button
      key="move"
      size="sm"
      variant="secondary"
      onClick={(e) => { const anchor = e.currentTarget.getBoundingClientRect(); setMoving((m) => (m ? null : { ids: ticked, anchor })); }}
      data-move-trigger
      aria-haspopup="dialog"
      aria-expanded={!!moving}
      leftIcon={<FolderInput aria-hidden />}
    >
      Move to…
    </Button>
  );
  const sizeNote = listSize ?? { loaded: docs.length, total: docs.length };
  const foldersStrip = folders && !loading && !empty;
  const foldStrip = !folders && !loading && !empty && parents.length > 0;
  const allParentsOpen = parents.every((id) => openOf(id) != null);

  return (
    <div className="min-w-0 max-w-full" data-peek={peeking ? '' : undefined}>
      {!loading && ticked.length > 0 && selectable && (
        <div role="region" aria-label="Bulk actions" className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-ds-card border border-ds-primary bg-ds-primary-soft px-[12px] py-[6px]">
          <span role="status" className="text-ds-body font-[600] text-ds-fg">{selectedLabel(ticked.length)}</span>
          <div className="flex flex-wrap items-center gap-1">
            {bulkActions.map((a) => {
              const Icon = BULK_ICON[a.id];
              return (
                <Fragment key={a.id}>
                  {a.id === 'archive' && onMove && bulkMove}
                  <Button size="sm" variant={a.danger ? 'dangerOutline' : 'secondary'} onClick={() => runBulk(a.id, ticked)} leftIcon={<Icon aria-hidden />}>{a.label}</Button>
                </Fragment>
              );
            })}
          </div>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(NONE)}>Clear</Button>
        </div>
      )}

      {foldersStrip && (
        <FoldersToolbar allOpen={allFoldersOpen} canFold={foldable.length > 0} onToggleAll={toggleAllFolders} folders={everyFolder.length} documents={docs.length} loaded={sizeNote.loaded} total={sizeNote.total} />
      )}
      {foldStrip && (
        <div className="mb-2">
          <Button size="sm" variant="ghost" onClick={() => setFold(allParentsOpen ? collapseAll(parents) : expandAll)} leftIcon={allParentsOpen ? <ChevronsDownUp aria-hidden /> : <ChevronsUpDown aria-hidden />}>
            {allParentsOpen ? 'Collapse all' : 'Expand all'}
          </Button>
        </div>
      )}

      {empty ? (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">{emptyState}</div>
      ) : (
        <>
          <div className="hidden md:block" onScrollCapture={(e) => { const x = (e.target as HTMLElement).scrollLeft; if (e.target === e.currentTarget.querySelector('[role="region"]')) setScrolled(x > 0); }}>
            <TableFrame aria-label={loading ? 'Loading the documents' : 'Documents'} maxHeight={FRAME_HEIGHT} className={FRAME_SCROLL}>
              {/* fixed layout: the columns keep the widths libraryColumns.ts gives them and the Document column takes the rest (an auto layout shared the slack with the
                  Frameworks column and squeezed the title to a few letters a line); a table that is wider than its frame still scrolls inside it */}
              <Table caption={loading ? 'Loading the documents' : 'Documents'} aria-busy={loading || undefined} className="table-fixed">
                <THead>
                  <HeadRow
                    columns={columns}
                    sort={sort}
                    onSort={onSort}
                    selectable={bulkActions.length > 0}
                    tick={tickState(selected, tickable)}
                    tickLabel={folders ? 'Select all documents shown' : 'Select all documents on this page'}
                    onTickAll={() => setSelected((s) => toggleAll(s, tickable))}
                    scrolled={scrolled}
                  />
                </THead>
                {plan && !loading ? (
                  // one <tbody> for each folder's header and one for its documents: the header says which it controls (aria-controls)
                  plan.map((item) => {
                    const node = item.node;
                    if (item.kind === 'folder') {
                      return (
                        <TBody key={`head-${node.key}`}>
                          <FolderHeadRow
                            node={node}
                            open={item.open}
                            colSpan={span}
                            tick={tickFolder(node)}
                            headId={headId(node)}
                            controls={[...node.folders.map(headId), ...(node.top.length > 0 ? [docsId(node)] : [])]}
                            onToggle={() => applyFold(flipFolder(foldView, node.key))}
                          />
                        </TBody>
                      );
                    }
                    return (
                      <TBody key={`docs-${node.key}`} id={docsId(node)}>
                        {item.rows.map((r) => renderRow(r, node.depth + 1))}
                        {node.top.length > FIRST_SHOWN && (
                          <ShowMoreRow
                            colSpan={span}
                            indent={(selectable ? 24 : 0) + (node.depth + 1) * STEP}
                            hidden={item.remaining}
                            step={showMoreStep(item.remaining)}
                            folder={node.name}
                            onMore={() => setExtra((e) => ({ ...e, [node.key]: (e[node.key] ?? 0) + showMoreStep(item.remaining) }))}
                            onFewer={() => setExtra((e) => { const next = { ...e }; delete next[node.key]; return next; })}
                          />
                        )}
                      </TBody>
                    );
                  })
                ) : (
                  <TBody aria-busy={loading || undefined}>
                    {loading
                      ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                          <Tr key={i} aria-hidden className={rowHeight}>
                            {selectable && <Td className={TICK_COLUMN}><span className="block h-[16px] w-[16px]" /></Td>}
                            {columns.map((c) => (
                              <Td key={c.id} className={placeClass(c.id)}>
                                <Skeleton className={`h-[14px] ${c.id === 'title' ? 'w-[65%]' : c.id === 'actions' ? 'w-[40%]' : 'w-[70%]'}`} />
                              </Td>
                            ))}
                          </Tr>
                        ))
                      : rows.map((r) => renderRow(r))}
                  </TBody>
                )}
              </Table>
            </TableFrame>
          </div>

          <div className="md:hidden">
            {selectable && !loading && tickable.length > 0 && (
              <Checkbox
                className="mb-1"
                label={folders ? 'Select all documents shown' : 'Select all documents on this page'}
                checked={tickState(selected, tickable) === 'all'}
                indeterminate={tickState(selected, tickable) === 'some'}
                onChange={() => setSelected((s) => toggleAll(s, tickable))}
              />
            )}
            <ul role="list" aria-label={loading ? 'Loading the documents' : 'Documents'} aria-busy={loading || undefined} className="flex flex-col gap-2">
              {loading ? (
                Array.from({ length: 6 }, (_, i) => (
                  <li key={i} aria-hidden className="rounded-ds-card border border-ds-border bg-ds-surface p-3">
                    <Skeleton className="h-[14px] w-[60%]" />
                    <Skeleton className="mt-2 h-[12px] w-[85%]" />
                  </li>
                ))
              ) : plan ? (
                plan.map((item) => {
                  const node = item.node;
                  if (item.kind === 'folder') {
                    return (
                      <FolderHeadCard
                        key={`head-${node.key}`}
                        node={node}
                        open={item.open}
                        tick={tickFolder(node)}
                        headId={headId(node)}
                        controls={[...node.folders.map(headId), ...(node.top.length > 0 ? [docsId(node)] : [])]}
                        onToggle={() => applyFold(flipFolder(foldView, node.key))}
                      />
                    );
                  }
                  return (
                    <li key={`docs-${node.key}`} id={docsId(node)}>
                      <ul role="list" aria-label={`Documents in ${node.name}`} className="flex flex-col gap-2">
                        {item.rows.map((r) => renderCard(r, node.depth + 1))}
                        {node.top.length > FIRST_SHOWN && (
                          <ShowMoreCard
                            indent={0}
                            hidden={item.remaining}
                            step={showMoreStep(item.remaining)}
                            folder={node.name}
                            onMore={() => setExtra((e) => ({ ...e, [node.key]: (e[node.key] ?? 0) + showMoreStep(item.remaining) }))}
                            onFewer={() => setExtra((e) => { const next = { ...e }; delete next[node.key]; return next; })}
                          />
                        )}
                      </ul>
                    </li>
                  );
                })
              ) : (
                rows.map((r) => renderCard(r))
              )}
            </ul>
          </div>
        </>
      )}

      {!loading && !folders && top.length > 0 && (
        <Pager
          className="mt-3"
          page={page}
          pageSize={pageSize}
          total={top.length}
          onPage={setPageNo}
          onPageSize={onPageSize}
          pageSizes={PAGE_SIZES}
          noun={`${pagerNoun(cut)}${nestedNote(entries.filter((e) => e.depth > 0).length)}`}
        />
      )}

      {moving && onMove && (
        <MovePopover
          anchor={moving.anchor}
          targets={moveTargets}
          current={commonDepartment(moveDocs)}
          count={moving.ids.length}
          busy={moveBusy}
          onPick={pickTarget}
          onClose={() => setMoving(null)}
        />
      )}
    </div>
  );
}

export default LibraryTable;
