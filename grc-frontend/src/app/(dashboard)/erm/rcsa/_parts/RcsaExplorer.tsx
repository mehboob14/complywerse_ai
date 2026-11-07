'use client';

// The RCSA registers (campaigns, findings, the template library) on the facet explorer of components/records: ONE configuration layer so three pages do not each carry the
// plumbing. A page hands it its rows, its facets (what the rail counts), its quick views, its columns and the details panel; this holds the search, the chosen facets, the quick view,
// the sort and the open record in the ADDRESS (a link, a reload and Back land where the person was; `?open=ID` opens a record's details), applies them with the shared facet engine
// (one pass gives the matches and every live count), pages the result and draws the kit's explorer. The numbers it shows are the true counts of the complete load the page gives it.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { RecordExplorer } from '@/components/records/RecordExplorer';
import { RecordTable, type RecordColumn, type RecordItem, type RecordRow } from '@/components/records/RecordTable';
import { AppliedFilters } from '@/components/records/AppliedFilters';
import { useExplorerKeys } from '@/components/records/useExplorerKeys';
import { evaluate, countMatching, countOf, indexRows, type FacetSpec } from '@/components/records/facetEngine';
import type { FacetGroupView } from '@/components/records/FacetRail';
import { moveCursor } from '@/components/records/explorerModel';
import type { ExplorerFit } from '@/components/records/explorerFit';
import { Button, EmptyState, ErrorState, Pager, nextSort, sortRows, type SortState, type SortValue, useAddressState } from '@/components/ui/ds';
import { integer, listOf, oneOf, sortOf, text } from '@/lib/addressState';
import { formatCount } from '@/lib/format';

export interface ExplorerFacet<R> {
  key: string;
  label: string;
  /** the values a row has in the facet */
  values: (row: R) => readonly string[];
  /** every option of the rail, in the order to draw them (computed from the rows: a unit that no row has is not offered) */
  options: (rows: readonly R[]) => Array<{ value: string; label: string }>;
  searchable?: boolean;
  defaultOpen?: boolean;
  limit?: number;
}

export interface ExplorerQuick<R> { key: string; label: string; test: (row: R) => boolean }

export interface ExplorerSort<R> { key: string; value: (row: R) => SortValue; firstDir?: 'asc' | 'desc' }

export interface RcsaExplorerProps<R extends { id: number }> {
  /** "Campaigns" */
  label: string;
  noun: { one: string; other: string };
  rows: readonly R[];
  loading: boolean;
  error: { message: string; onRetry?: () => void } | null;
  facets: readonly ExplorerFacet<R>[];
  quick: readonly ExplorerQuick<R>[];
  /** the text the search looks in */
  searchText: (row: R) => string;
  columns: RecordColumn<R>[];
  card: (row: RecordRow<R>) => ReactNode;
  sorts: readonly ExplorerSort<R>[];
  defaultSort: SortState;
  head: (fit: ExplorerFit) => ReactNode;
  /** the toolbar's extra buttons (before Export) */
  actions?: (fit: ExplorerFit) => ReactNode;
  /** what the register shows when nothing exists yet (not when a filter hides everything) */
  empty: ReactNode;
  /** the details panel of the open record (a SidePanel), or null */
  detail: (open: R | null, close: () => void) => ReactNode;
  /** the rows' menu (the last cell of a row, the top right of a card) */
  rowActions?: (row: R) => ReactNode;
  /** CSV of the rows that match the filters (made in the browser) */
  onExport?: (rows: R[]) => void;
  /** a notice above the explorer (a failed refresh, a note) */
  notices?: ReactNode;
  /** the address parameter that names the quick view (default `show`) */
  quickParam?: string;
}

const RESERVED = ['q', 'sort', 'open', 'page'];
const PAGE_SIZES = [25, 50, 100] as const;
const fold = (s: string) => s.toLowerCase();

export function RcsaExplorer<R extends { id: number }>(props: RcsaExplorerProps<R>) {
  const { label, noun, rows, loading, error, facets, quick, searchText, columns, card, sorts, defaultSort, head, actions, empty, detail, rowActions, onExport, notices, quickParam = 'show' } = props;
  const sortKeys = sorts.map((s) => s.key);
  const facetKeys = facets.map((f) => f.key);
  const quickKeys = ['all', ...quick.map((q) => q.key)];
  const sortKey = sortKeys.join(',');
  const facetKey = facetKeys.join(',');
  const quickKey = quickKeys.join(',');
  const schema = useMemo(() => {
    for (const k of facetKeys) if (RESERVED.includes(k) || k === quickParam) throw new Error(`facet "${k}" collides with an address parameter`);
    return {
      q: text(),
      [quickParam]: oneOf(quickKeys, 'all'),
      sort: sortOf(sortKeys, defaultSort),
      open: integer(0, { min: 0 }),
      ...Object.fromEntries(facetKeys.map((k) => [k, listOf()])),
    };
    // the configuration is module-level on every page: its keys are what identify it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortKey, facetKey, quickKey, quickParam]);
  const [address, setAddressTyped] = useAddressState(schema);
  // the schema is built from the page's facets, so its keys are known only at run time: the setter takes any of them
  const setAddress = setAddressTyped as (patch: Record<string, unknown>) => void;
  const chosen = useMemo(() => Object.fromEntries(facetKeys.map((k) => [k, (address as Record<string, string[]>)[k] ?? []])), [address, facetKey]);   // eslint-disable-line react-hooks/exhaustive-deps
  const search = address.q as string;
  const quickChosen = (address as Record<string, string>)[quickParam] ?? 'all';
  const sort = address.sort as SortState;
  const openId = address.open as number;
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(25);
  const [cursor, setCursor] = useState<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const specs: FacetSpec<R>[] = useMemo(() => facets.map((f) => ({ key: f.key, values: f.values })), [facets]);
  const index = useMemo(() => indexRows(rows, specs, (r) => fold(searchText(r))), [rows, specs, searchText]);
  const terms = useMemo(() => fold(search).split(/\s+/).filter(Boolean), [search]);
  const quickDef = quick.find((q) => q.key === quickChosen);
  const rule = useMemo(() => ({ terms, extra: quickDef ? (row: R) => quickDef.test(row) : undefined }), [terms, quickDef]);
  const result = useMemo(() => evaluate(index, chosen, rule), [index, chosen, rule]);

  const sortDef = sort ? sorts.find((s) => s.key === sort.key) : undefined;
  const ordered = useMemo(() => (sort && sortDef ? sortRows(result.matches, sort, (row) => sortDef.value(row)) : result.matches), [result.matches, sort, sortDef]);

  // back to the first page when what is listed changes
  const matchKey = `${ordered.length}:${search}:${quickChosen}:${JSON.stringify(chosen)}:${sort?.key}${sort?.dir}`;
  const lastKey = useRef(matchKey);
  useEffect(() => { if (lastKey.current !== matchKey) { lastKey.current = matchKey; setPageNo(1); } }, [matchKey]);
  const pages = Math.max(1, Math.ceil(ordered.length / pageSize));
  const pageClamped = Math.min(pageNo, pages);
  const shown = ordered.slice((pageClamped - 1) * pageSize, pageClamped * pageSize);
  const items: RecordItem<R>[] = shown.map((record) => ({ kind: 'row', id: record.id, record, depth: 0 }));

  const groups: FacetGroupView[] = facets.map((f) => {
    const picked = chosen[f.key] ?? [];
    return {
      key: f.key, label: f.label, chosen: picked.length, searchable: f.searchable, limit: f.limit, defaultOpen: f.defaultOpen,
      options: f.options(rows).map((o) => ({ value: o.value, label: o.label, count: countOf(result.counts, f.key, o.value), checked: picked.includes(o.value) })),
    };
  });
  const toggle = (group: string, value: string) => {
    const cur = chosen[group] ?? [];
    setAddress({ [group]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] });
  };
  const filtering = Object.values(chosen).reduce((n, v) => n + v.length, 0) + (quickChosen !== 'all' ? 1 : 0) + (search.trim() ? 1 : 0);
  const clearAll = () => setAddress({ q: '', [quickParam]: 'all', ...Object.fromEntries(facetKeys.map((k) => [k, []])) });

  const quickChips = [
    { key: 'all', label: 'All', count: countMatching(index, chosen, { terms }), active: quickChosen === 'all' },
    ...quick.map((q) => ({ key: q.key, label: q.label, count: countMatching(index, chosen, { terms, extra: (row: R) => q.test(row) }), active: quickChosen === q.key })),
  ];

  const labelOf = (facet: string, value: string) => facets.find((f) => f.key === facet)?.options(rows).find((o) => o.value === value)?.label ?? value;
  const chips = [
    ...(quickDef ? [{ key: `quick:${quickDef.key}`, label: quickDef.label }] : []),
    ...facets.flatMap((f) => (chosen[f.key] ?? []).map((v) => ({ key: `${f.key}:${v}`, label: `${f.label}: ${labelOf(f.key, v)}` }))),
    ...(search.trim() ? [{ key: 'q', label: `Search: ${search.trim()}` }] : []),
  ];
  const removeChip = (key: string) => {
    if (key === 'q') { setAddress({ q: '' }); return; }
    if (key.startsWith('quick:')) { setAddress({ [quickParam]: 'all' }); return; }
    const at = key.indexOf(':');
    const group = key.slice(0, at);
    const value = key.slice(at + 1);
    setAddress({ [group]: (chosen[group] ?? []).filter((v) => v !== value) });
  };

  const openRow = openId ? (rows.find((r) => r.id === openId) ?? null) : null;
  const setOpen = (id: number | null) => setAddress({ open: id ?? 0 });
  const ids = shown.map((r) => r.id);
  useExplorerKeys({
    onSearch: () => searchRef.current?.focus(),
    onMove: (dir) => setCursor((c) => moveCursor(ids, c, dir)),
    onOpen: () => { if (cursor != null) setOpen(cursor); },
    onEscape: () => { if (openId) setOpen(null); },
  }, !loading && !error);

  const failed = error && rows.length === 0;
  const body = loading ? (
    <RecordTable<R> caption={label} columns={columns} items={[]} sort={sort} onSort={() => undefined} onActivate={() => undefined} card={card} />
  ) : failed ? (
    <ErrorState title={`Couldn't load the ${noun.other}`} message={error?.message} onRetry={error?.onRetry} />
  ) : rows.length === 0 ? (
    <>{empty}</>
  ) : ordered.length === 0 ? (
    <EmptyState kind="noMatches" title={`No ${noun.other} match`} description="Change or clear the filters to see more." onClearFilters={clearAll} />
  ) : (
    <>
      <RecordTable<R>
        caption={label}
        columns={columns}
        items={items}
        sort={sort}
        onSort={(key) => { const def = sorts.find((s) => s.key === key); setAddress({ sort: nextSort(sort, key, 'asc-desc-none', def?.firstDir ?? 'asc') }); }}
        activeId={openId || null}
        cursorId={cursor}
        onActivate={(r) => setOpen(r.id)}
        actions={rowActions}
        card={card}
      />
      <Pager
        className="mt-[8px]"
        page={pageClamped}
        pageSize={pageSize}
        total={ordered.length}
        onPage={setPageNo}
        onPageSize={(n) => { setPageSize(n); setPageNo(1); }}
        pageSizes={PAGE_SIZES}
        noun={noun}
      />
    </>
  );

  return (
    <RecordExplorer
      label={label}
      noun={noun}
      head={head}
      notices={notices}
      quick={rows.length === 0 || loading ? [] : quickChips}
      onQuick={(key) => setAddress({ [quickParam]: key })}
      quickLabel={`${label} quick views`}
      search={search}
      onSearch={(q) => setAddress({ q })}
      searchLabel={`Search the ${noun.other}`}
      searchRef={searchRef}
      actions={(fit) => (
        <>
          {actions?.(fit)}
          {onExport && (
            <Button leftIcon={<Download aria-hidden />} onClick={() => onExport(ordered)} disabled={ordered.length === 0 || loading} title="Download the rows that match as a CSV file">
              <span className={fit.tight ? 'sr-only' : undefined}>Export</span>
            </Button>
          )}
        </>
      )}
      groups={groups}
      onToggle={toggle}
      onClear={(group) => setAddress({ [group]: [] })}
      onClearAll={clearAll}
      filtering={filtering}
      shown={ordered.length}
      applied={loading || rows.length === 0 ? null : (
        <AppliedFilters chips={chips} summary={`${formatCount(ordered.length)} of ${formatCount(rows.length)} ${rows.length === 1 ? noun.one : noun.other}`} onRemove={removeChip} onClear={clearAll} />
      )}
      body={body}
      detail={detail(openRow, () => setOpen(null))}
      ready={!loading && !failed}
    />
  );
}

