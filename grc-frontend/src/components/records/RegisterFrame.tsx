'use client';

// The frame of the registers built on the Facet explorer (Risk Management's KRIs, incidents and mitigation actions; Issues and corrective actions): ONE implementation of the
// explorer's wiring (components/records). A register hands it its definition (registerModel.RegisterDef: facets, quick chips, sorts, board), its rows, its columns and cards and what the
// details drawer shows; the frame owns the state in the ADDRESS (search, chip, facets, sort, view, page, the open record: a link opens the same view), the live counts, the
// selection, the keyboard layer and the empty / loading / failed states. Every list is read whole (the pages' own request); when the server holds more than came back, a
// notice says how many. Nothing here writes: every action is the register's.
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  EmptyState, ErrorState, IconButton, Menu, NoAccessState, Notice, Pager, SidePanel, SkeletonRows, useAddressState, type FilterChip, type MenuItem,
} from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { AppliedFilters } from './AppliedFilters';
import { BoardColumns } from './BoardColumns';
import { BulkBar, type BulkActionDef } from './BulkBar';
import { RecordExplorer } from './RecordExplorer';
import type { ExplorerFit } from './explorerFit';
import { RecordTable, type RecordColumn, type RecordItem, type RecordRow } from './RecordTable';
import { countOf } from './facetEngine';
import { groupBoard, moveCursor, selectAllMatching, tickState, toggleAll, toggleOne } from './explorerModel';
import type { FacetGroupView } from './FacetRail';
import { useExplorerKeys } from './useExplorerKeys';
import { useSelection } from './useSelection';
import { formatCount } from '@/lib/format';
import {
  PAGE_SIZES, appliedChips, clampPage, evaluateRegister, filterCount, indexRegister, matchKey, nextSort, pageSlice, patchOf, sortRows, stateOf, withoutChip,
  type RegisterDef, type RegisterState, type RegisterView,
} from './registerModel';
import type { Schema } from '@/lib/addressState';

export interface DetailNav {
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  hasPrev: boolean;
  hasNext: boolean;
}

export interface RegisterBulk {
  actions: BulkActionDef[];
  more?: MenuItem[];
}

export interface RegisterFrameProps<R> {
  def: RegisterDef<R>;
  schema: Schema;
  /** names the region and the table */
  label: string;
  rows: readonly R[];
  loading: boolean;
  /** the list could not be read at all */
  error?: unknown;
  onRetry?: () => void;
  /** the list was read once and a later read failed: what is shown is the last answer */
  refreshError?: unknown;
  /** how many the server holds, when it is more than `rows` */
  serverTotal?: number | null;
  head: (fit: ExplorerFit) => ReactNode;
  notices?: ReactNode;
  columns: RecordColumn<R>[];
  card: (row: RecordRow<R>) => ReactNode;
  boardCard: (row: R) => ReactNode;
  boardLabel: (row: R) => string;
  rowActions?: (row: R) => ReactNode;
  /** the drawer of the open record (null: closed); build it with <RecordDetail> */
  detail: (open: R | null, nav: DetailNav) => ReactNode;
  /** the floating bar for the ticked records; without it the rows have no tick boxes */
  bulk?: (ids: number[], clear: () => void) => RegisterBulk;
  /** nothing is registered yet */
  emptyFirst: ReactNode;
  searchLabel: string;
  /** what is said about a refusal (403) */
  noAccess: { title: string; reason: string };
  /** the records a ticked row stands for may be acted on only if this says so */
  tickable?: (row: R) => boolean;
  /** extra buttons at the right of the toolbar */
  actions?: (fit: ExplorerFit) => ReactNode;
  /** the name of one row's tick box for a screen reader: "Select Phishing click rate" */
  rowLabel: (row: R) => string;
}

const rowOf = (id: number | null) => (): HTMLElement | null => {
  if (id == null || typeof document === 'undefined') return null;
  const found = Array.from(document.querySelectorAll<HTMLElement>(`[data-record-row="${id}"]`));
  const row = found.find((r) => r.getClientRects().length > 0) ?? null;
  return row?.querySelector<HTMLElement>('a[href], button') ?? row;
};

/** The drawer of one record: the kit's SidePanel over the list (never docked), previous / next walk the list as it is shown. */
export function RecordDetail({ id, title, subtitle, nav, actions, footer, children }: {
  id: number | null; title: ReactNode; subtitle?: ReactNode; nav: DetailNav; actions?: ReactNode; footer?: ReactNode; children: ReactNode;
}) {
  // the row to give focus back to is the one that WAS open: by the time the panel closes `id` is null again, so the last open one is remembered
  const lastOpen = useRef<number | null>(null);
  if (id != null) lastOpen.current = id;
  return (
    <SidePanel
      open={id != null}
      onClose={nav.onClose}
      title={title}
      subtitle={subtitle}
      dockFrom={Infinity}
      width="md"
      restoreFocus={rowOf(lastOpen.current)}
      actions={(
        <>
          <IconButton label="Previous" aria-disabled={!nav.hasPrev || undefined} onClick={() => { if (nav.hasPrev) nav.onStep(-1); }}><ChevronUp aria-hidden /></IconButton>
          <IconButton label="Next" aria-disabled={!nav.hasNext || undefined} onClick={() => { if (nav.hasNext) nav.onStep(1); }}><ChevronDown aria-hidden /></IconButton>
          {actions}
        </>
      )}
      footer={footer}
    >
      {children}
    </SidePanel>
  );
}

const NONE: readonly number[] = [];
const ALWAYS = (): boolean => true;

export function RegisterFrame<R>(p: RegisterFrameProps<R>) {
  const { def, schema, rows, loading, error } = p;
  const uid = useId();
  const [address, setAddress] = useAddressState(schema);
  const state: RegisterState = useMemo(() => stateOf(def, address), [def, address]);
  const set = useCallback((patch: Partial<Omit<RegisterState, 'chosen'>> & { chosen?: Record<string, string[]> }) => setAddress(patchOf(patch) as never), [setAddress]);
  const [pageSize, setPageSize] = useState<number>(def.pageSize ?? 25);
  const [boardLimit, setBoardLimit] = useState(8);
  const searchRef = useRef<HTMLInputElement>(null);

  // ── the facets and the counts: one index of the rows, one pass for the matches and every number ──
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [rows]);
  const index = useMemo(() => indexRegister(def, rows), [def, rows]);
  const searched = useDeferredValue(state.q);
  const seen = searched === state.q ? state : { ...state, q: searched };
  const { result, quickCounts } = useMemo(() => evaluateRegister(def, index, seen, now), [def, index, seen, now]);
  const ordered = useMemo(() => sortRows(def, result.matches, state.sort), [def, result.matches, state.sort]);
  const ids = useMemo(() => ordered.map((r) => def.idOf(r)), [def, ordered]);
  const key = useMemo(() => matchKey(ids, state.sort), [ids, state.sort]);
  const filtering = filterCount(state);

  const optionLists = useMemo(() => {
    const out: Record<string, Array<{ value: string; label: string }>> = {};
    def.facets.forEach((f) => { out[f.key] = f.options(rows); });
    return out;
  }, [def, rows]);
  const groups: FacetGroupView[] = def.facets.map((f) => {
    const picked = state.chosen[f.key] ?? [];
    return {
      key: f.key, label: f.label, chosen: picked.length, searchable: f.searchable, limit: f.limit, defaultOpen: f.defaultOpen,
      options: optionLists[f.key].map((o) => ({ value: o.value, label: o.label, count: countOf(result.counts, f.key, o.value), checked: picked.includes(o.value) })),
    };
  });
  const toggleFacet = (facet: string, value: string) => {
    const cur = state.chosen[facet] ?? [];
    set({ chosen: { ...state.chosen, [facet]: cur.includes(value) ? cur.filter((v) => v !== value) : cur.concat(value) }, page: 1 });
  };
  const clearAll = () => set({ q: '', quick: 'all', chosen: Object.fromEntries(def.facets.map((f) => [f.key, []])), page: 1 });

  // ── the chips ──
  const quick: FilterChip[] = [
    { key: 'all', label: 'All', count: quickCounts.all, active: state.quick === 'all' },
    ...def.quick.map((c): FilterChip => ({ key: c.key, label: c.label, count: quickCounts[c.key] ?? 0, active: state.quick === c.key, title: c.title })),
  ];
  const onQuick = (k: string) => set({ quick: k === state.quick || k === 'all' ? 'all' : k, page: 1 });

  // ── the page and the board ──
  const pages = clampPage(state.page, ordered.length, pageSize);
  const pageRows = useMemo(() => pageSlice(ordered, pages, pageSize), [ordered, pages, pageSize]);
  const board = useMemo(() => (def.board ? groupBoard(ordered, def.board.columns) : []), [def, ordered]);
  const inBoard = state.view === 'board' && !!def.board;
  const openRow = state.id ? rows.find((r) => def.idOf(r) === state.id) ?? null : null;
  const at = openRow ? ordered.findIndex((r) => def.idOf(r) === state.id) : -1;
  const setOpen = (id: number | null) => set({ id: id ?? 0 });

  // ── ticks and the cursor ──
  const selection = useSelection(key);
  const tickable = p.tickable ?? ALWAYS;
  const pageIds = pageRows.filter(tickable).map((r) => def.idOf(r));
  const tickableIds = useMemo(() => ordered.filter(tickable).map((r) => def.idOf(r)), [ordered, tickable, def]);
  const ticked = useMemo(() => ids.filter((id) => selection.selected.has(id)), [ids, selection.selected]);
  const [cursor, setCursor] = useState<number | null>(null);
  useExplorerKeys({
    onSearch: () => searchRef.current?.focus(),
    onMove: (dir) => setCursor((c) => moveCursor(inBoard ? NONE.slice() : pageRows.map((r) => def.idOf(r)), c, dir)),
    onOpen: () => { if (cursor != null) setOpen(cursor); },
    onEscape: () => { if (selection.selected.size > 0) selection.clear(); },
  }, !inBoard);
  useEffect(() => {
    if (cursor != null) document.querySelector(`[data-record-row="${cursor}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const items: RecordItem<R>[] = pageRows.map((record) => ({ kind: 'row' as const, id: def.idOf(record), record, depth: 0 }));
  const noList = !!error && rows.length === 0;
  const refused = noList && statusOf(error) === 403;
  const noun = def.noun;
  const cut = !loading && !noList && rows.length > 0 && p.serverTotal != null && p.serverTotal > rows.length;      // said once the list is in, never while it is still loading

  const body = (() => {
    if (refused) return <NoAccessState title={p.noAccess.title} reason={p.noAccess.reason} />;
    if (noList) return <ErrorState title={`Couldn't load the ${noun.other}`} message={errorMessage(error)} onRetry={canRetry(error) && p.onRetry ? p.onRetry : undefined} />;
    if (loading) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={10} columns={5} label={`Loading the ${noun.other}`} /></div>;
    if (rows.length === 0) return <div className="rounded-ds-card border border-ds-border bg-ds-surface">{p.emptyFirst}</div>;
    if (ordered.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="noMatches" bare title={`No ${noun.other} match`} description="Try another search, or take a filter off." onClearFilters={filtering > 0 ? clearAll : undefined} />
        </div>
      );
    }
    if (inBoard && def.board) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <BoardColumns
            label={def.board.label}
            columns={board}
            getId={def.idOf}
            activeId={state.id || null}
            cardLabel={p.boardLabel}
            onOpen={(r) => setOpen(def.idOf(r))}
            limit={boardLimit}
            onShowAll={() => setBoardLimit(1000)}
            renderCard={p.boardCard}
          />
        </div>
      );
    }
    return (
      <>
        <RecordTable
          caption={p.label}
          columns={p.columns}
          items={items}
          sort={state.sort}
          onSort={(k) => set({ sort: nextSort(def, state.sort, k), page: 1 })}
          selection={p.bulk ? {
            ticked: selection.selected,
            onToggle: (id) => selection.set((s) => toggleOne(s, id)),
            state: tickState(selection.selected, pageIds),
            onToggleAll: () => selection.set((s) => toggleAll(s, pageIds)),
            headLabel: `Select all ${noun.other} on this page`,
            rowLabel: p.rowLabel,
          } : undefined}
          activeId={state.id || null}
          cursorId={cursor}
          onActivate={(r) => setOpen(def.idOf(r))}
          actions={p.rowActions}
          card={p.card}
        />
        <Pager
          className="mt-[8px]"
          page={pages}
          pageSize={pageSize}
          total={ordered.length}
          onPage={(n) => set({ page: n })}
          onPageSize={(n) => { setPageSize(n); set({ page: 1 }); }}
          pageSizes={PAGE_SIZES}
          noun={noun}
        />
      </>
    );
  })();

  const chips = appliedChips(def, state, (facet) => optionLists[facet] ?? []);
  // a person who may not see this register gets the page head and the reason, not an empty explorer around it
  if (refused) return <div className="flex flex-col gap-[16px]">{p.head({ rail: true, list: null, compact: false, tight: false })}<NoAccessState title={p.noAccess.title} reason={p.noAccess.reason} /></div>;
  const bulk = p.bulk && ticked.length > 0 && !loading ? p.bulk(ticked, selection.clear) : null;
  const viewOptions = [{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }];

  return (
    <RecordExplorer
      label={p.label}
      noun={noun}
      head={p.head}
      notices={(
        <>
          {p.refreshError != null && rows.length > 0 && (
            <ErrorState compact title={`Couldn't refresh the ${noun.other}`} message={`${errorMessage(p.refreshError)} What is shown may be out of date.`} onRetry={canRetry(p.refreshError) && p.onRetry ? p.onRetry : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
          )}
          {cut && (
            <Notice tone="warning" title={`Showing ${formatCount(rows.length)} of ${formatCount(p.serverTotal)} ${noun.other}`}>
              The list is cut here. Filters and counts cover what is shown; narrow it with the filters, or ask an administrator to export the rest.
            </Notice>
          )}
          {p.notices}
        </>
      )}
      quick={noList || loading ? [] : quick}
      onQuick={onQuick}
      quickLabel={`Quick filters for the ${noun.other}`}
      search={state.q}
      onSearch={(q) => set({ q, page: 1 })}
      searchLabel={p.searchLabel}
      searchRef={searchRef}
      views={def.board ? { label: `${p.label} view`, name: `${uid}-view`, options: viewOptions, value: state.view, onChange: (v) => set({ view: v as RegisterView }) } : undefined}
      actions={(fit) => (
        <>
          {!inBoard && (
            <Menu label="Sort" items={def.sorts.map((s, i): MenuItem => ({
              key: `sort:${s.key}`, label: s.label, checked: state.sort.key === s.key, radio: true, section: i === 0 ? 'Sort by' : undefined,
              trailing: state.sort.key === s.key ? (state.sort.dir === 'asc' ? '↑ ascending' : '↓ descending') : undefined,
              onSelect: () => set({ sort: nextSort(def, state.sort, s.key), page: 1 }),
            }))} />
          )}
          {p.actions?.(fit)}
        </>
      )}
      groups={groups}
      onToggle={toggleFacet}
      onClear={(facet) => set({ chosen: { ...state.chosen, [facet]: [] }, page: 1 })}
      onClearAll={clearAll}
      filtering={filtering}
      shown={ordered.length}
      applied={loading || noList || rows.length === 0 ? null : (
        <AppliedFilters
          chips={chips}
          summary={`${formatCount(ordered.length)} of ${formatCount(rows.length)} ${rows.length === 1 ? noun.one : noun.other}`}
          onRemove={(k) => set({ ...withoutChip(state, k), page: 1 } as never)}
          onClear={clearAll}
        />
      )}
      body={body}
      bulk={bulk ? (fit) => (
        <BulkBar
          iconsOnly={fit.compact}
          count={ticked.length}
          matching={tickableIds.length}
          onSelectAll={() => selection.set(selectAllMatching(tickableIds))}
          onClear={selection.clear}
          actions={bulk.actions}
          more={bulk.more}
        />
      ) : undefined}
      detail={p.detail(openRow, {
        onClose: () => setOpen(null),
        onStep: (dir) => { const next = ordered[at + dir]; if (next) setOpen(def.idOf(next)); },
        hasPrev: at > 0,
        hasNext: at >= 0 && at < ordered.length - 1,
      })}
      ready={!loading && !noList}
    />
  );
}
