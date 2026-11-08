'use client';

/**
 * The Frameworks hub's two registers on the Facet explorer (components/records): Journeys (a row per journey) and Library (a row per framework of the library, with where its journey or its
 * onboarding stands). This file is the CONFIGURATION of the explorer for both: it takes the rows, owns the page's state (filters, sort, view and the framework whose details are open all live in
 * the ADDRESS, so a link opens the same view), and says what each part draws. What a filter MEANS is hubModel.ts; the facets and their live counts are hubFacets.ts over
 * components/records/facetEngine.ts. A journey opens (its name is a link and a row press goes there); a framework opens its details in the drawer.
 * The old pages showed the first 100 rows, hid the page when a request failed, and had no way to filter, sort or search the library.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Layers, ListChecks } from 'lucide-react';
import { Button, EmptyState, ErrorState, Menu, Notice, Pager, SkeletonRows, type FilterChip, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { AppliedFilters } from '@/components/records/AppliedFilters';
import { BoardColumns } from '@/components/records/BoardColumns';
import { RecordExplorer } from '@/components/records/RecordExplorer';
import { RecordTable, type RecordItem } from '@/components/records/RecordTable';
import { countOf, evaluate } from '@/components/records/facetEngine';
import { moveCursor } from '@/components/records/explorerModel';
import type { FacetGroupView } from '@/components/records/FacetRail';
import { useExplorerKeys } from '@/components/records/useExplorerKeys';
import { OnboardingNeeded } from '@/components/compliance/onboarding/gate/OnboardingNeeded';
import type { AddressState } from '@/lib/addressState';
import { formatCount } from '@/lib/format';
import { HubDrawer } from './HubDrawer';
import { BoardCard, HubCard, RowMenu, hubColumns, type RowEnv } from './HubRows';
import { HUB_SCHEMA, VIEWS, filtersPatch, openPatch, pageOf, sortPatch, tabHref, type HubAddress, type View } from './hubAddress';
import {
  FACET_TITLE, NO_FILTERS, OPEN_AT_FIRST, RAIL, SEARCHABLE, chosenOf, filterChips, filterCount, indexHub, isFiltering, orderedOptions, railOptions, removeChip, ruleOf, type FacetKey, type Filters,
} from './hubFacets';
import {
  QUICK_LABEL, SORTS_OF, SORT_LABEL, boardColumns, nextSort, quickCounts, quickFor, sortRows, type HubRow, type LibraryItem, type QuickId, type Scope, type SortKey,
} from './hubModel';
import type { HubActions } from './useHubActions';

const PAGE_SIZES = [25, 50, 100, 250] as const;
const RAIL_LIMIT: Partial<Record<FacetKey, number>> = { authority: 7, type: 7 };
const NOUN: Record<Scope, { one: string; other: string }> = {
  journeys: { one: 'journey', other: 'journeys' },
  library: { one: 'framework', other: 'frameworks' },
};
const VIEW_OPTIONS = [{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }] as const;

export interface HubFailure { title: string; message: string; onRetry?: () => void }

export interface HubRegisterProps {
  scope: Scope;
  address: AddressState<typeof HUB_SCHEMA>;
  setAddress: (patch: Partial<AddressState<typeof HUB_SCHEMA>>, options?: { push?: boolean }) => void;
  /** the page head: the heading, the strip, and on Journeys the posture tiles */
  head: ReactNode;
  rows: HubRow[];
  /** the library's own records, for the details of a framework */
  items: ReadonlyMap<number, LibraryItem>;
  loading: boolean;
  /** the rows could not be read at all: never drawn as an empty list */
  failure: HubFailure | null;
  /** notices above the explorer: a refresh that failed, a part of the data missing, a cut list */
  notices?: ReactNode;
  libraryKnown: boolean;
  actions: HubActions;
}

export function HubRegister({ scope, address, setAddress, head, rows, items, loading, failure, notices, libraryKnown, actions }: HubRegisterProps) {
  const router = useRouter();

  // ── the page's state: in the address ──
  const page = useMemo(() => pageOf(address as unknown as HubAddress), [address]);
  const { filters, sort, view } = page;
  const openId = scope === 'library' ? page.openId : null;
  const setFilters = useCallback((next: Filters) => setAddress(filtersPatch(next)), [setAddress]);
  const setSort = useCallback((next: typeof sort) => setAddress(sortPatch(scope, next)), [setAddress, scope]);
  const setView = useCallback((next: View) => setAddress({ view: next }), [setAddress]);
  const setOpenId = useCallback((id: number | null) => setAddress(openPatch(id)), [setAddress]);

  // ── the facets: one index of the rows, one pass for the matches and every live count ──
  const index = useMemo(() => indexHub(rows), [rows]);
  const searched = useDeferredValue(filters.search);
  const applied = useMemo(() => (searched === filters.search ? filters : { ...filters, search: searched }), [filters, searched]);
  const result = useMemo(() => evaluate(index, chosenOf(applied, scope), ruleOf(applied)), [index, applied, scope]);
  const filtered = result.matches;
  const filtering = isFiltering(filters, scope);
  const options = useMemo(() => railOptions(rows, scope), [rows, scope]);
  const chosen = chosenOf(filters, scope);
  const groups: FacetGroupView[] = RAIL[scope].map((facet) => {
    const picked = chosen[facet] ?? [];
    const opts = orderedOptions(options[facet], picked, (v) => countOf(result.counts, facet, v));
    return {
      key: facet, label: FACET_TITLE[facet], chosen: picked.length, searchable: SEARCHABLE.includes(facet), limit: RAIL_LIMIT[facet], defaultOpen: OPEN_AT_FIRST[scope].includes(facet),
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
  const counts = useMemo(() => quickCounts(rows, scope), [rows, scope]);
  const activeQuick = filters.quick ?? 'all';
  const quick: FilterChip[] = quickFor(scope).map((id) => ({ key: id, label: QUICK_LABEL[id], active: activeQuick === id, count: counts[id] ?? 0 }));
  const onQuick = (id: string) => setFilters({ ...filters, quick: id === 'all' || activeQuick === id ? null : (id as QuickId) });

  // ── the list: sorted, a page of it ──
  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const viewKey = `${scope}|${filtered.length}:${filtered.reduce((h, r) => (h * 31 + r.id) >>> 0, 7)}|${sort.key}:${sort.dir}|${pageSize}`;
  const [seen, setSeen] = useState(viewKey);
  if (seen !== viewKey) { setSeen(viewKey); setPageNo(1); }
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageClamped = Math.min(Math.max(1, pageNo), pages);
  const pageRows = useMemo(() => sorted.slice((pageClamped - 1) * pageSize, pageClamped * pageSize), [sorted, pageClamped, pageSize]);

  // ── the cursor and the details ──
  const [cursor, setCursor] = useState<number | null>(null);
  const openRow = openId != null ? rows.find((r) => r.id === openId) ?? null : null;
  const openAt = openRow ? sorted.findIndex((r) => r.id === openRow.id) : -1;
  const missingOpen = scope === 'library' && page.openId != null && !loading && !failure && !openRow;
  const env: RowEnv = useMemo(() => ({
    scope, libraryKnown, actions,
    onOpen: (row) => { if (scope === 'journeys') router.push(`/frameworks/${row.id}`); else setOpenId(row.id); },
    go: (href) => router.push(href),
  }), [scope, libraryKnown, actions, router, setOpenId]);
  const columns = useMemo(() => hubColumns(env), [env]);
  const recordItems: RecordItem<HubRow>[] = useMemo(() => pageRows.map((record) => ({ kind: 'row' as const, id: record.id, record, depth: 0 })), [pageRows]);
  const pageIds = useMemo(() => pageRows.map((r) => r.id), [pageRows]);

  const searchRef = useRef<HTMLInputElement>(null);
  useExplorerKeys({
    onSearch: () => searchRef.current?.focus(),
    onMove: (dir) => setCursor((c) => moveCursor(pageIds, c, dir)),
    onOpen: () => { const row = cursor != null ? rows.find((r) => r.id === cursor) : null; if (row) env.onOpen(row); },
    onEscape: () => undefined,
  }, true);
  useEffect(() => {
    if (cursor != null) document.querySelector(`[data-record-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // ── what the page says ──
  const chips = filterChips(filters, scope, options);
  const sortItems: MenuItem[] = SORTS_OF[scope].map((k, i) => ({
    key: `sort:${k}`, label: SORT_LABEL[k], checked: sort.key === k, radio: true, section: i === 0 ? 'Sort by' : undefined,
    trailing: sort.key === k ? (sort.dir === 'asc' ? '↑ ascending' : '↓ descending') : undefined, onSelect: () => setSort(nextSort(scope, sort, k as SortKey)),
  }));
  const noun = NOUN[scope];
  const showAll = (column: string) => {
    if (scope === 'library' && column === 'running') setFilters({ ...NO_FILTERS, quick: 'running' });
    else setFilters({ ...NO_FILTERS, [scope === 'journeys' ? 'status' : 'state']: [column] } as Filters);
    setView('list');
  };

  const body = (() => {
    if (failure) return <ErrorState title={failure.title} message={failure.message} onRetry={failure.onRetry} />;
    if (loading) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={8} columns={4} label={`Loading the ${noun.other}`} /></div>;
    if (rows.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          {scope === 'journeys' ? (
            <EmptyState
              kind="firstUse" bare icon={ListChecks} title="No journeys yet"
              description="A journey takes a framework from its requirements to certification or compliance. Start one from the library."
              action={<Button variant="primary" href={tabHref('library')}>Choose a framework</Button>}
            />
          ) : (
            <EmptyState kind="firstUse" bare icon={Layers} title="No frameworks in the library" description="The library holds the frameworks you can start a journey for. None is ready yet." />
          )}
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="noMatches" bare title={`No ${noun.other} match`} description="Loosen a filter, or search for other words." onClearFilters={filtering ? () => setFilters(NO_FILTERS) : undefined} />
        </div>
      );
    }
    if (view === 'board') {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <BoardColumns
            label={scope === 'journeys' ? 'Journeys by status' : 'Frameworks by state'}
            columns={boardColumns(scope, sorted)}
            getId={(r: HubRow) => r.id}
            activeId={openId}
            cardLabel={(r: HubRow) => r.name}
            onOpen={(r: HubRow) => env.onOpen(r)}
            onShowAll={showAll}
            renderCard={(r: HubRow) => <BoardCard row={r} />}
          />
        </div>
      );
    }
    return (
      <>
        <RecordTable
          caption={scope === 'journeys' ? 'Framework journeys' : 'Framework library'}
          columns={columns}
          items={recordItems}
          sort={{ key: sort.key, dir: sort.dir }}
          onSort={(key) => setSort(nextSort(scope, sort, key as SortKey))}
          activeId={openId}
          cursorId={cursor}
          onActivate={(r) => env.onOpen(r)}
          actions={(r) => <RowMenu row={r} env={env} />}
          card={(row) => <HubCard row={row} scope={scope} libraryKnown={libraryKnown} />}
        />
        <Pager className="mt-[8px]" page={pageClamped} pageSize={pageSize} total={sorted.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={noun} />
      </>
    );
  })();

  const refusalOnPage = actions.refusal && !openRow ? actions.refusal : null;
  return (
    <RecordExplorer
      label={scope === 'journeys' ? 'Framework journeys' : 'Framework library'}
      noun={noun}
      head={head}
      notices={(
        <>
          {notices}
          {refusalOnPage && (
            <OnboardingNeeded
              frameworkId={refusalOnPage.frameworkId} name={refusalOnPage.name} onboardingId={refusalOnPage.why.onboardingId} state={refusalOnPage.why.state ?? 'not_started'} open={refusalOnPage.why.open}
            />
          )}
          {missingOpen && (
            <Notice tone="warning" title="That framework is not in the library" action={<Button variant="ghost" onClick={() => setOpenId(null)}>Dismiss</Button>}>
              It may have been deleted, or it may not be read yet, so it cannot start a journey.
            </Notice>
          )}
        </>
      )}
      quick={failure || loading ? [] : quick}
      onQuick={onQuick}
      quickLabel="Quick views"
      search={filters.search}
      onSearch={(q) => setFilters({ ...filters, search: q })}
      searchLabel={scope === 'journeys' ? 'Search journeys by name, type, authority or status' : 'Search frameworks by name, type, authority or state'}
      searchRef={searchRef}
      views={{ label: 'View', name: `hub-${scope}-view`, options: VIEW_OPTIONS, value: view, onChange: (v) => setView(VIEWS.find((x) => x === v) ?? 'list') }}
      actions={view === 'board' ? undefined : <Menu label="Sort" items={sortItems} />}
      groups={groups}
      onToggle={toggleFacet}
      onClear={clearFacet}
      onClearAll={() => setFilters(NO_FILTERS)}
      filtering={filterCount(filters, scope)}
      shown={filtered.length}
      applied={loading || failure ? null : (
        <AppliedFilters
          chips={chips.map((c) => ({ key: c.key, label: c.label }))}
          summary={`${formatCount(filtered.length)} of ${formatCount(rows.length)} ${rows.length === 1 ? noun.one : noun.other}`}
          onRemove={(key) => { const chip = chips.find((c) => c.key === key); if (chip) setFilters(removeChip(filters, chip)); }}
          onClear={() => setFilters(NO_FILTERS)}
        />
      )}
      body={body}
      detail={scope === 'library' ? (
        <HubDrawer
          row={openRow}
          item={openRow ? items.get(openRow.id) ?? null : null}
          env={env}
          onClose={() => setOpenId(null)}
          onStep={(dir) => { const next = sorted[openAt + dir]; if (next) setOpenId(next.id); }}
          hasPrev={openAt > 0}
          hasNext={openAt >= 0 && openAt < sorted.length - 1}
        />
      ) : undefined}
      ready={!loading && !failure}
    />
  );
}

/** What a failed request says: a refusal says the person has no access, anything else says it could not be loaded, with the server's words. */
export function failureOf(what: string, error: unknown, retry: () => void): HubFailure {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (status === 403) return { title: `You don't have access to the ${what}`, message: 'Ask an administrator to give you access to Compliance.' };
  return { title: `Couldn't load the ${what}`, message: errorMessage(error), onRetry: canRetry(error) ? retry : undefined };
}
