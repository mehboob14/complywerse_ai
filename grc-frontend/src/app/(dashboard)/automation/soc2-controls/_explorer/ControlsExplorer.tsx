'use client';

/**
 * Controls Automation > Controls: the Facet explorer. This file is the Controls CONFIGURATION of components/records (RecordExplorer): it owns the data (one complete request for the controls of the
 * scope, the default scope, the people), the page's state (filters, sort, view and scope live in the ADDRESS on the kit's useAddressState, so a link opens the same view), the mutations and what
 * each part draws. What a filter MEANS is controlsModel.ts; the facets and their live counts are controlsFacets.ts over components/records/facetEngine.ts (held to the plain filter by a test).
 *
 * The list loads ONCE, whole: every count, facet number and the export are over all the controls the server sent (it sends them all). Bulk assignment says how many controls the SERVER changed
 * and only reaches what still matches the filters. A button the server would refuse (assign needs controls:controls:assign, scope needs compliance:frameworks, refresh needs compliance:scan:execute,
 * a new control needs controls:control_library:create) is shown disabled with the reason; nothing here changes who may do what. The old links keep working: ?configure=scope and ?source=custom|scf.
 */
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Crosshair, Download, Layers, Plus, RefreshCw, Settings2, UserPlus } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, ErrorState, Menu, Notice, Pager, SegmentedControl, Sheet, SkeletonRows, StatusPill, useAddressState, useReportedMutation, type FilterChip, type MenuItem,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { AppliedFilters } from '@/components/records/AppliedFilters';
import { BoardColumns } from '@/components/records/BoardColumns';
import { BulkBar, type BulkActionDef } from '@/components/records/BulkBar';
import { RecordExplorer } from '@/components/records/RecordExplorer';
import type { ExplorerFit } from '@/components/records/explorerFit';
import { RecordTable, type RecordItem } from '@/components/records/RecordTable';
import { countOf, evaluate } from '@/components/records/facetEngine';
import { groupBoard, moveCursor, selectAllMatching, tickState, toggleAll, toggleOne } from '@/components/records/explorerModel';
import type { FacetGroupView } from '@/components/records/FacetRail';
import { useExplorerKeys } from '@/components/records/useExplorerKeys';
import { useSelection } from '@/components/records/useSelection';
import ModuleSettingsPanel from '@/components/settings/ModuleSettingsPanel';
import { ScopeDialog } from '@/components/soc2/ScopeDialog';
import { automationApi, scfApi } from '@/lib/api';
import { formatCount, truncate } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { statusPill } from '@/lib/status';
import { controlStatus } from '@/lib/statuses/controls';
import { AssignOwnerSheet } from './AssignOwnerSheet';
import { ByDomainView } from './ByDomainView';
import { ControlCard, RowMenu, controlColumns, hrefOf, type RowEnv } from './ControlRows';
import { ControlsStrip } from './ControlsStrip';
import { EXPLORER_SCHEMA, arrivedPatch, filtersPatch, pageOf, type ExplorerAddress, type ExplorerView } from './controlsAddress';
import { useControls, useDefaultScope, useMeId, useTenantUsers } from './controlsData';
import { useRights } from './controlsRights';
import {
  FACET_TITLE, NO_FILTERS, OPEN_AT_FIRST, RAIL_ORDER, SEARCHABLE, chosenOf, filterChips, filterCount, indexControls, isFiltering, orderedOptions, railOptions, removeChip, ruleOf,
  type FacetKey, type Filters,
} from './controlsFacets';
import {
  BOARD_COLUMNS, QUICK_HINT, QUICK_IDS, QUICK_LABEL, SORT_KEYS, SORT_LABEL, columnOf, exportName, nextSort, quickCounts, sortControls, toCsv, withIds, wordsOf, type QuickId, type Row, type SortKey,
} from './controlsModel';

const PAGE_SIZES = [25, 50, 100, 250] as const;
const RAIL_LIMIT: Partial<Record<FacetKey, number>> = { framework: 7, domain: 7, owner: 7 };
const REFRESH_KEYS: ReadonlyArray<readonly unknown[]> = [['automation-common'], ['common-overview'], ['scf-my-work']];

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

export function ControlsExplorer() {
  const router = useRouter();
  const qc = useQueryClient();
  const uid = useId();
  const { can } = useRights();                                         // the rights as the server reads them: see controlsRightsModel.ts
  const canCreate = can('createControl');
  const canScope = can('frameworks');
  const canAssign = can('assign');
  const canRefresh = can('scan');

  // ── the page's state: in the address ──
  const [address, setAddress] = useAddressState(EXPLORER_SCHEMA);
  const page = useMemo(() => pageOf(address as ExplorerAddress), [address]);
  const { filters, sort, view, scope, arrive } = page;
  const setFilters = useCallback((next: Filters) => setAddress(filtersPatch(next)), [setAddress]);
  const setSort = useCallback((next: typeof sort) => setAddress({ sort: next }), [setAddress]);
  const setView = useCallback((next: ExplorerView) => setAddress({ view: next }), [setAddress]);

  // ── the data ──
  const listQ = useControls(scope);
  const scopeQ = useDefaultScope();
  const usersQ = useTenantUsers();
  const me = useMeId();
  const data = listQ.data;
  const rows: Row[] = useMemo(() => withIds(data?.controls ?? []), [data]);
  const noList = listQ.isError && !data;                              // the list could not be read at all: never drawn as an empty list
  const loading = listQ.isPending;
  const unconfigured = scope === 'in_scope' && data?.scope_status === 'unconfigured';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [listQ.data]);
  const ctx = useMemo(() => ({ me, now }), [me, now]);
  const frameworkNames = useMemo(() => {
    const m: Record<string, string> = {};
    (data?.frameworks ?? []).forEach((f) => { m[f.key] = f.label; });
    (data?.scope?.frameworks ?? []).forEach((f) => { m[f.key] = f.label; });
    return m;
  }, [data]);

  // ── the facets: one index of the controls, one pass for the matches and every live count ──
  const index = useMemo(() => indexControls(rows), [rows]);
  const searched = useDeferredValue(filters.search);
  const applied = useMemo(() => (searched === filters.search ? filters : { ...filters, search: searched }), [filters, searched]);
  const result = useMemo(() => evaluate(index, chosenOf(applied), ruleOf(applied, ctx)), [index, applied, ctx]);
  const filtered = result.matches;
  const filtering = isFiltering(filters);
  const matchKey = useMemo(() => `${filtered.length}:${filtered.reduce((h, r) => (h * 31 + r.i) >>> 0, 7)}`, [filtered]);

  const options = useMemo(() => railOptions({ rows, frameworks: frameworkNames }), [rows, frameworkNames]);
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
  const counts = useMemo(() => quickCounts(rows, ctx), [rows, ctx]);
  const activeQuick = filters.quick ?? 'all';
  const quick: FilterChip[] = QUICK_IDS.map((id) => ({
    key: id, label: QUICK_LABEL[id], active: activeQuick === id, count: counts[id], title: id === 'mine' && me == null ? 'Your account could not be read, so “Mine” is empty.' : QUICK_HINT[id],
    flag: id === 'mine' && me == null ? { label: 'Incomplete', tone: 'warning' as const } : undefined,
  }));
  const onQuick = (id: string) => setFilters({ ...filters, quick: id === 'all' || activeQuick === id ? null : (id as QuickId) });

  // ── the list: sorted, a page of it ──
  const sorted = useMemo(() => sortControls(filtered, sort), [filtered, sort]);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const viewKey = `${matchKey}|${sort.key}:${sort.dir}|${pageSize}`;
  const [seen, setSeen] = useState(viewKey);
  if (seen !== viewKey) { setSeen(viewKey); setPageNo(1); }
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageClamped = Math.min(Math.max(1, pageNo), pages);
  const pageRows = useMemo(() => sorted.slice((pageClamped - 1) * pageSize, pageClamped * pageSize), [sorted, pageClamped, pageSize]);

  // ── ticks and the cursor ──
  const selection = useSelection(matchKey);
  const [cursor, setCursor] = useState<number | null>(null);
  const ticked = useMemo(() => {
    const matching = new Set(filtered.map((r) => r.i));
    return Array.from(selection.selected).filter((id) => matching.has(id));
  }, [selection.selected, filtered]);

  // ── scope dialog, settings, bulk owner ──
  const [scopeOpen, setScopeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !arrive.configureScope) return;
    arrived.current = true;
    setScopeOpen(true);
    setAddress(arrivedPatch());
  }, [arrive.configureScope, setAddress]);

  const assign = useReportedMutation({
    mutationFn: async (v: { ids: string[]; owner: number }) => {
      const scopeId = scopeQ.data?.id;
      if (!scopeId) throw new Error('The scope of your controls could not be read.');
      return (await scfApi.bulkOwnership(scopeId, { scf_ids: v.ids, owner_user_id: v.owner })).data as { count: number };
    },
    success: (res) => ({ title: 'Owner assigned', message: `${formatCount(res.count)} ${res.count === 1 ? 'control has' : 'controls have'} a new owner.` }),
    failure: "Couldn't assign the owner",
    invalidate: REFRESH_KEYS,
    onSuccess: () => { selection.clear(); setAssignOpen(false); },
  });
  const refreshChecks = useReportedMutation({
    mutationFn: () => automationApi.seed(),
    success: { title: 'Checks refreshed', message: 'The catalogue of automated checks is up to date.' },
    failure: "Couldn't refresh the checks",
    invalidate: [['automation-common'], ['common-overview'], ['soc2-catalog']],
  });

  // ── rows, handlers ──
  const openControl = useCallback((code: string, tab?: string) => router.push(tab ? `${hrefOf(code)}?tab=${tab}` : hrefOf(code)), [router]);
  const env: RowEnv = { now, compact: false, frameworkName: (k) => frameworkNames[k] || k, onOpen: openControl };
  const columns = useMemo(() => controlColumns(env), [env.now, frameworkNames, openControl]);   // eslint-disable-line react-hooks/exhaustive-deps
  const items: RecordItem<Row>[] = useMemo(() => pageRows.map((record) => ({ kind: 'row' as const, id: record.i, record, depth: 0 })), [pageRows]);
  const pageIds = useMemo(() => pageRows.map((r) => r.i), [pageRows]);

  const searchRef = useRef<HTMLInputElement>(null);
  useExplorerKeys({
    onSearch: () => searchRef.current?.focus(),
    onMove: (dir) => setCursor((c) => moveCursor(pageIds, c, dir)),
    onOpen: () => { const r = cursor != null ? rows[cursor] : null; if (r) openControl(r.control_id); },
    onEscape: () => { if (selection.selected.size > 0) selection.clear(); },
  }, view === 'list');
  useEffect(() => {
    if (cursor != null) document.querySelector(`[data-record-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // ── export ──
  const exportRows = (list: readonly Row[], selectionOnly: boolean) => {
    download(toCsv(list, { framework: (k) => frameworkNames[k] || k }), exportName(new Date().toISOString().slice(0, 10), list.length, selectionOnly), 'text/csv;charset=utf-8');
  };

  // ── what the page says ──
  const label = routeFor('/automation/soc2-controls')?.label ?? 'Controls';
  const noun = { one: 'control', other: 'controls' };
  const chips = filterChips(filters, options);
  const nothing = rows.length === 0;
  const sortItems: MenuItem[] = SORT_KEYS.map((k, i) => ({
    key: `sort:${k}`, label: SORT_LABEL[k], checked: sort.key === k, radio: true, section: i === 0 ? 'Sort by' : undefined,
    trailing: sort.key === k ? (sort.dir === 'asc' ? '↑ ascending' : '↓ descending') : undefined, onSelect: () => setSort(nextSort(sort, k as SortKey)),
  }));
  const bulkDefs: BulkActionDef[] = [
    {
      id: 'assign', label: 'Assign owner', icon: UserPlus, onRun: () => setAssignOpen(true),
      ...(!canAssign ? { disabled: true, reason: 'You need the right to assign owners.' } : scopeQ.isError ? { disabled: true, reason: 'The scope of your controls could not be read.' } : {}),
    },
    { id: 'export', label: 'Export selection', icon: Download, onRun: () => exportRows(rows.filter((r) => ticked.includes(r.i)), true) },
  ];
  const selectionApi = view === 'list' ? {
    ticked: selection.selected,
    onToggle: (id: number) => selection.set((s) => toggleOne(s, id)),
    state: tickState(selection.selected, pageIds),
    onToggleAll: () => selection.set((s) => toggleAll(s, pageIds)),
    headLabel: 'Select all controls on this page',
    rowLabel: (r: Row) => `Select ${truncate(r.control_id, 40).text}`,
  } : undefined;

  const scopeToggle = (
    <SegmentedControl
      label="Which controls"
      name={`${uid}-scope`}
      options={[
        { value: 'in_scope', label: `In scope${data?.scope?.applicable_count != null ? ` ${formatCount(data.scope.applicable_count)}` : ''}` },
        { value: 'all', label: `All${data?.scope?.total_count != null ? ` ${formatCount(data.scope.total_count)}` : ''}` },
      ]}
      value={scope}
      onChange={(v) => setAddress({ scope: v as typeof scope })}
    />
  );

  const failedList = noList ? { title: 'Couldn’t load the controls', message: errorMessage(listQ.error) } : null;
  const body = (() => {
    if (failedList) return <ErrorState {...failedList} onRetry={canRetry(listQ.error) ? () => { void listQ.refetch(); } : undefined} />;
    if (loading) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={10} columns={5} label="Loading the controls" /></div>;
    if (nothing) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          {unconfigured ? (
            <EmptyState
              kind="firstUse" bare icon={Crosshair} title="Choose your frameworks first"
              description="The controls that apply to you are worked out from the frameworks you are assessed against."
              action={canScope ? <Button variant="primary" leftIcon={<Crosshair aria-hidden />} onClick={() => setScopeOpen(true)}>Configure scope</Button> : undefined}
              tips={canScope ? undefined : ['Ask someone who manages frameworks to set the scope.']}
            />
          ) : (
            <EmptyState kind="firstUse" bare icon={Layers} title="No controls yet" description="The Secure Controls Framework has not been loaded for your organisation." />
          )}
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="noMatches" bare title="No controls match" description="Loosen a filter, or search for other words." onClearFilters={filtering ? () => setFilters(NO_FILTERS) : undefined} />
        </div>
      );
    }
    if (view === 'domain') {
      return <ByDomainView rows={filtered} onPick={(key) => setAddress({ ...filtersPatch({ ...filters, domain: [key] }), view: 'list' })} />;
    }
    if (view === 'board') {
      const board = groupBoard(sorted, BOARD_COLUMNS.map((c) => ({ id: c.id, label: c.label, test: (r: Row) => columnOf(r.overall_status) === c.id })));
      return (
        <div className="relative overflow-clip rounded-ds-card border border-ds-border bg-ds-surface">
          <BoardColumns
            label="Controls by where they stand"
            columns={board}
            getId={(r: Row) => r.i}
            cardLabel={(r: Row) => `${r.control_id} ${r.title}`}
            onOpen={(r: Row) => openControl(r.control_id)}
            onShowAll={(column) => { setAddress({ ...filtersPatch({ ...filters, status: wordsOf(column) }), view: 'list' }); }}
            renderCard={(r: Row) => (
              <>
                <span className="font-mono text-ds-label font-[600] text-ds-primary-text">{r.control_id}</span>
                <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.title}</span>
                <span className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
                  <StatusPill size="sm" {...statusPill(controlStatus, r.overall_status || 'not_run')} />
                  <span className="ml-auto text-ds-label text-ds-fg-muted">{r.owner_name || 'Unassigned'}</span>
                </span>
              </>
            )}
          />
        </div>
      );
    }
    return (
      <>
        <RecordTable
          caption="Controls"
          columns={columns}
          items={items}
          sort={{ key: sort.key === 'code' ? 'code' : sort.key, dir: sort.dir }}
          onSort={(key) => setSort(nextSort(sort, key as SortKey))}
          selection={selectionApi}
          cursorId={cursor}
          onActivate={(r) => openControl(r.control_id)}
          actions={(r) => <RowMenu row={r} env={env} />}
          card={(row) => <ControlCard row={row} env={env} />}
        />
        <Pager className="mt-[8px]" page={pageClamped} pageSize={pageSize} total={sorted.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={noun} />
      </>
    );
  })();

  const viewOptions = [{ value: 'list', label: 'List' }, { value: 'domain', label: 'By domain' }, { value: 'board', label: 'Board' }];
  const total = rows.length;
  const head = (fit: ExplorerFit) => (
    <>
      <PageHeader
        variant="page"
        title={label}
        info="Every control you are assessed on: the Secure Controls Framework’s and the ones you wrote yourself. A control’s status is where its automated checks stand."
        meta={noList || loading ? undefined : `${formatCount(total)} ${total === 1 ? 'control' : 'controls'}${data?.framework ? ` · ${data.framework}` : ''}`}
        actions={(
          <>
            <Button leftIcon={<Crosshair aria-hidden />} onClick={() => setScopeOpen(true)} disabled={!canScope} title={canScope ? 'Choose the frameworks and answers that decide which controls apply' : 'You need the right to manage frameworks.'}>
              <span className={fit.compact ? 'sr-only' : undefined}>Configure scope</span>
            </Button>
            {canCreate
              ? <Button variant="primary" href="/automation/soc2-controls/new" leftIcon={<Plus aria-hidden />}>New control</Button>
              : <Button variant="primary" disabled leftIcon={<Plus aria-hidden />} title="You need the right to create controls.">New control</Button>}
            <Menu
              label="More"
              iconOnly
              items={[
                { key: 'settings', label: 'Settings: fields and lists', icon: Settings2, onSelect: () => setSettingsOpen(true) },
                { key: 'refresh', label: 'Refresh the automated checks', icon: RefreshCw, onSelect: () => refreshChecks.mutate(), disabled: !canRefresh || refreshChecks.isPending, reason: canRefresh ? undefined : 'You need the right to run scans.' },
              ]}
            />
          </>
        )}
      />
      <ControlsStrip current="controls" />
    </>
  );

  return (
    <>
      <RecordExplorer
        label={label}
        noun={noun}
        head={head}
        notices={(
          <>
            {listQ.isError && !noList && (
              <ErrorState compact title="Couldn’t refresh the controls" message={`${errorMessage(listQ.error)} What is shown may be out of date.`} onRetry={canRetry(listQ.error) ? () => { void listQ.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
            )}
            {unconfigured && !nothing && (
              <Notice tone="warning" title="Choose your frameworks" action={canScope ? <Button leftIcon={<Crosshair aria-hidden />} onClick={() => setScopeOpen(true)}>Configure scope</Button> : undefined}>
                Until you do, only the controls you wrote yourself are listed.
              </Notice>
            )}
          </>
        )}
        quick={noList || loading ? [] : quick}
        onQuick={onQuick}
        quickLabel="Quick views"
        search={filters.search}
        onSearch={(q) => setFilters({ ...filters, search: q })}
        searchLabel="Search controls by code, name, domain, owner or requirement"
        searchRef={searchRef}
        views={{ label: 'Controls view', name: `${uid}-view`, options: viewOptions, value: view, onChange: (v) => setView(v as ExplorerView) }}
        actions={(fit) => (
          <>
            {scopeToggle}
            {view === 'list' && <Menu label="Sort" items={sortItems} />}
            <Button leftIcon={<Download aria-hidden />} onClick={() => exportRows(sorted, false)} disabled={filtered.length === 0 || loading} title={`Export the ${formatCount(filtered.length)} controls shown as a spreadsheet`}>
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
            summary={`${formatCount(filtered.length)} of ${formatCount(rows.length)} ${rows.length === 1 ? 'control' : 'controls'}`}
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
            onSelectAll={() => selection.set(selectAllMatching(filtered.map((r) => r.i)))}
            onClear={selection.clear}
            actions={bulkDefs}
          />
        ) : undefined}
        ready={!loading && !noList}
      />

      <AssignOwnerSheet
        open={assignOpen}
        onClose={() => setAssignOpen(false)}
        count={ticked.length}
        people={usersQ.data}
        peopleFailed={usersQ.isError}
        onRetryPeople={() => { void usersQ.refetch(); }}
        pending={assign.isPending}
        onAssign={(owner) => assign.mutate({ ids: rows.filter((r) => ticked.includes(r.i)).map((r) => r.control_id), owner })}
      />

      <ScopeDialog open={scopeOpen} onClose={() => setScopeOpen(false)} />

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Controls settings" subtitle="Fields and lists" width="lg">
        <ModuleSettingsPanel moduleKey="controls" />
      </Sheet>
    </>
  );
}

