'use client';

/**
 * Risk Management > Risk Assessments: the home. This file is the Assessments CONFIGURATION of components/records (RecordExplorer), as the Risk Register is for risks: one request for every
 * assessment of both kinds (manual campaigns over register risks, and framework questionnaires), the page's state in the ADDRESS (filters, sort, view, the assessment open), the counters band
 * (the quick views, each with its true number, each a filter), a List / Board / Insights switch, and a drawer for the details. What a filter MEANS is assessmentModel.ts and
 * assessmentFacets.ts (held to the plain filter by a test); the figures of Insights are `insightsOf`.
 *
 * It replaces: the dashboard page (ten charts, two URLs), the "Manual assessments" list (which also listed framework ones) and the Framework page's Saved / Assigned To Me tabs (the same
 * framework assessments a third time). The old addresses forward here; ?tab=assigned is the quick view "Assigned to me".
 * Every write says what happened; a failed load is an error with Retry, never an empty page; the delete confirmation names what goes with the assessment.
 */
import { useCallback, useDeferredValue, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardList, FileSpreadsheet, Plus, ShieldCheck, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import {
  Button, EmptyState, ErrorState, Menu, Notice, Pager, SkeletonRows, useAddressState, useConfirm, useReportedMutation, type FilterChip, type MenuItem,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { AppliedFilters } from '@/components/records/AppliedFilters';
import { BoardColumns } from '@/components/records/BoardColumns';
import { RecordExplorer } from '@/components/records/RecordExplorer';
import { RecordTable, type RecordItem } from '@/components/records/RecordTable';
import { countOf, evaluate } from '@/components/records/facetEngine';
import { groupBoard, moveCursor } from '@/components/records/explorerModel';
import type { FacetGroupView } from '@/components/records/FacetRail';
import { useExplorerKeys } from '@/components/records/useExplorerKeys';
import { ermApi } from '@/lib/api';
import { formatCount, truncate } from '@/lib/format';
import { routeFor } from '@/lib/navRegistry';
import { useMeId, failureWords } from '../../risks/_register/riskData';
import { AssessmentCard, OwnerCell, RowMenu, StatusCell, assessmentColumns, type RowEnv } from './AssessmentRows';
import { AssessmentDrawer } from './AssessmentDrawer';
import { FrameworkPanel, ImportPanel, ManualPanel } from './CreatePanels';
import { InsightsView } from './InsightsView';
import { ASSESSMENT_REFRESH, useAssessmentRegister, useAssessmentRights } from './assessmentData';
import {
  FACET_TITLE, OPEN_AT_FIRST, RAIL_ORDER, SEARCHABLE, chosenOf, filterChips, indexAssessments, orderedOptions, railOptions, removeChip, ruleOf, type FacetKey,
} from './assessmentFacets';
import {
  NO_FILTERS, QUICK_IDS, QUICK_LABEL, REGISTER_SCHEMA, progressWords, STAGES, STAGE_LABEL, SORT_KEYS, SORT_LABEL, filterCount, filtersPatch, hrefOf, inQuick, keyOf, nextSort, pageOf, refOf, sortRows, stageOf,
  type AssessmentRow, type Filters, type QuickId, type RegisterAddress, type RegisterView, type SortKey,
} from './assessmentModel';

const PAGE_SIZES = [25, 50, 100, 250] as const;
const QUICK_SHOWN: QuickId[] = QUICK_IDS.slice();
const RAIL_LIMIT: Partial<Record<FacetKey, number>> = { owner: 7, framework: 7 };

export function AssessmentRegister() {
  const router = useRouter();
  const uid = useId();
  const { confirm, confirmDialog } = useConfirm();
  const { canWrite } = useAssessmentRights();
  const me = useMeId();

  const [address, setAddress] = useAddressState(REGISTER_SCHEMA);
  const page = useMemo(() => pageOf(address as RegisterAddress), [address]);
  const { filters, sort, view, open } = page;
  const setFilters = useCallback((next: Filters) => setAddress(filtersPatch(next)), [setAddress]);
  const setView = useCallback((next: RegisterView) => setAddress({ view: next }), [setAddress]);
  const setOpen = useCallback((row: Pick<AssessmentRow, 'kind' | 'id'> | null) => setAddress({ open: row ? refOf(row) : '' }), [setAddress]);
  const setCreate = useCallback((which: '' | 'framework' | 'manual' | 'import') => setAddress({ new: which, upload: false }), [setAddress]);

  // ── the data ──
  const registerQ = useAssessmentRegister();
  const rows = useMemo(() => registerQ.data?.items ?? [], [registerQ.data]);
  const total = registerQ.data?.total;
  const noList = registerQ.isError && !registerQ.data;
  const loading = registerQ.isPending;
  const cut = !!registerQ.data?.truncated;
  const ctx = useMemo(() => ({ me }), [me]);

  // ── facets ──
  const index = useMemo(() => indexAssessments(rows), [rows]);
  const searched = useDeferredValue(filters.search);
  const applied = useMemo(() => (searched === filters.search ? filters : { ...filters, search: searched }), [filters, searched]);
  const result = useMemo(() => evaluate(index, chosenOf(applied), ruleOf(applied, ctx)), [index, applied, ctx]);
  const filtered = result.matches;
  const filtering = filterCount(filters) > 0;
  const options = useMemo(() => railOptions(rows), [rows]);
  const chosen = chosenOf(filters);
  const groups: FacetGroupView[] = RAIL_ORDER.map((facet) => {
    const picked = chosen[facet] ?? [];
    const opts = orderedOptions(options[facet], picked, (v) => countOf(result.counts, facet, v));
    return {
      key: facet, label: FACET_TITLE[facet], chosen: picked.length, searchable: SEARCHABLE.includes(facet), limit: RAIL_LIMIT[facet], defaultOpen: OPEN_AT_FIRST.includes(facet),
      options: opts.map((o) => ({ value: o.value, label: o.label, count: countOf(result.counts, facet, o.value), checked: picked.includes(o.value) })),
    };
  });
  const toggleFacet = (facet: string, value: string) => {
    const key = facet as FacetKey;
    const cur = filters[key];
    setFilters({ ...filters, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] } as Filters);
  };
  const clearFacet = (facet: string) => setFilters({ ...filters, [facet]: [] } as Filters);

  // ── the counters band: the quick views, each with its true number ──
  const quickCounts = useMemo(() => {
    const out: Record<string, number> = {};
    QUICK_IDS.forEach((id) => { out[id] = rows.reduce((n, r) => n + (inQuick(id, r, ctx) ? 1 : 0), 0); });
    return out;
  }, [rows, ctx]);
  const activeQuick = filters.quick ?? 'all';
  const quick: FilterChip[] = QUICK_SHOWN.map((id) => ({
    key: id, label: QUICK_LABEL[id], active: activeQuick === id, count: quickCounts[id] ?? 0,
    title: id === 'mine' && me == null ? 'Your account could not be read, so only the questions assigned to you are counted.' : undefined,
  }));
  const onQuick = (id: string) => setFilters({ ...filters, quick: id === 'all' || activeQuick === id ? null : (id as QuickId) });

  // ── the list ──
  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const viewKey = `${filtered.length}|${sort.key}:${sort.dir}|${pageSize}|${JSON.stringify(filters)}`;
  const [seen, setSeen] = useState(viewKey);
  if (seen !== viewKey) { setSeen(viewKey); setPageNo(1); }
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageClamped = Math.min(Math.max(1, pageNo), pages);
  const pageRows = useMemo(() => sorted.slice((pageClamped - 1) * pageSize, pageClamped * pageSize), [sorted, pageClamped, pageSize]);
  const [cursor, setCursor] = useState<number | null>(null);

  const openRow = open ? rows.find((r) => r.kind === open.kind && r.id === open.id) ?? null : null;
  const openAt = openRow ? sorted.findIndex((r) => keyOf(r) === keyOf(openRow)) : -1;
  const missingOpen = !!open && !loading && !noList && !openRow;
  const go = (r: AssessmentRow, query?: string) => router.push(query ? `${hrefOf(r)}?${query}` : hrefOf(r));

  // ── delete ──
  const remove = useReportedMutation({
    mutationFn: (r: AssessmentRow) => (r.kind === 'framework' ? ermApi.frameworkRiskAssessments.delete(r.id) : ermApi.riskAssessments.delete(r.id)),
    success: (_d, r) => ({ title: 'Assessment deleted', message: r.kind === 'framework' ? 'Its questions, answers and evidence went with it.' : 'The risks stay in the Risk Register.' }),
    failure: "Couldn't delete the assessment",
    invalidate: ASSESSMENT_REFRESH,
    onSuccess: (_d, r) => { if (open && open.kind === r.kind && open.id === r.id) setOpen(null); },
  });
  const askDelete = async (r: AssessmentRow) => {
    const what = r.kind === 'framework'
      ? `${r.total_items ? `Its ${formatCount(r.total_items)} ${r.total_items === 1 ? 'question' : 'questions'}, ${r.done_items ? `${formatCount(r.done_items)} answered, ` : ''}with` : 'Its'} the answers and any evidence uploaded for them, go with it.`
      : `${r.total_items ? `Its ${formatCount(r.total_items)} assessed ${r.total_items === 1 ? 'risk' : 'risks'}, with their scores and links` : 'Its scores and links'}, go with it. The risks themselves stay in the Risk Register.`;
    const yes = await confirm({ title: `Delete “${truncate(r.name, 80).text}”?`, message: `${what} It cannot be undone.`, confirmLabel: 'Delete assessment', tone: 'danger' });
    if (yes) remove.mutate(r);
  };

  // ── rows ──
  const env: RowEnv = { onPeek: setOpen, canWrite, onDelete: (r) => { void askDelete(r); }, compact: false };
  const columns = useMemo(() => assessmentColumns(env), [env.canWrite]);   // eslint-disable-line react-hooks/exhaustive-deps
  const items: RecordItem<AssessmentRow>[] = useMemo(() => pageRows.map((record) => ({ kind: 'row' as const, id: keyOf(record), record, depth: 0 })), [pageRows]);
  const pageKeys = useMemo(() => pageRows.map(keyOf), [pageRows]);
  const byKey = useMemo(() => new Map(rows.map((r) => [keyOf(r), r])), [rows]);

  const searchRef = useRef<HTMLInputElement>(null);
  useExplorerKeys({
    onSearch: () => searchRef.current?.focus(),
    onMove: (dir) => setCursor((c) => moveCursor(pageKeys, c, dir)),
    onOpen: () => { const r = cursor != null ? byKey.get(cursor) : null; if (r) setOpen(r); },
    onEscape: () => undefined,
  }, view === 'list');

  // ── what the page says ──
  const label = routeFor('/erm/risk-assessments')?.label ?? 'Risk Assessments';
  const noun = { one: 'assessment', other: 'assessments' };
  const chips = filterChips(filters, options);
  const nothing = rows.length === 0;
  const sortItems: MenuItem[] = SORT_KEYS.map((k, i) => ({
    key: `sort:${k}`, label: SORT_LABEL[k], checked: sort.key === k, radio: true, section: i === 0 ? 'Sort by' : undefined,
    trailing: sort.key === k ? (sort.dir === 'asc' ? '↑ ascending' : '↓ descending') : undefined, onSelect: () => setAddress({ sort: nextSort(sort, k as SortKey) }),
  }));
  const newItems: MenuItem[] = [
    { key: 'framework', label: 'From a framework', icon: ShieldCheck, onSelect: () => setCreate('framework') },
    { key: 'manual', label: 'Blank (risks from the register)', icon: ClipboardList, onSelect: () => setCreate('manual') },
    { key: 'import', label: 'Import from Excel', icon: FileSpreadsheet, onSelect: () => setCreate('import') },
  ];
  const ownerIdOf = (name: string) => rows.find((r) => r.owner_name === name)?.owner_id?.toString() ?? null;

  const body = (() => {
    if (noList) return <ErrorState {...failureWords(registerQ.error, 'the risk assessments')} onRetry={canRetry(registerQ.error) ? () => { void registerQ.refetch(); } : undefined} />;
    if (loading) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={8} columns={5} label="Loading the assessments" /></div>;
    if (nothing) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState
            kind="firstUse" bare icon={ClipboardList} title="No risk assessments yet"
            description="Start one from a framework, or choose risks from the register to assess, or bring in a workbook you already keep."
            action={canWrite ? (
              <span className="flex flex-wrap justify-center gap-[8px]">
                <Button variant="primary" leftIcon={<Sparkles aria-hidden />} onClick={() => setCreate('framework')}>From a framework</Button>
                <Button leftIcon={<Plus aria-hidden />} onClick={() => setCreate('manual')}>Blank assessment</Button>
                <Button leftIcon={<FileSpreadsheet aria-hidden />} onClick={() => setCreate('import')}>Import from Excel</Button>
              </span>
            ) : undefined}
          />
        </div>
      );
    }
    if (view === 'insights') return <InsightsView rows={filtered} ownerIdOf={ownerIdOf} onDrill={(patch) => { setAddress({ ...filtersPatch({ ...filters, ...patch }), view: 'list' }); }} />;
    if (filtered.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="noMatches" bare title="No assessments match" description="Loosen a filter, or search for other words." onClearFilters={filtering ? () => setFilters(NO_FILTERS) : undefined} />
        </div>
      );
    }
    if (view === 'board') {
      const board = groupBoard(sorted, STAGES.map((s) => ({ id: s, label: STAGE_LABEL[s], test: (r: AssessmentRow) => stageOf(r.kind, r.status) === s })));
      return (
        <div className="relative overflow-clip rounded-ds-card border border-ds-border bg-ds-surface">
          <BoardColumns
            label="Assessments by stage"
            columns={board}
            getId={keyOf}
            activeId={openRow ? keyOf(openRow) : null}
            cardLabel={(r: AssessmentRow) => r.name}
            onOpen={(r: AssessmentRow) => setOpen(r)}
            onShowAll={(column) => { setFilters({ ...filters, status: [column] }); setView('list'); }}
            renderCard={(r: AssessmentRow) => (
              <>
                <span dir="auto" className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{r.name}</span>
                <span className="text-ds-label text-ds-fg-muted">{r.kind === 'framework' ? 'Framework' : 'Manual'} · {progressWords(r)}</span>
                <span className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]"><StatusCell row={r} /><span className="ml-auto"><OwnerCell row={r} /></span></span>
              </>
            )}
          />
        </div>
      );
    }
    return (
      <>
        <RecordTable
          caption="Risk assessments"
          columns={columns}
          items={items}
          sort={{ key: sort.key, dir: sort.dir }}
          onSort={(key) => setAddress({ sort: nextSort(sort, key as SortKey) })}
          activeId={openRow ? keyOf(openRow) : null}
          cursorId={cursor}
          onActivate={(r) => setOpen(r)}
          actions={(r) => <RowMenu row={r} env={env} onOpen={(row) => go(row)} />}
          card={(row) => <AssessmentCard row={row} />}
        />
        <Pager className="mt-[8px]" page={pageClamped} pageSize={pageSize} total={sorted.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={noun} />
      </>
    );
  })();

  const viewOptions = [{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }, { value: 'insights', label: 'Insights' }];
  const head = (
    <PageHeader
      variant="page"
      title={label}
      info="Every risk assessment of the organisation: campaigns over risks from the register, and questionnaires built on a framework. Open one to score its risks or answer its questions."
      meta={noList || loading ? undefined : `${formatCount(total ?? rows.length)} ${(total ?? rows.length) === 1 ? 'assessment' : 'assessments'}${cut ? ` (showing ${formatCount(rows.length)})` : ''}`}
      actions={canWrite ? <Menu label="New assessment" items={newItems} /> : undefined}
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
            {registerQ.isError && !noList && (
              <ErrorState compact title="Couldn't refresh the assessments" message={`${errorMessage(registerQ.error)} What is shown may be out of date.`} onRetry={canRetry(registerQ.error) ? () => { void registerQ.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
            )}
            {cut && <Notice tone="info" title="Only part of the list is loaded">The latest {formatCount(rows.length)} of {formatCount(total ?? rows.length)} assessments are shown. Filter to narrow it down.</Notice>}
            {missingOpen && (
              <Notice tone="warning" title="That assessment is not in the list" action={<Button variant="ghost" onClick={() => setOpen(null)}>Dismiss</Button>}>
                It may have been deleted, or you may not be allowed to see it.
              </Notice>
            )}
          </>
        )}
        quick={noList || loading ? [] : quick}
        onQuick={onQuick}
        quickLabel="Counters"
        search={filters.search}
        onSearch={(q) => setFilters({ ...filters, search: q })}
        searchLabel="Search assessments by name, owner or framework"
        searchRef={searchRef}
        views={{ label: 'Assessments view', name: `${uid}-view`, options: viewOptions, value: view, onChange: (v) => setView(v as RegisterView) }}
        actions={view === 'list' ? <Menu label="Sort" items={sortItems} /> : undefined}
        groups={groups}
        onToggle={toggleFacet}
        onClear={clearFacet}
        onClearAll={() => setFilters(NO_FILTERS)}
        filtering={filterCount(filters)}
        shown={filtered.length}
        applied={loading || noList ? null : (
          <AppliedFilters
            chips={chips.map((c) => ({ key: c.key, label: c.label }))}
            summary={`${formatCount(filtered.length)} of ${formatCount(rows.length)} ${rows.length === 1 ? 'assessment' : 'assessments'}`}
            onRemove={(key) => { const chip = chips.find((c) => c.key === key); if (chip) setFilters(removeChip(filters, chip)); }}
            onClear={() => setFilters(NO_FILTERS)}
          />
        )}
        body={body}
        detail={(
          <AssessmentDrawer
            row={openRow}
            onClose={() => setOpen(null)}
            onOpenRow={go}
            canWrite={canWrite}
            onDelete={(r) => { void askDelete(r); }}
            onStep={(dir) => { const next = sorted[openAt + dir]; if (next) setOpen(next); }}
            hasPrev={openAt > 0}
            hasNext={openAt >= 0 && openAt < sorted.length - 1}
          />
        )}
        ready={!loading && !noList}
      />

      {canWrite && <FrameworkPanel open={page.create === 'framework'} onClose={() => setCreate('')} />}
      {canWrite && <ManualPanel open={page.create === 'manual'} onClose={() => setCreate('')} />}
      {canWrite && <ImportPanel open={page.create === 'import'} onClose={() => setCreate('')} />}
      {confirmDialog}
    </>
  );
}
