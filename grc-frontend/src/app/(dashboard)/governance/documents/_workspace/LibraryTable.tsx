'use client';

/**
 * The library's register table (it replaced the old RegisterTable, which sat on the shared DataTable). One white card:
 * a slim toolbar (Expand all / Collapse all, only where a document has documents under it), the bulk bar while rows are ticked, the
 * table, and the page footer. The page owns the data, the order (`sort`), the columns and the density; this draws them.
 *
 * What it keeps from that table, exactly: documents nested under their parent (docTree), the arrow that opens a document's
 * versions and the documents under it, "Parent of a match" rows greyed and never ticked, the way to every match open while a search
 * or filter is on (what the person closed belongs to one set of matches), the bulk actions and the per-row rights (the rows get tick
 * boxes only when the bulk bar has something for this person), and no Approve.
 *
 * The table is a plain <table> in a scroller with a sticky header and a sticky first column (tick box + Document). The dashboard CSS
 * forces 7px on every td/th (!important), zebra-stripes rows, collapses borders and gives th/td 11.5px text, so: the row HEIGHT comes
 * from `h-*` on the row (a table row treats it as a minimum), every cell paints its own opaque background, borders are separate (a
 * collapsed border does not stick), and every text has its own size and colour.
 */
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import {
  Archive, ArchiveRestore, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsDownUp, ChevronsUpDown, Send, UserPlus,
  type LucideIcon,
} from 'lucide-react';
import type { GovDoc } from './lib';
import {
  ActionsCell, AttestationCell, DepartmentCell, DocumentCell, LifecycleCell, OwnerCell, ReviewCell, TypeCell, UpdatedCell, VersionCell,
} from './cells';
import { FrameworksCell } from './FrameworksCell';
import { Versions } from './Versions';
import { NOTHING_OPEN, buildTree, collapseAll, expandAll, flip, openness, treeEntries, type Fold } from './docTree';
import { clampPage, rangeLabel } from './libraryFormat';
import { compareDocs, nextSort, type Lookups, type Sort } from './libraryModel';
import { PAGE_SIZES, type Density } from './libraryPrefs';
import {
  actionableIds, bulkActionsFor, drawnRows, pageOf, rowRights, selectedLabel, tableMinWidth, tickState, toggleAll, toggleOne, visibleColumns,
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
  /** the document open in the drawer: its row is highlighted */
  activeId: number | null;
  /** a row was clicked (or Enter/Space on it): open the drawer */
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
}

const NONE: ReadonlySet<number> = new Set<number>();
const SKELETON_ROWS = 8;
const BULK_ICON: Record<BulkId, LucideIcon> = { publish: Send, 'assign-owner': UserPlus, 'set-review': CalendarClock, archive: Archive, restore: ArchiveRestore };

// The scroller holds the sticky header; it is as tall as the rows, up to what the window leaves under the page's own header and
// cards (Tailwind needs the whole class name written out). The toolbar, bulk bar and footer are outside it and always in view.
// scroll-pt/pl keep a control the keyboard reaches from landing under the sticky header or the sticky first column (280 = TITLE_MIN_WIDTH).
const SCROLLER = 'relative isolate max-h-[calc(100vh-14rem)] scroll-pl-[280px] scroll-pt-10 overflow-auto';
const BTN = 'inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#c3ccd5] bg-[#fff] px-2.5 !text-[13px] font-medium text-[#26323d] hover:bg-[#f3f6f8] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]';
// A body cell: opaque (the sticky one must hide what scrolls under it; the dashboard's zebra stripes sit on the <tr>), a hairline under it.
const CELL = 'overflow-hidden border-b border-[#e1e6eb] px-[12px] align-middle';
// The first column, pinned to the left edge; once the table has scrolled sideways it casts a hairline and a soft shadow.
const PINNED = 'sticky left-0 z-[1]';
const EDGE_SHADOW = 'shadow-[1px_0_0_0_#d5dbe1,6px_0_8px_-6px_rgba(31,41,51,0.25)]';
// Where a click on a row must not open the drawer: on a control, or in a popover portaled out of the cell (React still bubbles it here).
const CONTROLS = 'a, button, input, select, textarea, label, summary, [role="dialog"], [role="menu"], [data-no-peek]';

function TickBox({ label, checked, state, onChange }: { label: string; checked?: boolean; state?: TickState; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = state === 'some'; }, [state]);
  return (
    // the label is a bigger target than the box, and a click on it is not a click on the row
    <label data-no-peek className="-m-1.5 inline-flex shrink-0 cursor-pointer items-center p-1.5">
      <input
        ref={ref}
        type="checkbox"
        checked={checked ?? state === 'all'}
        onChange={onChange}
        aria-label={label}
        className="h-4 w-4 cursor-pointer accent-[#0f766e] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
      />
    </label>
  );
}

function SortButton({ column, sort, onSort }: { column: Column; sort: Sort; onSort: (next: Sort) => void }) {
  const key = column.sort;
  if (!key) return <span className="sr-only">{column.label}</span>;
  const sorted = sort.key === key;
  return (
    <button
      type="button"
      onClick={() => onSort(nextSort(sort, key))}
      title={`Sort by ${column.label.toLowerCase()}`}
      className={`group/sort -mx-1 inline-flex items-center gap-0.5 rounded px-1 py-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e] ${sorted ? 'text-[#1f2933]' : 'text-[#586472] hover:text-[#1f2933]'}`}
    >
      <span className="whitespace-nowrap text-[11px] font-semibold uppercase tracking-wide">{column.label}</span>
      {sorted ? (
        sort.dir === 'asc'
          ? <ChevronUp className="h-4 w-4 text-[#0f766e]" strokeWidth={1.75} aria-hidden />
          : <ChevronDown className="h-4 w-4 text-[#0f766e]" strokeWidth={1.75} aria-hidden />
      ) : (
        <ChevronsUpDown className="h-4 w-4 opacity-0 group-hover/sort:opacity-60 group-focus-visible/sort:opacity-60" strokeWidth={1.75} aria-hidden />
      )}
    </button>
  );
}

function HeadRow({ columns, sort, onSort, selectable, tick, onTickAll, scrolled, fold }: {
  columns: Column[]; sort: Sort; onSort: (next: Sort) => void; selectable: boolean; tick: TickState; onTickAll: () => void; scrolled: boolean;
  /** the tree's "open all / close all" (only where some document has documents under it) */
  fold: { allOpen: boolean; onToggle: () => void } | null;
}) {
  return (
    <tr className="h-10">
      {columns.map((c) => {
        const first = c.id === 'title';
        const sorted = c.sort != null && sort.key === c.sort;
        return (
          <th
            key={c.id}
            scope="col"
            aria-sort={sorted ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
            className={`sticky top-0 border-b border-[#d5dbe1] px-[12px] text-left align-middle !bg-[#f3f6f8] ${first ? `left-0 z-[3] ${scrolled ? EDGE_SHADOW : ''}` : 'z-[2]'}`}
          >
            {first ? (
              <div className="flex items-center gap-2">
                {selectable && <TickBox label="Select all documents on this page" state={tick} onChange={onTickAll} />}
                <SortButton column={c} sort={sort} onSort={onSort} />
                {fold && (
                  <button
                    type="button"
                    onClick={fold.onToggle}
                    aria-label={fold.allOpen ? 'Collapse all' : 'Expand all'}
                    title={fold.allOpen ? 'Collapse all' : 'Expand all'}
                    className="ml-auto grid h-6 w-6 place-items-center rounded-md text-[#586472] hover:bg-[#e8ecf0] hover:text-[#1f2933] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
                  >
                    {fold.allOpen ? <ChevronsDownUp className="h-4 w-4" strokeWidth={1.75} aria-hidden /> : <ChevronsUpDown className="h-4 w-4" strokeWidth={1.75} aria-hidden />}
                  </button>
                )}
              </div>
            ) : (
              <SortButton column={c} sort={sort} onSort={onSort} />
            )}
          </th>
        );
      })}
    </tr>
  );
}

/** " · +4 nested": the pages count the documents at the top of the tree, the ones nested under them come with them. */
const nestedNote = (n: number) => (n === 0 ? '' : ` · +${n} nested`);

export function LibraryTable({
  docs, scope, filtering, lookups, counts, preferFrameworks, sort, onSort, hiddenColumns, density, pageSize, onPageSize, activeId,
  onPeek, onOpenDoc, onPickFramework, onEdit, onDownload, onArchive, onRestore, canEdit = false, canEditRow, canArchiveRow, canRestoreRow,
  showingArchived = false, onBulkPublish, onBulkArchive, onBulkAssignOwner, onBulkSetReviewDate, onBulkRestore, loading = false, emptyState,
}: LibraryTableProps) {
  const compact = density === 'compact';
  const columns = visibleColumns(hiddenColumns);
  const hasDepartmentColumn = columns.some((c) => c.id === 'department');
  const rowHeight = compact ? 'h-9' : 'h-14';

  // the documents in the order chosen (children follow it), each under its parent; with a search or filter, the matches and the
  // documents above them (docTree.ts)
  const ordered = useMemo(() => [...scope].sort(compareDocs({ key: sort.key, dir: sort.dir }, lookups)), [scope, sort.key, sort.dir, lookups]);
  const roots = useMemo(() => buildTree(ordered, new Set(docs.map((d) => d.id))), [ordered, docs]);
  const entries = useMemo(() => treeEntries(roots), [roots]);
  const at = useMemo(() => new Map(entries.map((e) => [e.doc.id, e])), [entries]);
  const top = useMemo(() => roots.map((n) => n.doc), [roots]);
  const parents = entries.filter((e) => e.children.length > 0).map((e) => e.doc.id);
  const context = entries.filter((e) => !e.match).length;

  // What the person closed, ticked and paged to belongs to one set of matches, one order and one page size: when they change, the
  // way to every match opens again, the ticks go and the table is back on page 1 (state adjusted while rendering, not in an effect,
  // so a stale tick is never drawn).
  const matchKey = useMemo(() => docs.map((d) => d.id).join(','), [docs]);
  const viewKey = `${matchKey}|${sort.key}:${sort.dir}|${pageSize}`;
  const [fold, setFold] = useState<Fold>(NOTHING_OPEN);
  const [selected, setSelected] = useState<ReadonlySet<number>>(NONE);
  const [pageNo, setPageNo] = useState(1);
  const [seen, setSeen] = useState({ match: matchKey, view: viewKey });
  if (seen.view !== viewKey) {
    if (seen.match !== matchKey) { setFold((f) => ({ ...f, shut: NONE })); setSelected(NONE); }
    setPageNo(1);
    setSeen({ match: matchKey, view: viewKey });
  }
  const [scrolled, setScrolled] = useState(false);

  const openOf = (id: number, f: Fold = fold): Open => openness(f, id, (at.get(id)?.children.length ?? 0) > 0, filtering);
  const anyOpen = entries.some((e) => openOf(e.doc.id) != null);

  // pages hold top-level rows; the documents under an open one follow it
  const page = clampPage(pageNo, pageSize, top.length);
  const pages = Math.max(1, Math.ceil(top.length / pageSize));
  const rows = drawnRows(pageOf(top, page, pageSize), at, openOf);
  const tickable = rows.filter((r) => r.match).map((r) => r.doc.id);
  const sizes = PAGE_SIZES.includes(pageSize) ? PAGE_SIZES : [...PAGE_SIZES, pageSize].sort((a, b) => a - b);

  // the rows get tick boxes only when the bulk bar has something for this person to do; no Approve: a document is approved by its
  // approvers signing it in its review (the server refuses a bulk approval), and Publish publishes only approved documents
  const bulkActions = bulkActionsFor(canEdit, showingArchived, !!onBulkRestore);
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

  const peek = (e: MouseEvent<HTMLTableRowElement>, id: number) => {
    const target = e.target as HTMLElement;
    if (!e.currentTarget.contains(target) || target.closest(CONTROLS)) return;     // a click on a control, or one that came out of a portal
    if (window.getSelection()?.toString()) return;                                  // text being selected to copy a code or a title
    onPeek(id);
  };
  const peekKey = (e: KeyboardEvent<HTMLTableRowElement>, id: number) => {
    if (e.target !== e.currentTarget) return;                                       // Enter on a button inside the row is that button's
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPeek(id); }
  };

  const renderRow = (r: DrawnRow<GovDoc>) => {
    const { doc } = r;
    const active = activeId === doc.id;
    const isTicked = selected.has(doc.id);
    const bg = active || isTicked ? 'bg-[#f0fdfa]' : r.match ? 'bg-[#fff] group-hover/row:bg-[#f7f9fb]' : 'bg-[#fafbfc] group-hover/row:bg-[#f3f6f8]';
    const department = doc.department_id != null ? lookups.departments[String(doc.department_id)] : undefined;
    const content = (id: Column['id']): ReactNode => {
      switch (id) {
        case 'type': return <TypeCell doc={doc} />;
        case 'lifecycle': return <LifecycleCell doc={doc} />;
        case 'owner': return <OwnerCell doc={doc} department={hasDepartmentColumn ? undefined : department} compact={compact} />;      // the column says it already
        case 'department': return <DepartmentCell name={department} />;
        case 'frameworks': return <FrameworksCell doc={doc} info={lookups.frameworks} prefer={preferFrameworks} onPick={onPickFramework} />;
        case 'attestation': return <AttestationCell pct={lookups.coverage[doc.id]} count={counts[doc.id]} compact={compact} />;
        case 'review': return <ReviewCell doc={doc} compact={compact} />;
        case 'version': return <VersionCell doc={doc} compact={compact} />;
        case 'updated': return <UpdatedCell value={doc.updated_at} />;
        case 'actions': return <ActionsCell doc={doc} rights={rowRights(rights, doc)} onOpenDoc={onOpenDoc} onEdit={onEdit} onDownload={onDownload} onArchive={onArchive} onRestore={onRestore} />;
        default: return null;
      }
    };
    return (
      <Fragment key={doc.id}>
        <tr
          data-doc-row={doc.id}
          tabIndex={0}
          aria-selected={active ? true : undefined}
          onClick={(e) => peek(e, doc.id)}
          onKeyDown={(e) => peekKey(e, doc.id)}
          className={`group/row cursor-pointer ${rowHeight} focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#0f766e]`}
        >
          {columns.map((c) => c.id === 'title' ? (
            <td
              key={c.id}
              className={`${CELL} ${bg} ${PINNED} ${scrolled ? EDGE_SHADOW : ''} before:absolute before:inset-y-0 before:left-0 before:w-[2px] ${active ? 'before:bg-[#0f766e]' : 'before:bg-transparent group-focus-visible/row:before:bg-[#0f766e]'}`}
            >
              <div className="flex items-center gap-2">
                {bulkActions.length > 0 && (r.match
                  ? <TickBox label={`Select ${doc.title}`} checked={isTicked} onChange={() => setSelected((s) => toggleOne(s, doc.id))} />
                  : <span className="w-4 shrink-0" aria-hidden />)}
                <DocumentCell
                  doc={doc}
                  depth={r.depth}
                  match={r.match}
                  childCount={r.childCount}
                  open={r.open}
                  parentTitle={r.parent?.title}
                  compact={compact}
                  showVersion={!columns.some((c) => c.id === 'version')}
                  onToggle={() => setFold((f) => flip(f, doc.id, openOf(doc.id, f) != null))}
                  onOpenDoc={onOpenDoc}
                />
              </div>
            </td>
          ) : (
            <td key={c.id} className={`${CELL} ${bg}`}>{content(c.id)}</td>
          ))}
        </tr>
        {r.open === 'all' && (
          <tr>
            <td colSpan={columns.length} className="border-b border-[#e1e6eb] bg-[#fbfcfd] px-[12px]">
              {/* pinned to the left edge, so the versions stay in view when the table has scrolled sideways */}
              <div className="sticky left-[12px] w-[44rem] max-w-[calc(100vw-4rem)] py-[4px]" style={{ paddingLeft: bulkActions.length > 0 ? 24 : 0 }}>
                <Versions doc={doc} depth={r.depth} />
              </div>
            </td>
          </tr>
        )}
      </Fragment>
    );
  };

  const empty = !loading && top.length === 0;
  if (empty && scrolled) setScrolled(false);        // the scroller is gone; the next one starts at the left edge
  return (
    <div className="min-w-0 max-w-full overflow-hidden rounded-xl border border-[#d5dbe1] bg-white">
      {!loading && ticked.length > 0 && bulkActions.length > 0 && (
        <div role="region" aria-label="Bulk actions" className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-[#1f2933] px-[12px] py-[8px]">
          <span role="status" className="text-[13px] font-medium text-[#fff]">{selectedLabel(ticked.length)}</span>
          <div className="flex flex-wrap items-center gap-1">
            {bulkActions.map((a) => {
              const Icon = BULK_ICON[a.id];
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => runBulk(a.id, ticked)}
                  className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 !text-[13px] font-medium hover:bg-[#2f3d4a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#99f6e4] ${a.danger ? 'text-[#fda4af]' : 'text-[#99f6e4]'}`}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} aria-hidden /> {a.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => setSelected(NONE)}
            className="ml-auto rounded-md px-2 py-1 !text-[13px] text-[#cbd5e1] hover:text-[#fff] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#99f6e4]"
          >
            Clear
          </button>
        </div>
      )}

      {empty ? (
        <div className="flex min-h-[10rem] items-center justify-center px-4 py-10">{emptyState}</div>
      ) : (
        <div className={SCROLLER} onScroll={(e) => setScrolled(e.currentTarget.scrollLeft > 0)}>
          <table className="w-full table-fixed !border-separate border-spacing-0 text-left" style={{ minWidth: tableMinWidth(columns) }}>
            <caption className="sr-only">{loading ? 'Loading the documents' : 'Documents'}</caption>
            <colgroup>
              {columns.map((c) => <col key={c.id} style={c.width ? { width: c.width } : undefined} />)}
            </colgroup>
            <thead>
              <HeadRow
                columns={columns}
                sort={sort}
                onSort={onSort}
                selectable={bulkActions.length > 0}
                tick={tickState(selected, tickable)}
                onTickAll={() => setSelected((s) => toggleAll(s, tickable))}
                scrolled={scrolled}
                fold={parents.length > 0 ? { allOpen: parents.every((id) => openOf(id) != null), onToggle: () => setFold(parents.every((id) => openOf(id) != null) ? collapseAll(parents) : expandAll) } : null}
              />
            </thead>
            <tbody aria-busy={loading || undefined}>
              {loading
                ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                    <tr key={i} aria-hidden className={rowHeight}>
                      {columns.map((c) => (
                        <td key={c.id} className={`${CELL} bg-[#fff] ${c.id === 'title' ? `${PINNED} ${scrolled ? EDGE_SHADOW : ''}` : ''}`}>
                          <span className="block h-3.5 animate-pulse rounded bg-[#e1e6eb] motion-reduce:animate-none" style={{ width: c.id === 'title' ? '65%' : c.id === 'actions' ? '40%' : '70%' }} />
                        </td>
                      ))}
                    </tr>
                  ))
                : rows.map(renderRow)}
            </tbody>
          </table>
        </div>
      )}

      {!loading && top.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-[#e1e6eb] px-[12px] py-[8px]">
          <p className="text-[13px] text-[#586472]" aria-live="polite">
            {rangeLabel(page, pageSize, top.length)}
            {/* pages count the documents at the top of the tree; the ones nested under them come with them */}
            {nestedNote(entries.filter((e) => e.depth > 0).length)}
          </p>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label className="inline-flex items-center gap-2 text-[13px] text-[#586472]">
              Rows
              <select
                value={pageSize}
                onChange={(e) => onPageSize(Number(e.target.value))}
                className="h-8 rounded-lg border border-[#c3ccd5] bg-[#fff] px-2 text-[13px] text-[#26323d] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0f766e]"
              >
                {sizes.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <div className="flex items-center gap-2">
              <button type="button" className={BTN} disabled={page <= 1} onClick={() => setPageNo(page - 1)} aria-label="Previous page">
                <ChevronLeft className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
              <span className="text-[13px] tabular-nums text-[#586472]">{page} / {pages}</span>
              <button type="button" className={BTN} disabled={page >= pages} onClick={() => setPageNo(page + 1)} aria-label="Next page">
                <ChevronRight className="h-4 w-4" strokeWidth={1.75} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default LibraryTable;
