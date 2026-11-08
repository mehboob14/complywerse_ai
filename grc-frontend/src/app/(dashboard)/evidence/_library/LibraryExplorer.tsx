'use client';

/**
 * Evidence Management > Library: the Facet explorer. This file is the Evidence CONFIGURATION of components/records (RecordExplorer): it owns the data (one lean request for every file,
 * the person's id), the page's state (filters, sort, the file open and the view live in the ADDRESS, so a link opens the same view), the actions and what each part draws. What a filter
 * MEANS is libraryModel.ts; the facets and their live counts are libraryFacets.ts over components/records/facetEngine.ts (held to the plain filter by a test).
 *
 * The Library loads ONCE, whole: every count, facet number, the board and the export are over all the files (the response says when it could not hold them all). The old list read the
 * newest 1,000 at two queries a row. The old workspace's Pipeline is the Board here; its Snapshot is the Insights tab. Every action is said when the server has answered (libraryActions.tsx).
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { Download, FileText, FolderPlus, Plus, Send, ThumbsUp, Trash2 } from 'lucide-react';
import EvidenceViewer, { type EvidenceFile } from '@/components/evidence/EvidenceViewer';
import {
  Button, EmptyState, ErrorState, Menu, Notice, Pager, SkeletonRows, type FilterChip, type MenuItem,
} from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { AppliedFilters } from '@/components/records/AppliedFilters';
import { BoardColumns } from '@/components/records/BoardColumns';
import { BulkBar, type BulkActionDef } from '@/components/records/BulkBar';
import { RecordExplorer } from '@/components/records/RecordExplorer';
import type { ExplorerFit } from '@/components/records/explorerFit';
import { RecordTable, type RecordItem } from '@/components/records/RecordTable';
import { countOf, evaluate } from '@/components/records/facetEngine';
import { moveCursor, selectAllMatching, tickState, toggleAll, toggleOne } from '@/components/records/explorerModel';
import type { FacetGroupView } from '@/components/records/FacetRail';
import { useExplorerKeys } from '@/components/records/useExplorerKeys';
import { useSelection } from '@/components/records/useSelection';
import { usePermissions } from '@/hooks/usePermissions';
import { formatCount, truncate } from '@/lib/format';
import type { AddressState } from '@/lib/addressState';
import { BoardCard, LibraryCard, RowMenu, libraryColumns, type RowEnv } from './LibraryRows';
import { LibraryDrawer } from './LibraryDrawer';
import { useLibraryActions } from './libraryActions';
import { NO_SCOPE, idsOf, scopeWords, withControlScope } from './controlScope';
import { useControlScope } from './useControlScope';
import { LIBRARY_SCHEMA, filtersPatch, openPatch, pageOf, type LibraryAddress } from './libraryAddress';
import { useLibrary, useMeId } from './libraryData';
import {
  FACET_TITLE, NO_FILTERS, OPEN_AT_FIRST, RAIL_ORDER, SEARCHABLE, chosenOf, filterChips, filterCount, indexLibrary, isFiltering, orderedOptions, railOptions, removeChip, ruleOf,
  type FacetKey, type Filters,
} from './libraryFacets';
import { QUICK_LABEL, SORT_KEYS, SORT_LABEL, boardOf, exportName, inQuick, libraryCsv, nextSort, sortRows, type LibraryRow, type QuickId, type SortKey, type Viewer } from './libraryModel';

const PAGE_SIZES = [25, 50, 100, 250] as const;
const QUICK_SHOWN: QuickId[] = ['all', 'waiting', 'expiring', 'lapsed', 'unrated', 'unlinked'];
const QUICK_IDS_COUNTED: QuickId[] = ['all', 'waiting', 'expiring', 'lapsed', 'unrated', 'unlinked', 'mine'];
const RAIL_LIMIT: Partial<Record<FacetKey, number>> = { type: 7, owner: 7, framework: 7 };
const NO_ROWS: LibraryRow[] = [];
const NO_FILES: ReadonlySet<number> = new Set<number>();

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

/** What a failed request says: a refusal says the person has no access, anything else says it could not be loaded, with the server's words. */
function failureWords(error: unknown): { title: string; message: string } {
  if (statusOf(error) === 403) return { title: "You don't have access to the evidence library", message: 'Ask an administrator to give you access to Evidence Management.' };
  return { title: "Couldn't load the evidence", message: errorMessage(error) };
}

export interface LibraryExplorerProps {
  address: AddressState<typeof LIBRARY_SCHEMA>;
  setAddress: (patch: Partial<AddressState<typeof LIBRARY_SCHEMA>>, options?: { push?: boolean }) => void;
  onUploadClick: () => void;
  /** the page head and the tab strip (the page draws them, as it does for Insights and Settings); `meta` is the count line under the title, when there is one */
  head: (fit: ExplorerFit, meta: string | undefined) => ReactNode;
}

export function LibraryExplorer({ address, setAddress, onUploadClick, head }: LibraryExplorerProps) {
  const router = useRouter();
  const { hasPermission } = usePermissions();
  // The server lets any signed-in person do all of this; the Library keeps the rights the old workspace checked (recorded as a gap for the user to settle)
  const canCreate = hasPermission('evidence:evidence_library:create');
  const canEdit = hasPermission('evidence:evidence_library:edit');
  const canDelete = hasPermission('evidence:evidence_library:delete');
  const me = useMeId();

  // ── the page's state: in the address ──
  const page = useMemo(() => pageOf(address as unknown as LibraryAddress), [address]);
  const { filters, sort, openId } = page;
  const scope = page.control;                                          // "evidence for this control": the address names one (controlScope.ts)
  const view = page.view === 'board' ? 'board' : 'list';
  const setFilters = useCallback((next: Filters) => setAddress(filtersPatch(next)), [setAddress]);
  const setSort = useCallback((next: typeof sort) => setAddress({ sort: next }), [setAddress]);
  const setOpenId = useCallback((id: number | null) => setAddress(openPatch(id)), [setAddress]);

  // ── the data ──
  const libQ = useLibrary();
  const rows: LibraryRow[] = libQ.data?.items ?? NO_ROWS;
  const total = libQ.data?.total;
  const cut = !!libQ.data?.truncated;
  const archivedCount = useMemo(() => rows.reduce((n, r) => n + (r.status === 'archived' ? 1 : 0), 0), [rows]);
  const noList = libQ.isError && !libQ.data;                         // the list could not be read at all: never drawn as an empty library
  const scopeQ = useControlScope(scope);
  const scopeIds = useMemo(() => idsOf(scopeQ.data), [scopeQ.data]);
  const scopeBusy = !!scope && scopeQ.isPending;                       // until the control's files are known the list is not drawn, so it is never briefly the whole library
  const scopeFailed = !!scope && scopeQ.isError && !scopeQ.data;
  const scopeSaid = scope && scopeQ.data ? scopeWords(scopeQ.data) : null;
  const loading = libQ.isPending || scopeBusy;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => Date.now(), [libQ.data]);
  const viewer: Viewer = useMemo(() => ({ me, canReview: canCreate, now }), [me, canCreate, now]);

  // ── the facets: one index of the files, one pass for the matches and every live count ──
  const index = useMemo(() => indexLibrary(rows, now), [rows, now]);
  const searched = useDeferredValue(filters.search);
  const applied = useMemo(() => (searched === filters.search ? filters : { ...filters, search: searched }), [filters, searched]);
  const result = useMemo(() => evaluate(index, chosenOf(applied), withControlScope(ruleOf(applied, viewer), scopeBusy ? NO_FILES : scopeIds)), [index, applied, viewer, scopeIds, scopeBusy]);
  const filtered = result.matches;
  const filtering = isFiltering(filters);
  const matchKey = useMemo(() => `${filtered.length}:${filtered.reduce((h, r) => (h * 31 + r.id) >>> 0, 7)}`, [filtered]);

  const options = useMemo(() => railOptions(rows), [rows]);
  const chosen = chosenOf(filters);
  const groups: FacetGroupView[] = RAIL_ORDER.map((facet) => {
    const picked = chosen[facet] ?? [];
    const opts = orderedOptions(options[facet], picked, (v) => countOf(result.counts, facet, v));
    return {
      key: facet, label: FACET_TITLE[facet], chosen: picked.length, searchable: SEARCHABLE.includes(facet), limit: RAIL_LIMIT[facet], defaultOpen: OPEN_AT_FIRST.includes(facet),
      options: opts.map((o) => ({ value: o.value, label: o.label, title: o.title, count: countOf(result.counts, facet, o.value), checked: picked.includes(o.value) })),
    };
  });
  const toggleFacet = (facet: string, value: string) => {
    const key = facet as FacetKey;
    const cur = filters[key];
    setFilters({ ...filters, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] } as Filters);
  };
  const clearFacet = (facet: string) => setFilters({ ...filters, [facet]: [] } as Filters);

  // ── the quick views, with the number each would show ──
  const quickCounts = useMemo(() => {
    const out: Record<string, number> = {};
    const of = scopeIds ? rows.filter((r) => scopeIds.has(r.id)) : rows;           // the quick views count the control's files when the Library is opened on a control
    QUICK_IDS_COUNTED.forEach((id) => { out[id] = of.reduce((n, r) => n + (inQuick(id, r, viewer) ? 1 : 0), 0); });
    out.all = of.reduce((n, r) => n + (r.status !== 'archived' ? 1 : 0), 0);
    return out;
  }, [rows, viewer, scopeIds]);
  const activeQuick = filters.quick ?? 'all';
  const quickNote = (id: QuickId): string | undefined => {
    if ((id === 'waiting' || id === 'mine') && me == null) return 'Your account could not be read, so only what needs a review is counted here.';
    if (id === 'waiting' && !canCreate) return 'You may not approve evidence, so only your files that were sent back are counted.';
    return undefined;
  };
  const quick: FilterChip[] = QUICK_SHOWN.map((id) => ({
    key: id, label: QUICK_LABEL[id], active: activeQuick === id, count: quickCounts[id] ?? 0, title: quickNote(id),
  }));
  const onQuick = (id: string) => setFilters({ ...filters, quick: id === 'all' || activeQuick === id ? null : (id as QuickId) });
  const moreQuick: MenuItem[] = [{
    key: 'q:mine', label: QUICK_LABEL.mine, checked: activeQuick === 'mine', radio: true, trailing: String(quickCounts.mine ?? 0), section: 'More views', onSelect: () => onQuick('mine'),
  }];

  // ── the list: sorted, a page of it ──
  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
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

  // ── actions ──
  const actions = useLibraryActions(rows, { canReview: canCreate, canEdit, canDelete }, (id) => { if (openId === id) setOpenId(null); });
  const [previewFile, setPreviewFile] = useState<EvidenceFile | null>(null);
  const openRecord = (id: number) => router.push(`/evidence/${id}`);
  const openFile = (row: LibraryRow) => {
    if (row.has_file) setPreviewFile({ evidence_id: row.id, file_name: row.file_name || row.name, mime_type: row.file_type ?? null, file_size: null });
    else openRecord(row.id);
  };
  const env: RowEnv = {
    now, onPeek: setOpenId, onRecord: openRecord, canReview: canCreate, canEdit, canDelete,
    onSubmit: actions.submit, onApprove: actions.approve, onRenew: actions.renew, onDelete: actions.remove, onPackage: (id) => actions.addToPackage([id]),
  };
  const columns = useMemo(() => libraryColumns(env), [env.now, env.canReview, env.canEdit, env.canDelete]);   // eslint-disable-line react-hooks/exhaustive-deps

  const items: RecordItem<LibraryRow>[] = useMemo(() => pageRows.map((record) => ({ kind: 'row' as const, id: record.id, record, depth: 0 })), [pageRows]);
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

  // ── export ──
  const exportRows = (list: readonly LibraryRow[], selectionOnly: boolean) => {
    download(libraryCsv(list, now), exportName(new Date().toISOString().slice(0, 10), list.length, selectionOnly), 'text/csv;charset=utf-8');
  };

  // ── what the page says ──
  const noun = { one: 'file', other: 'files' };
  const chips = filterChips(filters, options);
  const nothing = rows.length === 0;
  const pool = filters.status.includes('archived') ? rows.length : rows.length - archivedCount;             // what the filters are applied to: the archived files only join when Archived is chosen
  const sortItems: MenuItem[] = SORT_KEYS.map((k, i) => ({
    key: `sort:${k}`, label: SORT_LABEL[k], checked: sort.key === k, radio: true, section: i === 0 ? 'Sort by' : undefined,
    trailing: sort.key === k ? (sort.dir === 'asc' ? '↑ ascending' : '↓ descending') : undefined, onSelect: () => setSort(nextSort(sort, k as SortKey)),
  }));
  const bulkDefs: BulkActionDef[] = [
    { id: 'submit', label: 'Submit for review', icon: Send, onRun: () => { void actions.bulk('submit', tickedRows); } },
    ...(canCreate ? [{ id: 'approve', label: 'Approve', icon: ThumbsUp, onRun: () => { void actions.bulk('approve', tickedRows); } }] : []),
    ...(canCreate ? [{ id: 'package', label: 'Add to audit package', icon: FolderPlus, onRun: () => { void actions.bulk('package', tickedRows); } }] : []),
    { id: 'export', label: 'Export selection', icon: Download, onRun: () => exportRows(tickedRows, true) },
  ];
  const bulkMore: MenuItem[] = [{ key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canDelete, onSelect: () => { void actions.bulk('delete', tickedRows); } }];
  const selectionApi = view === 'list' ? {
    ticked: selection.selected,
    onToggle: (id: number) => selection.set((s) => toggleOne(s, id)),
    state: tickState(selection.selected, pageIds),
    onToggleAll: () => selection.set((s) => toggleAll(s, pageIds)),
    headLabel: 'Select all files on this page',
    rowLabel: (r: LibraryRow) => `Select ${truncate(r.name, 60).text}`,
  } : undefined;

  const showAll = (column: string) => {
    if (column === 'lapsed') setFilters({ ...filters, status: [], freshness: ['lapsed'] });
    else setFilters({ ...filters, status: [column] });
    setAddress({ view: 'list' });
  };

  const body = (() => {
    if (noList) return <ErrorState {...failureWords(libQ.error)} onRetry={canRetry(libQ.error) ? () => { void libQ.refetch(); } : undefined} />;
    if (scopeFailed) return <ErrorState title="Couldn't load the evidence for this control" message={errorMessage(scopeQ.error)} onRetry={canRetry(scopeQ.error) ? () => { void scopeQ.refetch(); } : undefined} />;
    if (loading) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={10} columns={5} label="Loading the evidence" /></div>;
    if (nothing) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState
            kind="firstUse" bare icon={FileText} title="No evidence yet" description={canCreate ? 'Upload a file to start your evidence library.' : 'No evidence has been uploaded yet.'}
            action={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={onUploadClick}>Upload evidence</Button> : undefined}
          />
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState
            kind="noMatches" bare title={scopeIds && !filtering ? 'No evidence is linked to this control' : 'No evidence matches'}
            description={scopeIds && !filtering ? 'Upload evidence, then link it to the control from the file.' : 'Loosen a filter, or search for other words.'}
            onClearFilters={filtering ? () => setFilters(NO_FILTERS) : undefined}
          />
        </div>
      );
    }
    if (view === 'board') {
      return (
        <div className="relative overflow-clip rounded-ds-card border border-ds-border bg-ds-surface">
          <BoardColumns
            label="Evidence by status"
            columns={boardOf(sorted, now)}
            getId={(r: LibraryRow) => r.id}
            activeId={openId}
            cardLabel={(r: LibraryRow) => r.name}
            onOpen={(r: LibraryRow) => setOpenId(r.id)}
            onShowAll={showAll}
            renderCard={(r: LibraryRow) => <BoardCard row={r} now={now} />}
          />
        </div>
      );
    }
    return (
      <>
        <RecordTable
          caption="Evidence"
          columns={columns}
          items={items}
          sort={{ key: sort.key, dir: sort.dir }}
          onSort={(key) => setSort(nextSort(sort, key as SortKey))}
          selection={selectionApi}
          activeId={openId}
          cursorId={cursor}
          onActivate={(r) => setOpenId(r.id)}
          actions={(r) => <RowMenu row={r} env={env} />}
          card={(row) => <LibraryCard row={row} env={env} />}
        />
        <Pager className="mt-[8px]" page={pageClamped} pageSize={pageSize} total={sorted.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={noun} />
      </>
    );
  })();

  // "286 files · 12 archived": the files the list shows, and the ones it keeps out until Archived is chosen (the server's true total, less the archived ones it was sent)
  const live = (total ?? rows.length) - archivedCount;
  const meta = noList || loading ? undefined : `${formatCount(live)} ${live === 1 ? 'file' : 'files'}${archivedCount ? ` · ${formatCount(archivedCount)} archived` : ''}${cut ? ` (showing ${formatCount(rows.length)})` : ''}`;

  return (
    <>
      <RecordExplorer
        label="Evidence library"
        noun={noun}
        head={(fit) => head(fit, meta)}
        notices={(
          <>
            {libQ.isError && !noList && (
              <ErrorState compact title="Couldn't refresh the evidence" message={`${errorMessage(libQ.error)} What is shown may be out of date.`} onRetry={canRetry(libQ.error) ? () => { void libQ.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
            )}
            {scopeSaid && (
              <Notice tone={scopeSaid.found ? 'info' : 'warning'} title={scopeSaid.title} action={<Button variant="ghost" onClick={() => setAddress(NO_SCOPE)}>Show all evidence</Button>}>{scopeSaid.message}</Notice>
            )}
            {cut && <Notice tone="info" title="Only part of the library is loaded">The newest {formatCount(rows.length)} of {formatCount(total ?? rows.length)} files are shown. Filter to narrow it down.</Notice>}
            {missingOpen && (
              <Notice tone="warning" title="That file is not in the library" action={<Button variant="ghost" onClick={() => setOpenId(null)}>Dismiss</Button>}>
                It may have been deleted, or it is archived (choose Archived under Status to see those).
              </Notice>
            )}
          </>
        )}
        quick={noList || loading ? [] : quick}
        onQuick={onQuick}
        quickLabel="Quick views"
        quickExtra={noList || loading ? undefined : <Menu label="More views" items={moreQuick} />}
        search={filters.search}
        onSearch={(q) => setFilters({ ...filters, search: q })}
        searchLabel="Search evidence by name, file, type, owner or framework"
        searchRef={searchRef}
        views={{ label: 'Library view', name: 'evidence-library-view', options: [{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }], value: view, onChange: (v) => setAddress({ view: v as 'list' | 'board' }) }}
        actions={(fit) => (
          <>
            {view === 'list' && <Menu label="Sort" items={sortItems} />}
            <Button leftIcon={<Download aria-hidden />} onClick={() => exportRows(sorted, false)} disabled={filtered.length === 0 || loading} title={`Export the ${formatCount(filtered.length)} files shown as a spreadsheet`}>
              <span className={fit.tight ? 'sr-only' : undefined}>Export</span>
            </Button>
          </>
        )}
        groups={groups}
        onToggle={toggleFacet}
        onClear={clearFacet}
        onClearAll={() => setFilters(NO_FILTERS)}
        filtering={filterCount(filters)}
        shown={filtered.length}
        applied={loading || noList ? null : (
          <AppliedFilters
            chips={chips.map((c) => ({ key: c.key, label: c.label }))}
            summary={`${formatCount(filtered.length)} of ${formatCount(pool)} ${pool === 1 ? 'file' : 'files'}`}
            onRemove={(key) => { const chip = chips.find((c) => c.key === key); if (chip) setFilters(removeChip(filters, chip)); }}
            onClear={() => setFilters(NO_FILTERS)}
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
            actions={bulkDefs}
            more={bulkMore}
          />
        ) : undefined}
        detail={(
          <LibraryDrawer
            row={openRow}
            now={now}
            actions={actions}
            canReview={canCreate}
            canEdit={canEdit}
            canDelete={canDelete}
            onClose={() => setOpenId(null)}
            onOpenFile={openFile}
            onOpenRecord={openRecord}
            onStep={(dir) => { const next = sorted[openAt + dir]; if (next) setOpenId(next.id); }}
            hasPrev={openAt > 0}
            hasNext={openAt >= 0 && openAt < sorted.length - 1}
          />
        )}
        ready={!loading && !noList}
      />
      <EvidenceViewer evidence={previewFile} onClose={() => setPreviewFile(null)} />
      {actions.ui}
    </>
  );
}
