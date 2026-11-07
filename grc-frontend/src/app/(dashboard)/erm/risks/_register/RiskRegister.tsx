'use client';

/**
 * Risk Management > Risk Register: the Facet explorer. This file is the Risk CONFIGURATION of components/records (RecordExplorer): it owns the data (one lean request for every risk, the
 * open reviews, the appetite limits, the people), the page's state (filters, sort, the risk open and the view live in the ADDRESS on the kit's useAddressState, so a link opens the
 * same view), the mutations and what each part draws. What a filter MEANS is riskModel.ts; the facets and their live counts are riskFacets.ts over components/records/facetEngine.ts
 * (held to the plain filter by a test); the figures of Insights are riskInsights.ts (held to the server's dashboards).
 *
 * The register loads ONCE, whole: every count, facet number, the matrix and the export are over all the risks (the response says when it could not hold them all). The old list read
 * the newest 100. Every write is reported when the server has answered (useReportedMutation, a failure stays on screen with a Retry) and Delete asks first, naming what goes with the risk.
 * The old links keep working: ?new=1, ?upload=1, ?edit=<id>, ?register_type=<name>.
 */
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Gauge, Plus, Settings2, ShieldAlert, Upload } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, ErrorState, Menu, Notice, Pager, SkeletonRows, Sheet, useAddressState, useConfirm, useNotify, useReportedMutation, type FilterChip, type MenuItem,
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
import NcaRiskQuickAddModal from '@/components/risks/NcaRiskQuickAddModal';
import { usePermissions } from '@/hooks/usePermissions';
import { ermApi } from '@/lib/api';
import { formatCount, truncate } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import type { Risk } from '@/types';
import { ImportPanel } from './ImportPanel';
import { InsightsView } from './InsightsView';
import { RiskDrawer, type RiskFull } from './RiskDrawer';
import { RiskModal, type RiskModalSubmitPayload } from './RiskForm';
import { assetsNotLinked, saveRiskForm } from './riskSave';
import { LevelCell, OwnerCell, RiskCard, RowMenu, riskColumns, type RowEnv } from './RiskRows';
import { REGISTER_SCHEMA, arrivedPatch, filtersPatch, openPatch, pageOf, type RegisterAddress, type RegisterView } from './riskAddress';
import {
  FACET_TITLE, NO_FILTERS, OPEN_AT_FIRST, RAIL_ORDER, SEARCHABLE, chosenOf, filterChips, filterCount, indexRisks, isFiltering, orderedOptions, railOptions, removeChip, ruleOf,
  type FacetKey, type Filters,
} from './riskFacets';
import { RISK_REFRESH, failureWords, useAppetite, useMeId, usePendingReviews, useRisks, useTenantUsers } from './riskData';
import {
  BUCKET_LABEL, QUICK_IDS, QUICK_LABEL, SORT_KEYS, SORT_LABEL, STATUS_BUCKETS, exportName, inQuick, nextSort, sortRisks, statusBucket, toCsv, type QuickId, type RiskRow, type SortKey,
} from './riskModel';
import { isNca } from './riskImport';

const PAGE_SIZES = [25, 50, 100, 250] as const;
const QUICK_SHOWN: QuickId[] = ['all', 'mine', 'review', 'appetite', 'unowned', 'recent'];
const RAIL_LIMIT: Partial<Record<FacetKey, number>> = { owner: 7, unit: 7, framework: 7, category: 7 };
const NO_KEYS: ReadonlySet<string> = new Set<string>();

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

type FormState = { mode: 'create'; initialRegister: string } | { mode: 'edit'; risk: RiskFull };

export function RiskRegister() {
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const uid = useId();
  const { confirm, confirmDialog } = useConfirm();
  const { hasPermission } = usePermissions();
  // The server lets any signed-in person write to the register behind the module's read right; the register keeps the keys it always asked for (recorded as a gap for the user to settle)
  const canCreate = hasPermission('erm:risks:create');
  const canEdit = hasPermission('erm:risks:edit');
  const canDelete = hasPermission('erm:risks:delete');
  const me = useMeId();

  // ── the page's state: in the address ──
  const [address, setAddress] = useAddressState(REGISTER_SCHEMA);
  const page = useMemo(() => pageOf(address as RegisterAddress), [address]);
  const { filters, sort, view, openId, arrive } = page;
  const setFilters = useCallback((next: Filters) => setAddress(filtersPatch(next)), [setAddress]);
  const setSort = useCallback((next: typeof sort) => setAddress({ sort: next }), [setAddress]);
  const setOpenId = useCallback((id: number | null) => setAddress(openPatch(id)), [setAddress]);
  const setView = useCallback((next: RegisterView) => setAddress({ view: next }), [setAddress]);

  // ── the data ──
  const risksQ = useRisks();
  const reviewsQ = usePendingReviews();
  const appetiteQ = useAppetite();
  const usersQ = useTenantUsers();
  const rows: RiskRow[] = useMemo(() => (risksQ.data?.items ?? []) as RiskRow[], [risksQ.data]);
  const total = risksQ.data?.total;
  const noList = risksQ.isError && !risksQ.data;                      // the list could not be read at all: never drawn as an empty register
  const loading = risksQ.isPending;
  const cut = !!risksQ.data?.truncated;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [risksQ.data]);
  const ctx = useMemo(() => ({ me, now, limits: appetiteQ.limits, reviews: reviewsQ.index }), [me, now, appetiteQ.limits, reviewsQ.index]);

  // ── the facets: one index of the risks, one pass for the matches and every live count ──
  const index = useMemo(() => indexRisks(rows, ctx), [rows, ctx]);
  const searched = useDeferredValue(filters.search);
  const applied = useMemo(() => (searched === filters.search ? filters : { ...filters, search: searched }), [filters, searched]);
  const result = useMemo(() => evaluate(index, chosenOf(applied), ruleOf(applied, ctx)), [index, applied, ctx]);
  const filtered = result.matches;
  // Insights draws the matrix without its own cell filter (the cell would empty the matrix it was picked from)
  const insightRows = useMemo(
    () => (view === 'insights' && filters.cell ? evaluate(index, chosenOf(applied), ruleOf({ ...applied, cell: null }, ctx)).matches : filtered),
    [view, filters.cell, index, applied, ctx, filtered],
  );
  const filtering = isFiltering(filters);
  const matchKey = useMemo(() => `${filtered.length}:${filtered.reduce((h, r) => (h * 31 + r.id) >>> 0, 7)}`, [filtered]);

  const options = useMemo(
    () => railOptions({
      rows,
      people: (usersQ.data ?? []).map((u) => ({ id: u.id, display_name: u.display_name, email: u.email })),
      frameworks: risksQ.data?.frameworks ?? {},
      units: {},
    }),
    [rows, usersQ.data, risksQ.data?.frameworks],
  );
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
    QUICK_IDS.forEach((id) => { out[id] = rows.reduce((n, r) => n + (inQuick(id, r, ctx) ? 1 : 0), 0); });
    return out;
  }, [rows, ctx]);
  const activeQuick = filters.quick ?? 'all';
  const quickNote = (id: QuickId): string | undefined => {
    if (id === 'review' && reviewsQ.isError) return 'Scheduled reviews could not be loaded: this counts the review dates on the risks only.';
    if (id === 'appetite' && appetiteQ.isError) return 'Risk appetite could not be loaded, so nothing is counted as above it.';
    if (id === 'mine' && me == null) return 'Your account could not be read, so "My risks" is empty.';
    return undefined;
  };
  const quick: FilterChip[] = QUICK_SHOWN.map((id) => ({
    key: id, label: QUICK_LABEL[id], active: activeQuick === id, count: quickCounts[id] ?? 0, title: quickNote(id),
    flag: quickNote(id) ? { label: 'Incomplete', tone: 'warning' as const } : undefined,
  }));
  const onQuick = (id: string) => setFilters({ ...filters, quick: id === 'all' || activeQuick === id ? null : (id as QuickId) });
  const moreQuick: MenuItem[] = (['unscored', 'critical'] as QuickId[]).map((id, i) => ({
    key: `q:${id}`, label: QUICK_LABEL[id], checked: activeQuick === id, radio: true, trailing: String(quickCounts[id] ?? 0), section: i === 0 ? 'More views' : undefined,
    onSelect: () => onQuick(id),
  }));

  // ── the list: sorted, a page of it ──
  const sorted = useMemo(() => sortRisks(filtered, sort, { reviews: reviewsQ.index, now }), [filtered, sort, reviewsQ.index, now]);
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

  // ── the form, import, settings ──
  const [form, setForm] = useState<FormState | null>(null);
  const [ncaForm, setNcaForm] = useState<{ editId: number | null } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const refresh = () => RISK_REFRESH.forEach((k) => { void qc.invalidateQueries({ queryKey: [...k] }); });

  const openEdit = useCallback(async (row: RiskRow) => {
    if (isNca(row.register_type)) { setNcaForm({ editId: row.id }); return; }
    try {
      const full = await qc.fetchQuery({ queryKey: ['erm-risk-detail', row.id], queryFn: async () => (await ermApi.risks.getDetail(row.id)).data as unknown as RiskFull, staleTime: 0 });
      setForm({ mode: 'edit', risk: full });
    } catch (e) {
      notify.error(errorMessage(e), { title: 'The risk could not be opened for editing', retry: () => { void openEdit(row); } });
    }
  }, [qc, notify]);

  // links from elsewhere (and from the old pages): acted on once, then taken out of the address
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || loading) return;
    if (!arrive.create && !arrive.upload && !arrive.edit) return;
    arrived.current = true;
    if (arrive.create) setForm({ mode: 'create', initialRegister: filters.register[0] && filters.register[0] !== 'none' ? filters.register[0] : '' });
    else if (arrive.upload) setImportOpen(true);
    else if (arrive.edit) {
      const target = rows.find((r) => r.id === arrive.edit);
      if (target) void openEdit(target);
      else notify.warning('That risk is not in the register any more.', { title: 'Risk not found' });
    }
    setAddress(arrivedPatch());
  }, [arrive, loading, rows, filters.register, openEdit, notify, setAddress]);

  const saveRisk = async (payload: RiskModalSubmitPayload) => {
    const editing = form?.mode === 'edit' ? form.risk : null;
    const saved = await saveRiskForm(editing?.id ?? null, payload, editing as never);
    refresh();
    setForm(null);
    notify.success(editing ? 'The changes are saved.' : 'The risk is in the register.', { title: editing ? 'Risk updated' : 'Risk added' });
    const missed = assetsNotLinked(saved.failedAssets);
    if (missed) notify.warning(missed, { title: 'Some assets were not linked' });
  };

  const remove = useReportedMutation({
    mutationFn: (id: number) => ermApi.risks.delete(id),
    success: { title: 'Risk deleted', message: 'Its links, actions, reviews, indicators and incident records went with it.' },
    failure: "Couldn't delete the risk",
    invalidate: RISK_REFRESH,
    onSuccess: (_, id) => { if (openId === id) setOpenId(null); },
  });
  const askDelete = async (row: RiskRow) => {
    const yes = await confirm({
      title: `Delete “${truncate(row.title, 80).text}”?`,
      message: 'This removes the risk with its links to controls, assets and evidence, its mitigation actions, reviews, indicators and incident records. It cannot be undone.',
      confirmLabel: 'Delete risk',
      tone: 'danger',
    });
    if (yes) remove.mutate(row.id);
  };

  // ── rows, handlers ──
  const hrefOf = (id: number) => `/erm/risks/${id}`;
  const openRisk = (id: number, tab?: string) => router.push(tab ? `${hrefOf(id)}?tab=${tab}` : hrefOf(id));
  const [compact] = useState(false);
  const env: RowEnv = { now, reviews: reviewsQ.index, compact, hrefOf, onPeek: setOpenId, onOpen: openRisk, canEdit, canDelete, onEdit: (r) => { void openEdit(r); }, onDelete: (r) => { void askDelete(r); } };
  const columns = useMemo(() => riskColumns(env), [env.now, env.reviews, env.canEdit, env.canDelete]);   // eslint-disable-line react-hooks/exhaustive-deps

  const items: RecordItem<RiskRow>[] = useMemo(() => pageRows.map((record) => ({ kind: 'row' as const, id: record.id, record, depth: 0 })), [pageRows]);
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
  const exportRows = (list: readonly RiskRow[], selectionOnly: boolean) => {
    const names = risksQ.data?.frameworks ?? {};
    download(toCsv(list, { frameworks: (r) => (r.framework_ids ?? []).map((id) => names[String(id)]?.name ?? '').filter(Boolean).join('; ') }), exportName(new Date().toISOString().slice(0, 10), list.length, selectionOnly), 'text/csv;charset=utf-8');
  };

  // ── what the page says ──
  const label = routeFor('/erm/risks')?.label ?? 'Risk Register';
  const noun = { one: 'risk', other: 'risks' };
  const chips = filterChips(filters, options);
  const nothing = rows.length === 0;
  const sortItems: MenuItem[] = SORT_KEYS.map((k, i) => ({
    key: `sort:${k}`, label: SORT_LABEL[k], checked: sort.key === k, radio: true, section: i === 0 ? 'Sort by' : undefined,
    trailing: sort.key === k ? (sort.dir === 'asc' ? '↑ ascending' : '↓ descending') : undefined, onSelect: () => setSort(nextSort(sort, k as SortKey)),
  }));
  const bulkDefs: BulkActionDef[] = [{ id: 'export', label: 'Export selection', icon: Download, onRun: () => exportRows(rows.filter((r) => ticked.includes(r.id)), true) }];
  const selectionApi = view === 'list' ? {
    ticked: selection.selected,
    onToggle: (id: number) => selection.set((s) => toggleOne(s, id)),
    state: tickState(selection.selected, pageIds),
    onToggleAll: () => selection.set((s) => toggleAll(s, pageIds)),
    headLabel: 'Select all risks on this page',
    rowLabel: (r: RiskRow) => `Select ${truncate(r.title, 60).text}`,
  } : undefined;

  const body = (() => {
    if (noList) return <ErrorState {...failureWords(risksQ.error, 'the risks')} onRetry={canRetry(risksQ.error) ? () => { void risksQ.refetch(); } : undefined} />;
    if (loading) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={10} columns={5} label="Loading the risks" /></div>;
    if (nothing) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState
            kind="firstUse" bare icon={ShieldAlert} title="No risks yet"
            description="Add the first risk, or import a register you already keep."
            action={canCreate ? (
              <span className="flex flex-wrap justify-center gap-[8px]">
                <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setForm({ mode: 'create', initialRegister: '' })}>Add risk</Button>
                <Button leftIcon={<Upload aria-hidden />} onClick={() => setImportOpen(true)}>Import a register</Button>
              </span>
            ) : undefined}
          />
        </div>
      );
    }
    if (view === 'insights') return <InsightsView rows={insightRows} filters={filters} onBasis={(basis) => setFilters({ ...filters, basis })} onDrill={(patch) => { setAddress({ ...filtersPatch({ ...filters, ...patch }), view: 'list' }); }} />;
    if (filtered.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="noMatches" bare title="No risks match" description="Loosen a filter, or search for other words." onClearFilters={filtering ? () => setFilters(NO_FILTERS) : undefined} />
        </div>
      );
    }
    if (view === 'board') {
      const board = groupBoard(sorted, STATUS_BUCKETS.map((b) => ({ id: b, label: BUCKET_LABEL[b], test: (r: RiskRow) => statusBucket(r.status) === b })));
      return (
        <div className="relative overflow-clip rounded-ds-card border border-ds-border bg-ds-surface">
          <BoardColumns
            label="Risks by status"
            columns={board}
            getId={(r: RiskRow) => r.id}
            activeId={openId}
            cardLabel={(r: RiskRow) => r.title}
            onOpen={(r: RiskRow) => setOpenId(r.id)}
            onShowAll={(column) => { setFilters({ ...filters, status: [column] }); setView('list'); }}
            renderCard={(r: RiskRow) => (
              <>
                <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.title}</span>
                <span className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]"><LevelCell row={r} withScores={false} /><span className="ml-auto"><OwnerCell row={r} /></span></span>
              </>
            )}
          />
        </div>
      );
    }
    return (
      <>
        <RecordTable
          caption="Risks"
          columns={columns}
          items={items}
          sort={{ key: sort.key, dir: sort.dir }}
          onSort={(key) => setSort(nextSort(sort, key as SortKey))}
          selection={selectionApi}
          activeId={openId}
          cursorId={cursor}
          onActivate={(r) => setOpenId(r.id)}
          actions={(r) => <RowMenu row={r} env={env} />}
          card={(row) => <RiskCard row={row} env={env} />}
        />
        <Pager className="mt-[8px]" page={pageClamped} pageSize={pageSize} total={sorted.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={noun} />
      </>
    );
  })();

  const viewOptions = [{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }, { value: 'insights', label: 'Insights' }];
  const addNca = filters.register.length === 1 && isNca(filters.register[0]);
  const head = (fit: ExplorerFit) => (
    <PageHeader
      variant="page"
      title={label}
      info="Every risk the organisation keeps: its level, who owns it, what is being done and when it is next reviewed."
      meta={noList || loading ? undefined : `${formatCount(total ?? rows.length)} ${(total ?? rows.length) === 1 ? 'risk' : 'risks'}${cut ? ` (showing ${formatCount(rows.length)})` : ''}`}
      actions={(
        <>
          {canCreate && (
            <>
              <Button onClick={() => setImportOpen(true)} title="Import" leftIcon={<Upload aria-hidden />}><span className={fit.compact ? 'sr-only' : undefined}>Import</span></Button>
              {addNca && <Button onClick={() => setNcaForm({ editId: null })} leftIcon={<Gauge aria-hidden />}><span className={fit.compact ? 'sr-only' : undefined}>Add NCA risk</span></Button>}
              <Button variant="primary" onClick={() => setForm({ mode: 'create', initialRegister: filters.register[0] && filters.register[0] !== 'none' ? filters.register[0] : '' })} title="Add risk" leftIcon={<Plus aria-hidden />}>Add risk</Button>
            </>
          )}
          {canEdit && <Menu label="Register settings" iconOnly items={[{ key: 'settings', label: 'Settings: statuses, SLA, fields and lists', icon: Settings2, onSelect: () => setSettingsOpen(true) }]} />}
        </>
      )}
    />
  );

  return (
    <>
      <RecordExplorer
        label={label}
        noun={noun}
        head={head}
        notices={(
          <>
            {risksQ.isError && !noList && (
              <ErrorState compact title="Couldn't refresh the risks" message={`${errorMessage(risksQ.error)} What is shown may be out of date.`} onRetry={canRetry(risksQ.error) ? () => { void risksQ.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
            )}
            {cut && <Notice tone="info" title="Only part of the register is loaded">The first {formatCount(rows.length)} of {formatCount(total ?? rows.length)} risks are shown. Filter to narrow it down.</Notice>}
            {missingOpen && (
              <Notice tone="warning" title="That risk is not in the register" action={<Button variant="ghost" onClick={() => setOpenId(null)}>Dismiss</Button>}>
                It may have been deleted, or you may not be allowed to see it.
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
        searchLabel="Search risks by title, category, register, owner or unit"
        searchRef={searchRef}
        views={{ label: 'Register view', name: `${uid}-view`, options: viewOptions, value: view, onChange: (v) => setView(v as RegisterView) }}
        actions={(fit) => (
          <>
            {view === 'list' && <Menu label="Sort" items={sortItems} />}
            <Button leftIcon={<Download aria-hidden />} onClick={() => exportRows(sorted, false)} disabled={filtered.length === 0 || loading} title={`Export the ${formatCount(filtered.length)} risks shown as a spreadsheet`}>
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
            summary={`${formatCount(filtered.length)} of ${formatCount(rows.length)} ${rows.length === 1 ? 'risk' : 'risks'}`}
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
          />
        ) : undefined}
        detail={(
          <RiskDrawer
            row={openRow}
            now={now}
            reviews={reviewsQ.index}
            onClose={() => setOpenId(null)}
            onOpenRisk={openRisk}
            onEdit={(r) => { void openEdit(r); }}
            canEdit={canEdit}
            onDelete={(r) => { void askDelete(r); }}
            canDelete={canDelete}
            onStep={(dir) => { const next = sorted[openAt + dir]; if (next) setOpenId(next.id); }}
            hasPrev={openAt > 0}
            hasNext={openAt >= 0 && openAt < sorted.length - 1}
          />
        )}
        ready={!loading && !noList}
      />

      {form && (
        <RiskModal
          isOpen
          risk={form.mode === 'edit' ? (form.risk as unknown as Risk) : null}
          initialRegisterType={form.mode === 'create' ? form.initialRegister : ''}
          nextOneLinkSeq={rows.filter((r) => (r.register_type || '').toLowerCase().replace(/[^a-z0-9]/g, '') === '1link').length + 1}
          onClose={() => setForm(null)}
          onSubmit={saveRisk}
          isLoading={false}
        />
      )}

      <NcaRiskQuickAddModal
        isOpen={!!ncaForm}
        onClose={() => setNcaForm(null)}
        editBridgedRiskId={ncaForm?.editId ?? null}
        onCreated={(_entryId, bridgedRiskId) => {
          const wasEdit = ncaForm?.editId != null;
          setNcaForm(null);
          refresh();
          void qc.invalidateQueries({ queryKey: ['nca-risk-entries'] });
          notify.success(wasEdit ? 'The changes are saved.' : 'The risk is in the register.', { title: wasEdit ? 'Risk updated' : 'Risk added' });
          if (!wasEdit && bridgedRiskId) router.push(hrefOf(bridgedRiskId));
        }}
      />

      <ImportPanel open={importOpen} onClose={() => setImportOpen(false)} initialType={filters.register[0] && filters.register[0] !== 'none' ? filters.register[0] : ''} />

      <Sheet open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Register settings" subtitle="Statuses, SLA, fields and lists" width="lg">
        <ModuleSettingsPanel moduleKey="risks" />
      </Sheet>

      {confirmDialog}
    </>
  );
}

