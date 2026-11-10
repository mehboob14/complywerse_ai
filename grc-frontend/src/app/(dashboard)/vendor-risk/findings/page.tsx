'use client';

// Findings: every gap across all vendors, as the facet explorer, tracked to closure. The register loads ONCE, whole (every finding of the module, not the first 25), so every count, the live
// numbers beside each facet and the export are over all of them. The switch (Open, Accepted, Closed, All) and the quick views (Blocking approval, Overdue, Mine, Unowned, Critical, In
// remediation) are above the list, the facets (severity, domain, owner, vendor, source, about) are in the rail with live counts, a row opens THE finding card in a drawer with every action in
// place (owner, start remediation, close, accept risk, reopen, share, promote), and the vendor's page is one press away for the depth. The state is in the address (scope, search, facets,
// quick views, sort, the open finding); every link that already existed keeps working (?scope=, ?severity=, ?domain=, ?overdue=1). The findings of archived vendors are left out, as the badge
// and the Overview leave them out.
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Download, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, EmptyState, ErrorState, Menu, Notice, Pager, SkeletonRows, useAddressState, type FilterChip, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { nextSort } from '@/components/ui/ds/tableModel';
import { AppliedFilters } from '@/components/records/AppliedFilters';
import { BulkBar, type BulkActionDef } from '@/components/records/BulkBar';
import { RecordExplorer } from '@/components/records/RecordExplorer';
import { RecordTable, type RecordItem } from '@/components/records/RecordTable';
import { countOf, evaluate } from '@/components/records/facetEngine';
import { moveCursor, selectAllMatching, tickState, toggleAll, toggleOne } from '@/components/records/explorerModel';
import type { FacetGroupView } from '@/components/records/FacetRail';
import { useExplorerKeys } from '@/components/records/useExplorerKeys';
import { useSelection } from '@/components/records/useSelection';
import { formatCount, truncate } from '@/lib/format';
import { titleFor } from '@/lib/navRegistry';
import {
  FACET_TITLE, FINDINGS_SCHEMA, NO_FILTERS, OPEN_AT_FIRST, QUICK_HINT, QUICK_IDS, QUICK_LABEL, RAIL_ORDER, SCOPES, SEARCHABLE, SORT_KEYS, SORT_LABEL, chosenOf, csvOf, emptyCopy, exportName,
  filterChips, filterCount, filtersPatch, headLine, inQuick, indexFindings, isFiltering, orderedOptions, pageOf, railOptions, removeChip, ruleOf, sortFindings, toggleFacet,
  type AddressState, type Filters, type QuickId, type Scope, type SortKey,
} from '../_lib/findingsModel';
import FindingDrawer from './_register/FindingDrawer';
import { FindingCard, findingColumns, RowMenu, type RowEnv } from './_register/FindingRows';
import { CEILING, useMeId, useRegister } from './_register/findingData';
import type { RegisterRow } from '../_lib/findingsApi';

const PAGE_SIZES = [25, 50, 100, 250] as const;
const RAIL_LIMIT: Partial<Record<(typeof RAIL_ORDER)[number], number>> = { owner: 7, vendor: 7, engagement: 7, domain: 7 };
const FIRST_DIR: Partial<Record<SortKey, 'asc' | 'desc'>> = { severity: 'desc', raised: 'desc' };
const NONE: RegisterRow[] = [];

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

export default function FindingsRegisterPage() {
  const router = useRouter();
  const uid = useId();
  const me = useMeId();

  // ── the page's state: in the address ──
  const [address, setAddress] = useAddressState(FINDINGS_SCHEMA);
  const page = useMemo(() => pageOf(address as AddressState), [address]);
  const { filters, sort, openId } = page;
  const setFilters = useCallback((next: Filters) => setAddress(filtersPatch(next)), [setAddress]);
  const setOpenId = useCallback((id: number | null) => setAddress({ open: id ?? 0 }), [setAddress]);

  // ── the data: every finding, once ──
  const q = useRegister();
  const rows = q.data?.items ?? NONE;
  const total = q.data?.total;
  const noList = q.isError && !q.data;                       // the register could not be read at all: never drawn as an empty list
  const loading = q.isPending;
  const cut = !!q.data?.truncated;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [q.data]);

  // ── the facets: one index of the findings, one pass for the matches and every live count ──
  const index = useMemo(() => indexFindings(rows), [rows]);
  const searched = useDeferredValue(filters.search);
  const applied = useMemo(() => (searched === filters.search ? filters : { ...filters, search: searched }), [filters, searched]);
  const result = useMemo(() => evaluate(index, chosenOf(applied), ruleOf(applied, me)), [index, applied, me]);
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

  // ── the switch and the quick views, with the number each would show ──
  const scopeCount = (s: Scope): number => (s === 'all' ? ['open', 'accepted', 'closed'].reduce((n, k) => n + countOf(result.counts, 'scope', k), 0) : countOf(result.counts, 'scope', s));
  const quickCounts = useMemo(() => {
    const out: Record<string, number> = {};
    QUICK_IDS.forEach((id) => { out[id] = rows.reduce((n, r) => n + (inQuick(id, r, me) ? 1 : 0), 0); });
    return out;
  }, [rows, me]);
  const quick: FilterChip[] = QUICK_IDS.map((id) => ({
    key: id, label: QUICK_LABEL[id], active: filters.quick.includes(id), count: quickCounts[id] ?? 0,
    title: id === 'mine' && me == null ? 'Your account could not be read, so "Mine" is empty.' : QUICK_HINT[id],
    flag: id === 'mine' && me == null ? { label: 'Incomplete', tone: 'warning' as const } : undefined,
  }));
  const onQuick = (id: string) => setFilters({ ...filters, quick: filters.quick.includes(id as QuickId) ? filters.quick.filter((x) => x !== id) : [...filters.quick, id as QuickId] });

  // ── the list: sorted, a page of it ──
  const sorted = useMemo(() => sortFindings(filtered, sort), [filtered, sort]);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const viewKey = `${matchKey}|${sort.key}:${sort.dir}|${pageSize}`;
  const [seen, setSeen] = useState(viewKey);
  if (seen !== viewKey) { setSeen(viewKey); setPageNo(1); }
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageClamped = Math.min(Math.max(1, pageNo), pages);
  const pageRows = useMemo(() => sorted.slice((pageClamped - 1) * pageSize, pageClamped * pageSize), [sorted, pageClamped, pageSize]);

  // ── ticks, the cursor, the drawer ──
  const selection = useSelection(matchKey);
  const [cursor, setCursor] = useState<number | null>(null);
  const openRow = openId != null ? rows.find((r) => r.id === openId) ?? null : null;
  const openAt = openRow ? sorted.findIndex((r) => r.id === openRow.id) : -1;
  const missingOpen = openId != null && !loading && !noList && !openRow;
  const ticked = useMemo(() => {
    const matching = new Set(filtered.map((r) => r.id));
    return Array.from(selection.selected).filter((id) => matching.has(id));
  }, [selection.selected, filtered]);

  const env: RowEnv = { now, onPeek: setOpenId, go: (href) => router.push(href) };
  const columns = useMemo(() => findingColumns(env), [env.now]);        // eslint-disable-line react-hooks/exhaustive-deps
  const items: RecordItem<RegisterRow>[] = useMemo(() => pageRows.map((record) => ({ kind: 'row' as const, id: record.id, record, depth: 0 })), [pageRows]);
  const pageIds = useMemo(() => pageRows.map((r) => r.id), [pageRows]);

  const searchRef = useRef<HTMLInputElement>(null);
  const lastOpen = useRef<number | null>(null);                  // the row the drawer was opened from: focus goes back to its title when the drawer closes
  if (openId != null) lastOpen.current = openId;
  useExplorerKeys({
    onSearch: () => searchRef.current?.focus(),
    onMove: (dir) => setCursor((c) => moveCursor(pageIds, c, dir)),
    onOpen: () => { if (cursor != null) setOpenId(cursor); },
    onEscape: () => { if (selection.selected.size > 0) selection.clear(); },
  }, true);
  useEffect(() => {
    if (cursor != null) document.querySelector(`[data-record-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  // ── export ──
  const exportRows = (list: readonly RegisterRow[]) => download(csvOf(list), exportName(new Date()), 'text/csv;charset=utf-8');

  // ── what the page says ──
  const label = titleFor('/vendor-risk/findings') ?? 'Findings';
  const noun = { one: 'finding', other: 'findings' };
  const chips = filterChips(filters, options);
  const sortItems: MenuItem[] = SORT_KEYS.map((k, i) => ({
    key: `sort:${k}`, label: SORT_LABEL[k], checked: sort.key === k, radio: true, section: i === 0 ? 'Sort by' : undefined,
    trailing: sort.key === k ? (sort.dir === 'asc' ? '↑ ascending' : '↓ descending') : undefined,
    onSelect: () => setAddress({ sort: nextSort(sort, k, 'asc-desc', FIRST_DIR[k] ?? 'asc') }),
  }));
  const bulkDefs: BulkActionDef[] = [{ id: 'export', label: 'Export selection', icon: Download, onRun: () => exportRows(rows.filter((r) => ticked.includes(r.id))) }];
  const selectionApi = {
    ticked: selection.selected,
    onToggle: (id: number) => selection.set((s) => toggleOne(s, id)),
    state: tickState(selection.selected, pageIds),
    onToggleAll: () => selection.set((s) => toggleAll(s, pageIds)),
    headLabel: 'Select all findings on this page',
    rowLabel: (r: RegisterRow) => `Select ${truncate(r.title || 'finding', 60).text}`,
  };

  const body = (() => {
    if (noList) return <ErrorState title="Couldn't load the findings" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;
    if (loading) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={10} columns={5} label="Loading the findings" /></div>;
    if (rows.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="firstUse" bare icon={ShieldCheck} title="No findings yet" description="Findings are raised from questionnaire scoring, document reviews, missed service levels and by hand on a vendor." />
        </div>
      );
    }
    if (filtered.length === 0) {
      const copy = emptyCopy(filters.scope, filtering);
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind={filtering ? 'noMatches' : 'firstUse'} bare icon={ShieldCheck} title={copy.title} description={copy.hint} onClearFilters={filtering ? () => setFilters({ ...NO_FILTERS, scope: filters.scope }) : undefined} />
        </div>
      );
    }
    return (
      <>
        <RecordTable
          caption="Findings"
          columns={columns}
          items={items}
          sort={{ key: sort.key, dir: sort.dir }}
          onSort={(key) => setAddress({ sort: nextSort(sort, key, 'asc-desc', FIRST_DIR[key as SortKey] ?? 'asc') })}
          selection={selectionApi}
          activeId={openId}
          cursorId={cursor}
          onActivate={(r) => setOpenId(r.id)}
          actions={(r) => <RowMenu row={r} env={env} />}
          card={(row) => <FindingCard row={row} env={env} />}
        />
        <Pager className="mt-[8px]" page={pageClamped} pageSize={pageSize} total={sorted.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={noun} />
      </>
    );
  })();

  const head = (
    <PageHeader
      variant="page"
      title={label}
      info="Every gap found across your vendors, tracked to closure: who owns it, whether it holds a vendor's approval, and when the fix is due. Open one to work it here."
      meta={noList || loading ? undefined : headLine(rows)}
    />
  );

  return (
    <RecordExplorer
      label={label}
      noun={noun}
      head={head}
      notices={(
        <>
          {q.isError && !noList && <ErrorState compact title="Couldn't refresh the findings" message={`${errorMessage(q.error)} What is shown may be out of date.`} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />}
          {cut && <Notice tone="info" title="Only part of the register is loaded">The first {formatCount(rows.length)} of {formatCount(total ?? rows.length)} findings are shown (up to {formatCount(CEILING)}). Open a vendor to see all of its findings.</Notice>}
          {missingOpen && (
            <Notice tone="warning" title="That finding is not in the register" action={<Button variant="ghost" onClick={() => setOpenId(null)}>Dismiss</Button>}>
              It may have been removed, belong to an archived vendor, or you may not be allowed to see it.
            </Notice>
          )}
        </>
      )}
      quick={noList || loading ? [] : quick}
      onQuick={onQuick}
      quickLabel="Quick views"
      search={filters.search}
      onSearch={(value) => setFilters({ ...filters, search: value })}
      searchLabel="Search findings by title, vendor, owner, severity or source"
      searchRef={searchRef}
      views={{
        label: 'Findings to show', name: `${uid}-scope`, value: filters.scope, onChange: (v) => setFilters({ ...filters, scope: v as Scope }),
        options: SCOPES.map((s) => ({ value: s.value, label: loading || noList ? s.label : `${s.label} ${formatCount(scopeCount(s.value))}` })),
      }}
      actions={(fit) => (
        <>
          <Menu label="Sort" items={sortItems} />
          <Button leftIcon={<Download aria-hidden />} onClick={() => exportRows(sorted)} disabled={filtered.length === 0 || loading} title={`Export the ${formatCount(filtered.length)} findings shown as a spreadsheet`}>
            <span className={fit.tight ? 'sr-only' : undefined}>Export</span>
          </Button>
        </>
      )}
      groups={groups}
      onToggle={(facet, value) => setFilters(toggleFacet(filters, facet, value))}
      onClear={(facet) => setFilters({ ...filters, [facet]: [] } as Filters)}
      onClearAll={() => setFilters({ ...NO_FILTERS, scope: filters.scope })}
      filtering={filterCount(filters)}
      shown={filtered.length}
      applied={loading || noList ? null : (
        <AppliedFilters
          chips={chips.map((c) => ({ key: c.key, label: c.label }))}
          summary={`${formatCount(filtered.length)} of ${formatCount(rows.length)} ${rows.length === 1 ? 'finding' : 'findings'}`}
          onRemove={(key) => { const chip = chips.find((c) => c.key === key); if (chip) setFilters(removeChip(filters, chip)); }}
          onClear={() => setFilters({ ...NO_FILTERS, scope: filters.scope })}
        />
      )}
      body={body}
      bulk={!loading && ticked.length > 0 ? (fit) => (
        <BulkBar iconsOnly={fit.compact} count={ticked.length} matching={filtered.length} onSelectAll={() => selection.set(selectAllMatching(filtered.map((r) => r.id)))} onClear={selection.clear} actions={bulkDefs} />
      ) : undefined}
      detail={(
        <FindingDrawer
          row={openRow}
          openId={openId}
          onClose={() => setOpenId(null)}
          onStep={(dir) => { const next = sorted[openAt + dir]; if (next) setOpenId(next.id); }}
          hasPrev={openAt > 0}
          hasNext={openAt >= 0 && openAt < sorted.length - 1}
          restoreFocus={() => (lastOpen.current != null ? document.querySelector<HTMLElement>(`[data-record-row="${lastOpen.current}"] a`) : null)}
        />
      )}
      ready={!loading && !noList}
    />
  );
}
