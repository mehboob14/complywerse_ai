'use client';

/**
 * The Facet explorer for Business Continuity: ONE screen the three registers (Plans, Drills, Findings) are configured into (RegisterDef: _register/registerModel.ts). It owns what every
 * register does the same way: the rail of facets with live counts, the quick-view chips with the number each would show, the search, the sort, the pager, the filters that are on as
 * chips, the ticks with "Select all N matching" and "Export selection", the keys ("/", j / k, Enter, Esc), the read-only board where a register has one, the drawer over the list, and
 * the states (loading, the list could not be read, nothing yet, nothing matches, the list was cut). Each register hands it its rows (one lean request, complete: every count is over all
 * of them), its columns, card, row menu and drawer. The page's state (filters, sort, view, the record open) lives in the ADDRESS, so a link opens the same view.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { Button, EmptyState, ErrorState, Menu, Notice, Pager, SkeletonRows, type FilterChip, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { AppliedFilters } from '@/components/records/AppliedFilters';
import { BoardColumns } from '@/components/records/BoardColumns';
import { BulkBar } from '@/components/records/BulkBar';
import { RecordExplorer } from '@/components/records/RecordExplorer';
import type { ExplorerFit } from '@/components/records/explorerFit';
import { RecordTable, type RecordColumn, type RecordItem, type RecordRow } from '@/components/records/RecordTable';
import { countOf, evaluate } from '@/components/records/facetEngine';
import { moveCursor, selectAllMatching, tickState, toggleAll, toggleOne } from '@/components/records/explorerModel';
import type { FacetGroupView } from '@/components/records/FacetRail';
import { useExplorerKeys } from '@/components/records/useExplorerKeys';
import { useSelection } from '@/components/records/useSelection';
import { formatCount, truncate } from '@/lib/format';
import {
  boardOf, chipsOf, chosenOf, countLine, csvOf, exportName, todayText, filtersOf, filterCount, indexOf, isFiltering, nextSort, noFilters, optionsOf, orderedOptions, patchOf, quickCounts, removeChip, ruleOf, sortRows,
  type Ctx, type Filters, type RegisterDef, type Sort,
} from './registerModel';

const PAGE_SIZES = [25, 50, 100, 250] as const;

function download(data: BlobPart, fileName: string, type?: string) {
  const url = URL.createObjectURL(new Blob([data], type ? { type } : undefined));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export interface RegisterQuery<R> {
  rows: R[] | undefined;
  total?: number;
  truncated?: boolean;
  isPending: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
}

export interface DrawerProps<R> { row: R | null; onClose: () => void; onStep: (dir: -1 | 1) => void; hasPrev: boolean; hasNext: boolean }

export interface BcmRegisterProps<R extends { id: number }> {
  def: RegisterDef<R>;
  address: Record<string, unknown>;
  setAddress: (patch: Record<string, unknown>, options?: { push?: boolean }) => void;
  query: RegisterQuery<R>;
  me: number | null;
  /** names the region for a screen reader: "Continuity plans" */
  region: string;
  searchLabel: string;
  /** the page head and the strip of tabs; `meta` is the count line */
  head: (fit: ExplorerFit, meta: string | undefined) => ReactNode;
  columns: RecordColumn<R>[];
  card: (row: RecordRow<R>) => ReactNode;
  rowMenu: (row: R) => ReactNode;
  boardCard?: (row: R, ctx: Ctx) => ReactNode;
  drawer: (p: DrawerProps<R>) => ReactNode;
  /** what the first-use state says */
  firstUse: ReactNode;
  /** the records' names, for the ticks and the board */
  nameOf: (row: R) => string;
  /** "Couldn't load the plans" */
  failureTitle: string;
  /** "You don't have access to the plans" */
  refusalTitle: string;
  /** after the failure/cut notices: e.g. a register's own notice */
  notices?: ReactNode;
  /** buttons of the toolbar beside Sort and Export */
  toolbar?: (fit: ExplorerFit) => ReactNode;
}

const NO_ROWS: never[] = [];

export function BcmRegister<R extends { id: number }>({
  def, address, setAddress, query, me, region, searchLabel, head, columns, card, rowMenu, boardCard, drawer, firstUse, nameOf, failureTitle, refusalTitle, notices, toolbar,
}: BcmRegisterProps<R>) {
  // ── the page's state: in the address ──
  const filters = useMemo(() => filtersOf(def, address), [def, address]);
  const sort = (address.sort as Sort | null) ?? def.defaultSort;
  const view = address.view === 'board' && def.board ? 'board' : 'list';
  const openId = (address.open as number) || null;
  const setFilters = useCallback((next: Filters) => setAddress(patchOf(def, next)), [def, setAddress]);
  const setSort = useCallback((next: Sort) => setAddress({ sort: next }), [setAddress]);
  const setOpenId = useCallback((id: number | null) => setAddress({ open: id ?? 0 }), [setAddress]);

  // ── the data ──
  const rows: R[] = query.rows ?? (NO_ROWS as R[]);
  const noList = query.isError && !query.rows;                  // the list could not be read at all: never drawn as an empty register
  const loading = query.isPending && !query.rows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [query.rows]);
  const ctx: Ctx = useMemo(() => ({ me, now }), [me, now]);

  // ── the facets: one index of the rows, one pass for the matches and every live count ──
  const index = useMemo(() => indexOf(def, rows, ctx), [def, rows, ctx]);
  const searched = useDeferredValue(filters.search);
  const applied = useMemo(() => (searched === filters.search ? filters : { ...filters, search: searched }), [filters, searched]);
  const result = useMemo(() => evaluate(index, chosenOf(applied), ruleOf(def, applied, ctx)), [index, applied, def, ctx]);
  const filtered = result.matches;
  const filtering = isFiltering(filters);
  const matchKey = useMemo(() => `${filtered.length}:${filtered.reduce((h, r) => (h * 31 + r.id) >>> 0, 7)}`, [filtered]);

  const options = useMemo(() => optionsOf(def, rows, ctx), [def, rows, ctx]);
  const groups: FacetGroupView[] = def.facets.map((facet) => {
    const picked = filters.chosen[facet.key] ?? [];
    const opts = orderedOptions(options[facet.key] ?? [], picked, (v) => countOf(result.counts, facet.key, v));
    return {
      key: facet.key, label: facet.title, chosen: picked.length, searchable: !!facet.searchable, limit: facet.limit, defaultOpen: !!facet.open,
      options: opts.map((o) => ({ value: o.value, label: o.label, title: o.title, count: countOf(result.counts, facet.key, o.value), checked: picked.includes(o.value) })),
    };
  });
  const toggleFacet = (facet: string, value: string) => {
    const cur = filters.chosen[facet] ?? [];
    setFilters({ ...filters, chosen: { ...filters.chosen, [facet]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] } });
  };
  const clearFacet = (facet: string) => setFilters({ ...filters, chosen: { ...filters.chosen, [facet]: [] } });

  // ── the quick views, with the number each would show ──
  const counts = useMemo(() => quickCounts(def, rows, ctx), [def, rows, ctx]);
  const activeQuick = filters.quick ?? 'all';
  const quick: FilterChip[] = def.quick.filter((q) => def.shown.includes(q.id)).map((q) => ({
    key: q.id, label: q.label, active: activeQuick === q.id, count: counts[q.id] ?? 0, title: q.note?.(ctx),
  }));
  const onQuick = (id: string) => setFilters({ ...filters, quick: id === 'all' || activeQuick === id ? null : id });
  const moreQuick: MenuItem[] = def.quick.filter((q) => !def.shown.includes(q.id)).map((q, i) => ({
    key: `q:${q.id}`, label: q.label, checked: activeQuick === q.id, radio: true, trailing: String(counts[q.id] ?? 0), section: i === 0 ? 'More views' : undefined, onSelect: () => onQuick(q.id),
  }));

  // ── the list: sorted, a page of it ──
  const sorted = useMemo(() => sortRows(def, filtered, sort, ctx), [def, filtered, sort, ctx]);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const viewKey = `${matchKey}|${sort.key}:${sort.dir}|${pageSize}`;
  const [seen, setSeen] = useState(viewKey);
  if (seen !== viewKey) { setSeen(viewKey); setPageNo(1); }
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageClamped = Math.min(Math.max(1, pageNo), pages);
  const pageRows = useMemo(() => sorted.slice((pageClamped - 1) * pageSize, pageClamped * pageSize), [sorted, pageClamped, pageSize]);

  // ── ticks, the cursor, the details ──
  const selection = useSelection(matchKey);
  const [cursor, setCursor] = useState<number | null>(null);
  const openRow = openId != null ? rows.find((r) => r.id === openId) ?? null : null;
  const openAt = openRow ? sorted.findIndex((r) => r.id === openRow.id) : -1;
  const missingOpen = openId != null && !loading && !noList && !openRow;
  const ticked = useMemo(() => {
    const matching = new Set(filtered.map((r) => r.id));
    return Array.from(selection.selected).filter((id) => matching.has(id));
  }, [selection.selected, filtered]);
  const tickedRows = useMemo(() => rows.filter((r) => ticked.includes(r.id)), [rows, ticked]);

  const items: RecordItem<R>[] = useMemo(() => pageRows.map((record) => ({ kind: 'row' as const, id: record.id, record, depth: 0 })), [pageRows]);
  const pageIds = useMemo(() => pageRows.map((r) => r.id), [pageRows]);

  const searchRef = useRef<HTMLInputElement>(null);
  useExplorerKeys({
    onSearch: () => searchRef.current?.focus(),
    onMove: (dir) => setCursor((c) => moveCursor(pageIds, c, dir)),
    onOpen: () => { if (cursor != null) setOpenId(cursor); },
    onEscape: () => { if (selection.selected.size > 0) selection.clear(); },
  }, view === 'list');
  useEffect(() => {
    if (cursor != null) document.querySelector(`[data-record-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const exportRows = (list: readonly R[], selectionOnly: boolean) => {
    download(csvOf(def, list, ctx), exportName(def, todayText(), list.length, selectionOnly), 'text/csv;charset=utf-8');
  };

  // ── what the page says ──
  const chips = chipsOf(def, filters, options);
  const nothing = rows.length === 0;
  const sortItems: MenuItem[] = def.sorts.map((s, i) => ({
    key: `sort:${s.key}`, label: s.label, checked: sort.key === s.key, radio: true, section: i === 0 ? 'Sort by' : undefined,
    trailing: sort.key === s.key ? (sort.dir === 'asc' ? '↑ ascending' : '↓ descending') : undefined, onSelect: () => setSort(nextSort(def, sort, s.key)),
  }));
  const selectionApi = view === 'list' ? {
    ticked: selection.selected,
    onToggle: (id: number) => selection.set((s) => toggleOne(s, id)),
    state: tickState(selection.selected, pageIds),
    onToggleAll: () => selection.set((s) => toggleAll(s, pageIds)),
    headLabel: `Select all ${def.noun.other} on this page`,
    rowLabel: (r: R) => `Select ${truncate(nameOf(r), 60).text}`,
  } : undefined;

  const noun = def.noun;
  const failure = (() => {
    if (statusOf(query.error) === 403) return { title: refusalTitle, message: 'Ask an administrator to give you access to Business Continuity.' };
    return { title: failureTitle, message: errorMessage(query.error) };
  })();

  const body = (() => {
    if (noList) return <ErrorState {...failure} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} />;
    if (loading) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={10} columns={5} label={`Loading the ${noun.other}`} /></div>;
    if (nothing) return <div className="rounded-ds-card border border-ds-border bg-ds-surface">{firstUse}</div>;
    if (filtered.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="noMatches" bare title={`No ${noun.other} match`} description="Loosen a filter, or search for other words." onClearFilters={filtering ? () => setFilters(noFilters(def)) : undefined} />
        </div>
      );
    }
    if (view === 'board' && def.board && boardCard) {
      const note = def.board.note?.(filtered);
      return (
        <div className="flex flex-col gap-[8px]">
          <div className="relative overflow-clip rounded-ds-card border border-ds-border bg-ds-surface">
            <BoardColumns
              label={def.board.label}
              columns={boardOf(def, sorted)}
              getId={(r: R) => r.id}
              activeId={openId}
              cardLabel={nameOf}
              onOpen={(r: R) => setOpenId(r.id)}
              onShowAll={(column) => { setAddress({ view: 'list' }); setFilters(boardFilter(def, column, filters)); }}
              renderCard={(r: R) => boardCard(r, ctx)}
            />
          </div>
          {note && <p className="m-0 px-[4px] text-ds-label text-ds-fg-muted">{note}</p>}
        </div>
      );
    }
    return (
      <>
        <RecordTable
          caption={region}
          columns={columns}
          items={items}
          sort={{ key: sort.key, dir: sort.dir }}
          onSort={(key) => setSort(nextSort(def, sort, key))}
          selection={selectionApi}
          activeId={openId}
          cursorId={cursor}
          onActivate={(r) => setOpenId(r.id)}
          actions={rowMenu}
          card={card}
        />
        <Pager className="mt-[8px]" page={pageClamped} pageSize={pageSize} total={sorted.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={noun} />
      </>
    );
  })();

  const meta = noList || loading ? undefined : countLine(noun, query.total, rows.length, !!query.truncated);
  const pool = rows.length;

  return (
    <>
      <RecordExplorer
        label={region}
        noun={noun}
        head={(fit) => head(fit, meta)}
        notices={(
          <>
            {query.isError && !noList && (
              <ErrorState compact title={`Couldn't refresh the ${noun.other}`} message={`${errorMessage(query.error)} What is shown may be out of date.`} onRetry={canRetry(query.error) ? () => { void query.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
            )}
            {query.truncated && <Notice tone="info" title={`Only part of the ${noun.other} is loaded`}>{`${formatCount(rows.length)} of ${formatCount(query.total ?? rows.length)} are shown. Filter to narrow it down.`}</Notice>}
            {missingOpen && (
              <Notice tone="warning" title={`That ${noun.one} is not in the list`} action={<Button variant="ghost" onClick={() => setOpenId(null)}>Dismiss</Button>}>
                It may have been deleted since the link was made.
              </Notice>
            )}
            {notices}
          </>
        )}
        quick={noList || loading ? [] : quick}
        onQuick={onQuick}
        quickLabel="Quick views"
        quickExtra={noList || loading || moreQuick.length === 0 ? undefined : <Menu label="More views" items={moreQuick} />}
        search={filters.search}
        onSearch={(q) => setFilters({ ...filters, search: q })}
        searchLabel={searchLabel}
        searchRef={searchRef}
        views={def.board ? { label: `${region} view`, name: `bcm-${def.slug}-view`, options: [{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }], value: view, onChange: (v) => setAddress({ view: v }) } : undefined}
        actions={(fit) => (
          <>
            {view === 'list' && <Menu label="Sort" items={sortItems} />}
            <Button leftIcon={<Download aria-hidden />} onClick={() => exportRows(sorted, false)} disabled={filtered.length === 0 || loading} title={`Export the ${formatCount(filtered.length)} ${filtered.length === 1 ? noun.one : noun.other} shown as a spreadsheet`}>
              <span className={fit.tight ? 'sr-only' : undefined}>Export</span>
            </Button>
            {toolbar?.(fit)}
          </>
        )}
        groups={groups}
        onToggle={toggleFacet}
        onClear={clearFacet}
        onClearAll={() => setFilters(noFilters(def))}
        filtering={filterCount(filters)}
        shown={filtered.length}
        applied={loading || noList ? null : (
          <AppliedFilters
            chips={chips.map((c) => ({ key: c.key, label: c.label }))}
            summary={`${formatCount(filtered.length)} of ${formatCount(pool)} ${pool === 1 ? noun.one : noun.other}`}
            onRemove={(key) => { const chip = chips.find((c) => c.key === key); if (chip) setFilters(removeChip(filters, chip)); }}
            onClear={() => setFilters(noFilters(def))}
          />
        )}
        body={body}
        bulk={view === 'list' && !loading && ticked.length > 0 ? (fit) => (
          <BulkBar
            iconsOnly={fit.compact}
            count={ticked.length}
            matching={filtered.length}
            onSelectAll={() => selection.set(selectAllMatching(filtered.map((r) => r.id)))}
            onClear={selection.clear}
            actions={[{ id: 'export', label: 'Export selection', icon: Download, onRun: () => exportRows(tickedRows, true) }]}
          />
        ) : undefined}
        detail={drawer({
          row: openRow,
          onClose: () => setOpenId(null),
          onStep: (dir) => { const next = sorted[openAt + dir]; if (next) setOpenId(next.id); },
          hasPrev: openAt > 0,
          hasNext: openAt >= 0 && openAt < sorted.length - 1,
        })}
        ready={!loading && !noList}
      />
    </>
  );
}

/** "Show all N" on a board column: the list, filtered to what that column holds (the column ids are the register's own, see boardFilters). */
function boardFilter<R extends { id: number }>(def: RegisterDef<R>, column: string, filters: Filters): Filters {
  const rule = BOARD_FILTERS[def.slug]?.[column];
  return rule ? { ...filters, ...rule(filters) } : filters;
}

/** For the Drills board: each column is a status filter (Overdue and Scheduled are statuses; In progress is one; Done is three). */
const BOARD_FILTERS: Record<string, Record<string, (f: Filters) => Partial<Filters>>> = {
  drills: {
    overdue: (f) => ({ chosen: { ...f.chosen, status: ['overdue'] } }),
    scheduled: (f) => ({ chosen: { ...f.chosen, status: ['scheduled'] } }),
    in_progress: (f) => ({ chosen: { ...f.chosen, status: ['in_progress'] } }),
    done: (f) => ({ chosen: { ...f.chosen, status: ['completed', 'under_review', 'closed'] } }),
  },
};
