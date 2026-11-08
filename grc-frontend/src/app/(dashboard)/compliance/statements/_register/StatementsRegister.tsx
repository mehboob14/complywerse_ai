'use client';

/**
 * Compliance > Statements: the Facet explorer. This file is the Statements CONFIGURATION of components/records (RecordExplorer): it owns the data (every statement, loaded whole), the page's
 * state (filters, sort and the statement open live in the ADDRESS, so a link opens the same view), the bulk action and what each part draws. What a filter MEANS is statementModel.ts;
 * the facets and their live counts are statementFacets.ts over components/records/facetEngine.ts (held to the plain filter by a test).
 * The old page showed 20 statements at a time, searched those 20, took its category options from them and, on a failed load, replaced the whole page with one sentence. This one has every
 * count over every statement, a search over all of them, a "Mine" view, and an error that keeps the page and offers Retry.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, Shield } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, Menu, Notice, Pager, SkeletonRows, type FilterChip, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { AppliedFilters } from '@/components/records/AppliedFilters';
import { BulkBar, type BulkActionDef } from '@/components/records/BulkBar';
import { RecordExplorer } from '@/components/records/RecordExplorer';
import { RecordTable, type RecordItem } from '@/components/records/RecordTable';
import { countOf, evaluate } from '@/components/records/facetEngine';
import { moveCursor, selectAllMatching, tickState, toggleAll, toggleOne } from '@/components/records/explorerModel';
import type { FacetGroupView } from '@/components/records/FacetRail';
import { useExplorerKeys } from '@/components/records/useExplorerKeys';
import { useSelection } from '@/components/records/useSelection';
import { useMyUserId } from '@/components/governance/DocumentTaskActions';
import { usePermissions } from '@/hooks/usePermissions';
import type { AddressState } from '@/lib/addressState';
import { formatCount, truncate } from '@/lib/format';
import { titleFor } from '@/lib/navRegistry';
import { ComplianceStrip } from '@/components/compliance/overview/ComplianceStrip';
import { ConvertDialog } from './ConvertDialog';
import { StatementCard, RowMenu, statementColumns, type RowEnv } from './StatementRows';
import { StatementDrawer } from './StatementDrawer';
import { STATEMENTS_SCHEMA, filtersPatch, openPatch, pageOf, type StatementsAddress } from './statementAddress';
import { useStatements } from './statementData';
import {
  FACET_TITLE, NO_FILTERS, OPEN_AT_FIRST, RAIL_ORDER, SEARCHABLE, chosenOf, filterChips, filterCount, indexStatements, isFiltering, orderedOptions, railOptions, removeChip, ruleOf,
  type FacetKey, type Filters,
} from './statementFacets';
import { QUICK_LABEL, SORT_KEYS, SORT_LABEL, convertPlan, inQuick, nextSort, sortRows, statementTitle, type QuickId, type SortKey, type StatementRow, type Viewer } from './statementModel';

const PAGE_SIZES = [25, 50, 100, 250] as const;
const QUICK_SHOWN: QuickId[] = ['all', 'mine', 'not_assessed', 'non_compliant', 'unassigned'];
const RAIL_LIMIT: Partial<Record<FacetKey, number>> = { category: 7, document: 7, assignee: 7 };
const NO_ROWS: StatementRow[] = [];
const NOUN = { one: 'statement', other: 'statements' };

/** What a failed request says: a refusal says the person has no access, anything else says it could not be loaded, with the server's words. */
function failureWords(error: unknown): { title: string; message: string } {
  if (statusOf(error) === 403) return { title: "You don't have access to the statements", message: 'Ask an administrator to give you access to Compliance.' };
  return { title: "Couldn't load the statements", message: errorMessage(error) };
}

export interface StatementsRegisterProps {
  address: AddressState<typeof STATEMENTS_SCHEMA>;
  setAddress: (patch: Partial<AddressState<typeof STATEMENTS_SCHEMA>>, options?: { push?: boolean }) => void;
}

export function StatementsRegister({ address, setAddress }: StatementsRegisterProps) {
  const router = useRouter();
  const { hasPermission, isAdmin } = usePermissions();
  const canCreate = hasPermission('compliance:statements:create');
  const canEdit = hasPermission('compliance:statements:edit');
  const me = useMyUserId();

  // ── the page's state: in the address ──
  const page = useMemo(() => pageOf(address as unknown as StatementsAddress), [address]);
  const { filters, sort, openId } = page;
  const setFilters = useCallback((next: Filters) => setAddress(filtersPatch(next)), [setAddress]);
  const setSort = useCallback((next: typeof sort) => setAddress({ sort: next }), [setAddress]);
  const setOpenId = useCallback((id: number | null) => setAddress(openPatch(id)), [setAddress]);

  // ── the data ──
  const listQ = useStatements();
  const rows: StatementRow[] = listQ.data?.items ?? NO_ROWS;
  const total = listQ.data?.total;
  const cut = !!listQ.data?.truncated;
  const noList = listQ.isError && !listQ.data;                   // the list could not be read at all: never drawn as an empty register
  const loading = listQ.isPending;
  const viewer: Viewer = useMemo(() => ({ me }), [me]);

  // ── the facets: one index of the statements, one pass for the matches and every live count ──
  const index = useMemo(() => indexStatements(rows), [rows]);
  const searched = useDeferredValue(filters.search);
  const applied = useMemo(() => (searched === filters.search ? filters : { ...filters, search: searched }), [filters, searched]);
  const result = useMemo(() => evaluate(index, chosenOf(applied), ruleOf(applied, viewer)), [index, applied, viewer]);
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
    QUICK_SHOWN.forEach((id) => { out[id] = rows.reduce((n, r) => n + (inQuick(id, r, viewer) ? 1 : 0), 0); });
    return out;
  }, [rows, viewer]);
  const activeQuick = filters.quick ?? 'all';
  const quick: FilterChip[] = QUICK_SHOWN.map((id) => ({
    key: id, label: QUICK_LABEL[id], active: activeQuick === id, count: quickCounts[id] ?? 0,
    title: id === 'mine' && me == null ? 'Your account could not be read, so nothing is counted here.' : undefined,
  }));
  const onQuick = (id: string) => setFilters({ ...filters, quick: id === 'all' || activeQuick === id ? null : (id as QuickId) });

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
  const plan = useMemo(() => convertPlan(tickedRows), [tickedRows]);
  const [converting, setConverting] = useState(false);

  const env: RowEnv = { onPeek: setOpenId, onDocument: (id) => router.push(`/governance/documents/${id}`) };
  const columns = useMemo(() => statementColumns(env), []);      // eslint-disable-line react-hooks/exhaustive-deps -- the env's callbacks only call router / setAddress
  const items: RecordItem<StatementRow>[] = useMemo(() => pageRows.map((record) => ({ kind: 'row' as const, id: record.id, record, depth: 0 })), [pageRows]);
  const pageIds = useMemo(() => pageRows.map((r) => r.id), [pageRows]);

  const searchRef = useRef<HTMLInputElement>(null);
  useExplorerKeys({
    onSearch: () => searchRef.current?.focus(),
    onMove: (dir) => setCursor((c) => moveCursor(pageIds, c, dir)),
    onOpen: () => { if (cursor != null) setOpenId(cursor); },
    onEscape: () => { if (selection.selected.size > 0) selection.clear(); },
  }, true);
  useEffect(() => {
    if (cursor != null) document.querySelector(`[data-record-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // ── what the page says ──
  const chips = filterChips(filters, options);
  const nothing = rows.length === 0;
  const sortItems: MenuItem[] = SORT_KEYS.map((k, i) => ({
    key: `sort:${k}`, label: SORT_LABEL[k], checked: sort.key === k, radio: true, section: i === 0 ? 'Sort by' : undefined,
    trailing: sort.key === k ? (sort.dir === 'asc' ? '↑ ascending' : '↓ descending') : undefined, onSelect: () => setSort(nextSort(sort, k as SortKey)),
  }));
  const bulkDefs: BulkActionDef[] = canCreate ? [{ id: 'convert', label: 'Convert to controls', icon: Shield, onRun: () => setConverting(true) }] : [];
  const selectionApi = {
    ticked: selection.selected,
    onToggle: (id: number) => selection.set((s) => toggleOne(s, id)),
    state: tickState(selection.selected, pageIds),
    onToggleAll: () => selection.set((s) => toggleAll(s, pageIds)),
    headLabel: 'Select all statements on this page',
    rowLabel: (r: StatementRow) => `Select ${truncate(statementTitle(r), 60).text}`,
  };

  const body = (() => {
    if (noList) return <ErrorState {...failureWords(listQ.error)} onRetry={canRetry(listQ.error) ? () => { void listQ.refetch(); } : undefined} />;
    if (loading) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={10} columns={5} label="Loading the statements" /></div>;
    if (nothing) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState
            kind="firstUse" bare icon={FileText} title="No statements yet" description="Statements are the clauses of the policy documents you can read. They appear here once a document has been read for them."
            action={<Button href="/governance/documents">Open the documents</Button>}
          />
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="noMatches" bare title="No statements match" description="Loosen a filter, or search for other words." onClearFilters={filtering ? () => setFilters(NO_FILTERS) : undefined} />
        </div>
      );
    }
    return (
      <>
        <RecordTable
          caption="Policy statements"
          columns={columns}
          items={items}
          sort={{ key: sort.key, dir: sort.dir }}
          onSort={(key) => setSort(nextSort(sort, key as SortKey))}
          selection={selectionApi}
          activeId={openId}
          cursorId={cursor}
          onActivate={(r) => setOpenId(r.id)}
          actions={(r) => <RowMenu row={r} env={env} />}
          card={(row) => <StatementCard row={row} />}
        />
        <Pager className="mt-[8px]" page={pageClamped} pageSize={pageSize} total={sorted.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={NOUN} />
      </>
    );
  })();

  const count = total ?? rows.length;
  const meta = noList || loading ? undefined : `${formatCount(count)} ${count === 1 ? 'statement' : 'statements'}${cut ? ` (showing the newest ${formatCount(rows.length)})` : ''}`;

  return (
    <>
      <RecordExplorer
        label="Policy statements"
        noun={NOUN}
        head={(
          <div className="flex flex-col gap-[12px]">
            <PageHeader
              variant="page"
              title={titleFor('/compliance/statements') ?? 'Statements'}
              info="The clauses of your policy documents and how well the organisation meets each: assess a statement, link evidence, give it an owner, or turn statements into internal controls."
              meta={meta}
            />
            <ComplianceStrip current="statements" />
          </div>
        )}
        notices={(
          <>
            {listQ.isError && !noList && (
              <ErrorState compact title="Couldn't refresh the statements" message={`${errorMessage(listQ.error)} What is shown may be out of date.`} onRetry={canRetry(listQ.error) ? () => { void listQ.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
            )}
            {cut && <Notice tone="info" title="Only part of the statements are loaded">The newest {formatCount(rows.length)} of {formatCount(total ?? rows.length)} statements are shown. Filter to narrow it down.</Notice>}
            {missingOpen && (
              <Notice tone="warning" title="That statement is not here" action={<Button variant="ghost" onClick={() => setOpenId(null)}>Dismiss</Button>}>
                It may have been deleted, or its document may not be visible to you.
              </Notice>
            )}
          </>
        )}
        quick={noList || loading ? [] : quick}
        onQuick={onQuick}
        quickLabel="Quick views"
        search={filters.search}
        onSearch={(q) => setFilters({ ...filters, search: q })}
        searchLabel="Search statements by code, text, document, category or assignee"
        searchRef={searchRef}
        actions={<Menu label="Sort" items={sortItems} />}
        groups={groups}
        onToggle={toggleFacet}
        onClear={clearFacet}
        onClearAll={() => setFilters(NO_FILTERS)}
        filtering={filterCount(filters)}
        shown={filtered.length}
        applied={loading || noList ? null : (
          <AppliedFilters
            chips={chips.map((c) => ({ key: c.key, label: c.label }))}
            summary={`${formatCount(filtered.length)} of ${formatCount(rows.length)} ${rows.length === 1 ? 'statement' : 'statements'}`}
            onRemove={(key) => { const chip = chips.find((c) => c.key === key); if (chip) setFilters(removeChip(filters, chip)); }}
            onClear={() => setFilters(NO_FILTERS)}
          />
        )}
        body={body}
        bulk={!loading && ticked.length > 0 && bulkDefs.length > 0 ? (fit) => (
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
          <StatementDrawer
            row={openRow}
            onClose={() => setOpenId(null)}
            onStep={(dir) => { const next = sorted[openAt + dir]; if (next) setOpenId(next.id); }}
            hasPrev={openAt > 0}
            hasNext={openAt >= 0 && openAt < sorted.length - 1}
            me={me}
            isAdmin={isAdmin}
            canEdit={canEdit}
          />
        )}
        ready={!loading && !noList}
      />
      <ConvertDialog open={converting} rows={tickedRows} plan={plan} onClose={() => setConverting(false)} onDone={() => { setConverting(false); selection.clear(); }} />
    </>
  );
}
