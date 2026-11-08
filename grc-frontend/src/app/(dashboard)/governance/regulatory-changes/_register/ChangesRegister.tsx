'use client';

/**
 * Regulatory Changes > Changes: the Facet explorer. This file is the CONFIGURATION of components/records (RecordExplorer) for the circulars the organisation is working through: it owns the data
 * (one request for every change with the server's true total, the people), the page's state (filters, order, view and the change open live in the ADDRESS on the kit's useAddressState, so a
 * link opens the same view; the Overview's counters land here that way), the delete and what each part draws. What a filter MEANS is changeFacets.ts (held to the plain filter by a test).
 * The old list read the newest 100 and put the dashboard's total over them; this reads all of them and says when the server holds more. Delete asks first, naming what goes with the change.
 */
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileWarning, PenLine, Upload } from 'lucide-react';
import { Button, EmptyState, ErrorState, Menu, Notice, Pager, SkeletonRows, useAddressState, useConfirm, useReportedMutation, type FilterChip, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { AppliedFilters } from '@/components/records/AppliedFilters';
import { BoardColumns } from '@/components/records/BoardColumns';
import { BulkBar, type BulkActionDef } from '@/components/records/BulkBar';
import { RecordExplorer } from '@/components/records/RecordExplorer';
import { RecordTable, type RecordItem } from '@/components/records/RecordTable';
import { countOf, evaluate } from '@/components/records/facetEngine';
import { groupBoard, moveCursor, selectAllMatching, tickState, toggleAll, toggleOne } from '@/components/records/explorerModel';
import type { FacetGroupView } from '@/components/records/FacetRail';
import { useExplorerKeys } from '@/components/records/useExplorerKeys';
import { useSelection } from '@/components/records/useSelection';
import { regulatoryApi } from '@/lib/api';
import { formatCount, truncate } from '@/lib/format';
import { CHANGE_REFRESH, useChanges, useMeId, usePeople } from '../_lib/data';
import { BUCKETS, BUCKET_LABEL, bucketOf } from '../_lib/regulatoryModel';
import type { ChangeRow } from '../_lib/types';
import { changeHref } from '../_overview/overviewModel';
import { ChangeDrawer } from './ChangeDrawer';
import { REGISTER_SCHEMA, addedPatch, filtersPatch, openPatch, pageOf, type AddMode, type RegisterAddress, type RegisterView } from './changeAddress';
import { ChangeCard, Needs, RowMenu, changeColumns, type RowEnv } from './changeRows';
import {
  FACET_TITLE, NO_FILTERS, OPEN_AT_FIRST, QUICK_IDS, QUICK_LABEL, RAIL_ORDER, SEARCHABLE, SORT_KEYS, SORT_LABEL, chosenOf, exportName, filterChips, filterCount, indexChanges, inQuick,
  nextSort, orderedOptions, railOptions, removeChip, ruleOf, sortChanges, toCsv, type FacetKey, type Filters, type QuickId, type SortKey,
} from './changeFacets';
import { EffectiveCell, OwnerCell } from '../_parts/shared';

const PAGE_SIZES = [25, 50, 100, 250] as const;
const QUICK_SHOWN: QuickId[] = ['all', 'open', 'mine', 'soon', 'late', 'reading'];

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

export function ChangesRegister({ canCreate, canDelete, onAdd }: { canCreate: boolean; canDelete: boolean; onAdd: (mode: AddMode) => void }) {
  const router = useRouter();
  const uid = useId();
  const { confirm, confirmDialog } = useConfirm();
  const me = useMeId();

  // ── the page's state: in the address ──
  const [address, setAddress] = useAddressState(REGISTER_SCHEMA);
  const page = useMemo(() => pageOf(address as RegisterAddress), [address]);
  const { filters, sort, view, openId, add } = page;
  const setFilters = useCallback((next: Filters) => setAddress(filtersPatch(next)), [setAddress]);
  const setSort = useCallback((next: typeof sort) => setAddress({ sort: next }), [setAddress]);
  const setOpenId = useCallback((id: number | null) => setAddress(openPatch(id)), [setAddress]);
  const setView = useCallback((next: RegisterView) => setAddress({ view: next }), [setAddress]);

  // ── the data ──
  const changes = useChanges();
  const peopleQ = usePeople();
  const rows = changes.rows;
  const noList = changes.isError && !changes.data;               // the list could not be read at all: never drawn as an empty register
  const loading = changes.isPending;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const today = useMemo(() => new Date(), [changes.data]);
  const ctx = useMemo(() => ({ me, today }), [me, today]);

  // links that ask for the upload panel (?add=circular): acted on once, then taken out of the address
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !add) return;
    arrived.current = true;
    onAdd(add);
    setAddress(addedPatch());
  }, [add, onAdd, setAddress]);

  // ── the facets: one index of the changes, one pass for the matches and every live count ──
  const index = useMemo(() => indexChanges(rows, ctx), [rows, ctx]);
  const searched = useDeferredValue(filters.search);
  const applied = useMemo(() => (searched === filters.search ? filters : { ...filters, search: searched }), [filters, searched]);
  const result = useMemo(() => evaluate(index, chosenOf(applied), ruleOf(applied, ctx)), [index, applied, ctx]);
  const filtered = result.matches;
  const filtering = filterCount(filters) > 0;
  const matchKey = useMemo(() => `${filtered.length}:${filtered.reduce((h, r) => (h * 31 + r.id) >>> 0, 7)}`, [filtered]);

  const options = useMemo(() => railOptions({ rows, people: peopleQ.users }), [rows, peopleQ.users]);
  const chosen = chosenOf(filters);
  const groups: FacetGroupView[] = RAIL_ORDER.map((facet) => {
    const picked = chosen[facet] ?? [];
    const opts = orderedOptions(options[facet], picked, (v) => countOf(result.counts, facet, v));
    return {
      key: facet, label: FACET_TITLE[facet], chosen: picked.length, searchable: SEARCHABLE.includes(facet), limit: facet === 'owner' || facet === 'regulator' ? 7 : undefined, defaultOpen: OPEN_AT_FIRST.includes(facet),
      options: opts.map((o) => ({ value: o.value, label: o.label, count: countOf(result.counts, facet, o.value), checked: picked.includes(o.value) })),
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
    QUICK_IDS.forEach((id) => { out[id] = rows.reduce((n, r) => n + (inQuick(id, r, ctx) ? 1 : 0), 0); });
    return out;
  }, [rows, ctx]);
  const activeQuick = filters.quick ?? 'all';
  const quick: FilterChip[] = QUICK_SHOWN.map((id) => ({
    key: id, label: QUICK_LABEL[id], active: activeQuick === id, count: quickCounts[id] ?? 0,
    title: id === 'mine' && me == null ? 'Your account could not be read, so "Assigned to me" is empty.' : undefined,
    flag: id === 'mine' && me == null ? { label: 'Incomplete', tone: 'warning' as const } : undefined,
  }));
  const onQuick = (id: string) => setFilters({ ...filters, quick: id === 'all' || activeQuick === id ? null : (id as QuickId) });

  // ── the list: sorted, a page of it ──
  const sorted = useMemo(() => sortChanges(filtered, sort), [filtered, sort]);
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

  const remove = useReportedMutation({
    mutationFn: (id: number) => regulatoryApi.deleteChange(id),
    success: { title: 'Change deleted', message: 'Its obligations, assessments and tasks went with it.' },
    failure: "Couldn't delete the change",
    invalidate: CHANGE_REFRESH.map((k) => [...k]),
    onSuccess: (_, id) => { if (openId === id) setOpenId(null); },
  });
  const askDelete = async (row: ChangeRow) => {
    const yes = await confirm({
      title: `Delete “${truncate(row.title, 80).text}”?`,
      message: 'This removes the change with its obligations and their control links, its impact assessments and its tasks (the copies in Task Management too). It cannot be undone.',
      confirmLabel: 'Delete change',
      tone: 'danger',
    });
    if (yes) remove.mutate(row.id);
  };

  // ── rows, handlers ──
  const hrefOf = (id: number) => changeHref(id);
  const env: RowEnv = { today, compact: false, hrefOf, onPeek: setOpenId, onOpen: (id) => router.push(hrefOf(id)), canDelete, onDelete: (r) => { void askDelete(r); } };
  const columns = useMemo(() => changeColumns(env), [env.today, env.canDelete]);   // eslint-disable-line react-hooks/exhaustive-deps

  const items: RecordItem<ChangeRow>[] = useMemo(() => pageRows.map((record) => ({ kind: 'row' as const, id: record.id, record, depth: 0 })), [pageRows]);
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

  const exportRows = (list: readonly ChangeRow[]) => download(toCsv(list), exportName(new Date().toISOString().slice(0, 10), list.length), 'text/csv;charset=utf-8');

  // ── what the page says ──
  const label = 'Regulatory Changes';
  const noun = { one: 'change', other: 'changes' };
  const chips = filterChips(filters, options);
  const sortItems: MenuItem[] = SORT_KEYS.map((k, i) => ({
    key: `sort:${k}`, label: SORT_LABEL[k], checked: sort.key === k, radio: true, section: i === 0 ? 'Sort by' : undefined,
    trailing: sort.key === k ? (sort.dir === 'asc' ? '↑ ascending' : '↓ descending') : undefined, onSelect: () => setSort(nextSort(sort, k as SortKey)),
  }));
  const bulkDefs: BulkActionDef[] = [{ id: 'export', label: 'Export selection', icon: Download, onRun: () => exportRows(rows.filter((r) => ticked.includes(r.id))) }];
  const selectionApi = view === 'list' ? {
    ticked: selection.selected,
    onToggle: (id: number) => selection.set((s) => toggleOne(s, id)),
    state: tickState(selection.selected, pageIds),
    onToggleAll: () => selection.set((s) => toggleAll(s, pageIds)),
    headLabel: 'Select all changes on this page',
    rowLabel: (r: ChangeRow) => `Select ${truncate(r.title, 60).text}`,
  } : undefined;

  const body = (() => {
    if (noList) return <ErrorState title="Couldn't load the changes" message={errorMessage(changes.error)} onRetry={canRetry(changes.error) ? () => { void changes.refetch(); } : undefined} />;
    if (loading) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={10} columns={5} label="Loading the changes" /></div>;
    if (rows.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState
            kind="firstUse" bare icon={FileWarning} title="No regulatory changes yet"
            description="Upload a circular and the AI reads it, or record a change by hand."
            action={canCreate ? (
              <span className="flex flex-wrap justify-center gap-[8px]">
                <Button variant="primary" leftIcon={<Upload aria-hidden />} onClick={() => onAdd('circular')}>Upload your first circular</Button>
                <Button leftIcon={<PenLine aria-hidden />} onClick={() => onAdd('manual')}>Add manually</Button>
              </span>
            ) : undefined}
          />
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="noMatches" bare title="No change matches" description="Loosen a filter, or search for other words." onClearFilters={filtering ? () => setFilters(NO_FILTERS) : undefined} />
        </div>
      );
    }
    if (view === 'board') {
      const board = groupBoard(sorted, BUCKETS.map((b) => ({ id: b, label: BUCKET_LABEL[b], test: (r: ChangeRow) => bucketOf(r.status) === b })));
      return (
        <div className="relative overflow-clip rounded-ds-card border border-ds-border bg-ds-surface">
          <BoardColumns
            label="Changes by status"
            columns={board}
            getId={(r: ChangeRow) => r.id}
            activeId={openId}
            cardLabel={(r: ChangeRow) => r.title}
            onOpen={(r: ChangeRow) => setOpenId(r.id)}
            onShowAll={(column) => { setFilters({ ...filters, status: [column] }); setView('list'); }}
            renderCard={(r: ChangeRow) => (
              <>
                <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.title}</span>
                <Needs change={r} limit={2} />
                <span className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]"><EffectiveCell change={r} today={today} /><span className="ml-auto"><OwnerCell change={r} withName={false} /></span></span>
              </>
            )}
          />
        </div>
      );
    }
    return (
      <>
        <RecordTable
          caption="Regulatory changes"
          columns={columns}
          items={items}
          sort={{ key: sort.key, dir: sort.dir }}
          onSort={(key) => setSort(nextSort(sort, key as SortKey))}
          selection={selectionApi}
          activeId={openId}
          cursorId={cursor}
          onActivate={(r) => setOpenId(r.id)}
          actions={(r) => <RowMenu row={r} env={env} />}
          card={(row) => <ChangeCard row={row} env={env} />}
        />
        <Pager className="mt-[8px]" page={pageClamped} pageSize={pageSize} total={sorted.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={noun} />
      </>
    );
  })();

  const viewOptions = [{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }];
  return (
    <>
      <RecordExplorer
        label={label}
        noun={noun}
        head={null}
        notices={(
          <>
            {changes.isError && !noList && (
              <ErrorState compact title="Couldn't refresh the changes" message={`${errorMessage(changes.error)} What is shown may be out of date.`} onRetry={canRetry(changes.error) ? () => { void changes.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
            )}
            {changes.cut && <Notice tone="info" title="Only part of the register is loaded">The newest {formatCount(rows.length)} of {formatCount(changes.total)} changes are shown. Filter to narrow it down.</Notice>}
            {missingOpen && (
              <Notice tone="warning" title="That change is not in the register" action={<Button variant="ghost" onClick={() => setOpenId(null)}>Dismiss</Button>}>
                It may have been deleted, or you may not be allowed to see it.
              </Notice>
            )}
          </>
        )}
        quick={noList || loading ? [] : quick}
        onQuick={onQuick}
        quickLabel="Quick views"
        search={filters.search}
        onSearch={(q) => setFilters({ ...filters, search: q })}
        searchLabel="Search changes by title, reference, regulator or owner"
        searchRef={searchRef}
        views={{ label: 'Register view', name: `${uid}-view`, options: viewOptions, value: view, onChange: (v) => setView(v as RegisterView) }}
        actions={(fit) => (
          <>
            {view === 'list' && <Menu label="Sort" items={sortItems} />}
            <Button leftIcon={<Download aria-hidden />} onClick={() => exportRows(sorted)} disabled={filtered.length === 0 || loading} title={`Export the ${formatCount(filtered.length)} changes shown as a spreadsheet`}>
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
            summary={`${formatCount(filtered.length)} of ${formatCount(rows.length)} ${rows.length === 1 ? 'change' : 'changes'}`}
            onRemove={(key) => { const chip = chips.find((c) => c.key === key); if (chip) setFilters(removeChip(filters, chip)); }}
            onClear={() => setFilters(NO_FILTERS)}
          />
        )}
        body={body}
        bulk={view === 'list' && !loading && ticked.length > 0 ? (fit) => (
          <BulkBar iconsOnly={fit.compact} count={ticked.length} matching={filtered.length} onSelectAll={() => selection.set(selectAllMatching(filtered.map((r) => r.id)))} onClear={selection.clear} actions={bulkDefs} />
        ) : undefined}
        detail={(
          <ChangeDrawer
            row={openRow}
            onClose={() => setOpenId(null)}
            onOpenChange={(id) => router.push(hrefOf(id))}
            onStep={(dir) => { const next = sorted[openAt + dir]; if (next) setOpenId(next.id); }}
            hasPrev={openAt > 0}
            hasNext={openAt >= 0 && openAt < sorted.length - 1}
            canDelete={canDelete}
            onDelete={(r) => { void askDelete(r); }}
          />
        )}
        ready={!loading && !noList}
      />
      {confirmDialog}
    </>
  );
}
