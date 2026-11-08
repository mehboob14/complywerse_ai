'use client';

/**
 * The Requirements tab of a framework journey: the Facet explorer. This file is the requirements CONFIGURATION of components/records (RecordExplorer): it owns the page's state (the
 * filters, the order and the view live in the ADDRESS, so a link opens the same view), the ticks, the bulk actions and what each part draws. What a filter MEANS is reqModel.ts and
 * reqFacets.ts (the facets and their live counts, over components/records/facetEngine.ts, held to the plain filter by a test); the journey page keeps the data (the whole list of
 * requirements, loaded once for every tab) and the requirement that is open (`?req=`), and hands them here.
 * The old tab showed the requirements as a spine of sections with an accordion each, a popup that was 90vh of hand-made modal, three dropdowns for filters and no way to see "what is
 * mine", "what waits for a reviewer" or to give twenty requirements to one person. This one has the filters with their counts, a Board, a bulk bar, and the details in a drawer.
 */
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ListChecks, ShieldCheck, ShieldOff, UserPlus } from 'lucide-react';
import { Button, EmptyState, ErrorState, Menu, Notice, Pager, SkeletonRows, useAddressState, type FilterChip, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { AppliedFilters } from '@/components/records/AppliedFilters';
import { BoardColumns } from '@/components/records/BoardColumns';
import { BulkBar, type BulkActionDef } from '@/components/records/BulkBar';
import { RecordExplorer } from '@/components/records/RecordExplorer';
import { RecordTable } from '@/components/records/RecordTable';
import { countOf, evaluate } from '@/components/records/facetEngine';
import { groupBoard, moveCursor, selectAllMatching, tickState, toggleAll, toggleOne } from '@/components/records/explorerModel';
import type { FacetGroupView } from '@/components/records/FacetRail';
import { useExplorerKeys } from '@/components/records/useExplorerKeys';
import { useSelection } from '@/components/records/useSelection';
import { formatCount, truncate } from '@/lib/format';
import { requirementState } from '@/lib/statuses/frameworkJourney';
import type { CertificationControl, ControlStructure } from '@/types';
import type { ScopeRecord } from '../_workspace/ScopeTab';
import { BulkOwnersDialog, ScopeAskDialog } from './RequirementDialogs';
import { RequirementDrawer } from './RequirementDrawer';
import { BoardCard, RowMenu, boardCardLabel, listItems, reqColumns, ReqCard, type RowEnv } from './RequirementRows';
import { FACET_TITLE, NO_FILTERS, OPEN_AT_FIRST, RAIL_ORDER, SEARCHABLE, chosenOf, facetWorthShowing, filterChips, filterCount, indexReqs, isFiltering, orderedOptions, railOptions, removeChip, ruleOf, type FacetKey, type Filters } from './reqFacets';
import { REQ_SCHEMA, VIEWS, filtersPatch, pageOf, type ReqAddress, type ViewKey } from './reqAddress';
import {
  QUICK_LABEL, SORT_KEYS, SORT_LABEL, boardDefs, bulkPlan, groupInfos, inQuick, nextSort, sortRows, toRows, withGroups, type BulkKind, type QuickId, type SortKey, type Viewer,
} from './reqModel';
import { useRequirementActions, type BulkOutcome } from './useRequirementActions';
import type { Ticks } from './useCriteriaTicks';

const PAGE_SIZES = [25, 50, 100, 250] as const;
const QUICK_SHOWN: QuickId[] = ['all', 'mine', 'needs_evidence', 'review', 'unassigned', 'critical'];
const RAIL_LIMIT: Partial<Record<FacetKey, number>> = { section: 7, owner: 7 };
const BOARD_LIMIT = 8;
const NOUN = { one: 'requirement', other: 'requirements' };

export interface PersonRef { id: number; display_name?: string | null; username?: string | null; email?: string | null }

export interface RequirementsTabProps {
  journeyId: number;
  /** the journey: the standard's own structure (`control_structure`) groups the list under its families */
  journey: { control_structure?: unknown } | null;
  frameworkLabel: string;
  /** "Requirements" or "Controls": what the framework calls them */
  entityLabelPlural: string;
  controls: CertificationControl[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  users: readonly PersonRef[] | undefined;
  currentUserId: number | null;
  appFwId: number | null;
  records: readonly ScopeRecord[];
  scopeLoading: boolean;
  scopeError: unknown;
  onScopeRetry: () => void;
  rights: { canCreate: boolean; canEdit: boolean; canDelete: boolean };
  /** the requirement open in the drawer (the page keeps it, with `?req=`, so other tabs can open one) */
  openId: number | null;
  onOpen: (id: number | null) => void;
  criteria: { criteriaState: Ticks; toggleCriterion: (control: CertificationControl, index: number) => void };
  /** this tab is the open one: the keys j, k and / belong to it only then (the tab stays in the page while another is open) */
  active: boolean;
  onGoScope: () => void;
}

const nameOf = (u: PersonRef): string => u.display_name || u.username || u.email || `User ${u.id}`;

export function RequirementsTab(props: RequirementsTabProps) {
  const { journeyId, journey, controls, loading, error, onRetry, currentUserId, appFwId, rights, openId, onOpen, criteria, active } = props;
  const [address, setAddress] = useAddressState(REQ_SCHEMA);
  const page = useMemo(() => pageOf(address as unknown as ReqAddress), [address]);
  const { filters, view, sort } = page;
  const setFilters = useCallback((next: Filters) => setAddress(filtersPatch(next)), [setAddress]);
  const setSort = useCallback((next: typeof sort) => setAddress({ sort: next }), [setAddress]);
  const setView = useCallback((next: ViewKey) => setAddress({ view: next }), [setAddress]);

  // ── the data ──
  const people = useMemo(() => (props.users ?? []).map((u) => ({ id: u.id, name: nameOf(u), email: u.email ?? null })), [props.users]);
  const structure = (journey?.control_structure ?? null) as ControlStructure | null;
  const rows = useMemo(() => toRows(controls ?? [], { structure, ticks: criteria.criteriaState, users: people }), [controls, structure, criteria.criteriaState, people]);
  const noList = !!error && !controls;                                       // the list could not be read at all: never drawn as an empty tab
  const viewer: Viewer = useMemo(() => ({ me: currentUserId }), [currentUserId]);
  const hasPriority = useMemo(() => rows.some((r) => r.tier), [rows]);

  // ── the facets: one index of the requirements, one pass for the matches and every live count ──
  const index = useMemo(() => indexReqs(rows), [rows]);
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
  }).filter((g) => facetWorthShowing(g.options.length, g.chosen));
  const toggleFacet = (facet: string, value: string) => {
    const key = facet as FacetKey;
    const cur = filters[key];
    setFilters({ ...filters, [key]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] } as Filters);
  };
  const clearFacet = (facet: string) => setFilters({ ...filters, [facet]: [] } as Filters);

  // ── the quick views, with the number each would show (of the requirements that count) ──
  const quickCounts = useMemo(() => {
    const out: Record<string, number> = {};
    const counted = rows.filter((r) => r.inScope);
    QUICK_SHOWN.forEach((id) => { out[id] = counted.reduce((n, r) => n + (inQuick(id, r, viewer) ? 1 : 0), 0); });
    return out;
  }, [rows, viewer]);
  const activeQuick = filters.quick ?? 'all';
  const quick: FilterChip[] = QUICK_SHOWN.filter((id) => id === 'all' || id === activeQuick || (quickCounts[id] ?? 0) > 0 || id === 'mine').map((id) => ({
    key: id, label: QUICK_LABEL[id], active: activeQuick === id, count: quickCounts[id] ?? 0,
    title: id === 'mine' && currentUserId == null ? 'Your account could not be read, so nothing is counted here.' : undefined,
  }));
  const onQuick = (id: string) => setFilters({ ...filters, quick: id === 'all' || activeQuick === id ? null : (id as QuickId) });

  // ── the list: in the framework's order, a page of it, with the section lines ──
  const sorted = useMemo(() => sortRows(filtered, sort), [filtered, sort]);
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const viewKey = `${matchKey}|${sort.key}:${sort.dir}|${pageSize}`;
  const [seen, setSeen] = useState(viewKey);
  if (seen !== viewKey) { setSeen(viewKey); setPageNo(1); }
  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const pageClamped = Math.min(Math.max(1, pageNo), pages);
  const pageRows = useMemo(() => sorted.slice((pageClamped - 1) * pageSize, pageClamped * pageSize), [sorted, pageClamped, pageSize]);
  const structured = structure !== null;
  const infos = useMemo(() => groupInfos(filtered, structure), [filtered, structure]);
  const items = useMemo(() => listItems(sort.key === 'order' ? withGroups(pageRows, infos, structured) : pageRows.map((row) => ({ kind: 'row' as const, row }))), [pageRows, infos, sort.key, structured]);
  const pageIds = useMemo(() => pageRows.map((r) => r.id), [pageRows]);

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

  // what to do with the ones a bulk action could not change: they stay ticked for another try
  const afterBulk = useCallback((o: BulkOutcome) => { selection.keep(o.failedIds); selection.set(new Set(o.failedIds)); }, [selection]);
  const actions = useRequirementActions({ journeyId, appFwId, rows, onBulkDone: afterBulk });

  // ── the questions before a change ──
  const [ownersFor, setOwnersFor] = useState<number[] | null>(null);
  const [scopeFor, setScopeFor] = useState<{ ids: number[]; applicable: boolean } | null>(null);
  const ownersRows = useMemo(() => (ownersFor ? rows.filter((r) => ownersFor.includes(r.id)) : []), [ownersFor, rows]);
  const scopeRows = useMemo(() => (scopeFor ? rows.filter((r) => scopeFor.ids.includes(r.id)) : []), [scopeFor, rows]);
  const scopeKind: BulkKind = scopeFor?.applicable ? 'scope_in' : 'scope_out';
  const scopePlan = useMemo(() => bulkPlan(scopeKind, scopeRows), [scopeKind, scopeRows]);
  const askScope = (ids: number[], applicable: boolean) => {
    const bulkKind: BulkKind = applicable ? 'scope_in' : 'scope_out';
    const plan = bulkPlan(bulkKind, rows.filter((r) => ids.includes(r.id)));
    if (plan.ids.length === 0) return;
    // one requirement put back in scope needs no question (as before); anything else asks, with the reason
    if (ids.length === 1 && applicable) {
      const r = rows.find((x) => x.id === ids[0]);
      if (r) actions.askScope.mutate({ control: { id: r.id, parsedId: r.parsedId }, applicable: true, justification: '' });
      return;
    }
    setScopeFor({ ids: plan.ids, applicable });
  };
  const sendScope = (justification: string) => {
    if (!scopeFor) return;
    const targets = scopeRows.filter((r) => scopePlan.ids.includes(r.id));
    if (targets.length === 1 && !scopeFor.applicable) {
      actions.askScope.mutate({ control: { id: targets[0].id, parsedId: targets[0].parsedId }, applicable: false, justification }, { onSuccess: () => setScopeFor(null) });
      return;
    }
    actions.bulkScope.mutate(
      { kind: scopeKind as Exclude<BulkKind, 'assign'>, items: targets.map((r) => ({ id: r.id, parsedId: r.parsedId })), justification, skipped: scopePlan.skipped, why: scopePlan.why },
      { onSuccess: () => setScopeFor(null) },
    );
  };

  const hrefOf = (id: number) => `/frameworks/${journeyId}?tab=controls&req=${id}`;
  const env: RowEnv = { hrefOf, onPeek: (id) => onOpen(id), canAssign: rights.canEdit, canScope: !!appFwId, onAssign: (id) => setOwnersFor([id]), onScope: (id) => { const r = rows.find((x) => x.id === id); if (r) askScope([id], !r.inScope); } };
  const columns = useMemo(() => reqColumns(env, hasPriority), [hasPriority, rights.canEdit, appFwId, rows, journeyId]);   // eslint-disable-line react-hooks/exhaustive-deps -- env's callbacks only call setters

  const searchRef = useRef<HTMLInputElement>(null);
  useExplorerKeys({
    onSearch: () => searchRef.current?.focus(),
    onMove: (dir) => setCursor((c) => moveCursor(pageIds, c, dir)),
    onOpen: () => { if (cursor != null) onOpen(cursor); },
    onEscape: () => { if (selection.selected.size > 0) selection.clear(); },
  }, active && view === 'list');
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
  const ownersPlan = bulkPlan('assign', tickedRows);
  const outPlan = bulkPlan('scope_out', tickedRows);
  const inPlan = bulkPlan('scope_in', tickedRows);
  const bulkDefs: BulkActionDef[] = [
    ...(rights.canEdit ? [{ id: 'assign', label: 'Assign owners', icon: UserPlus, onRun: () => setOwnersFor(ownersPlan.ids) }] : []),
    ...(appFwId ? [{ id: 'scope_out', label: 'Ask to leave the scope', icon: ShieldOff, disabled: outPlan.ids.length === 0, reason: outPlan.ids.length === 0 ? 'They are all out of scope already' : undefined, onRun: () => askScope(outPlan.ids, false) }] : []),
  ];
  const bulkMore: MenuItem[] = appFwId ? [{ key: 'scope_in', label: 'Ask to put back in scope', icon: ShieldCheck, disabled: inPlan.ids.length === 0, reason: inPlan.ids.length === 0 ? 'They are all in scope already' : undefined, onSelect: () => askScope(inPlan.ids, true) }] : [];
  const selectionApi = {
    ticked: selection.selected,
    onToggle: (id: number) => selection.set((s) => toggleOne(s, id)),
    state: tickState(selection.selected, pageIds),
    onToggleAll: () => selection.set((s) => toggleAll(s, pageIds)),
    headLabel: `Select all ${props.entityLabelPlural.toLowerCase()} on this page`,
    rowLabel: (r: { code: string; name: string }) => `Select ${r.code} ${truncate(r.name, 60).text}`,
  };

  const board = useMemo(() => {
    const defs = boardDefs(filtered, (s) => requirementState.label(s));
    return groupBoard(filtered, defs).filter((c) => c.id !== 'other' || c.rows.length > 0);
  }, [filtered]);
  const showAll = (column: string) => {
    if (column === 'out') setFilters({ ...filters, scope: ['out'] });
    else setFilters({ ...filters, status: [column] });
    setView('list');
  };

  const body = (() => {
    if (noList) return <ErrorState title={`Couldn't load the ${props.entityLabelPlural.toLowerCase()}`} message={errorMessage(error)} onRetry={canRetry(error) ? onRetry : undefined} />;
    if (loading) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={10} columns={4} label={`Loading the ${props.entityLabelPlural.toLowerCase()}`} /></div>;
    if (nothing) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="firstUse" bare icon={ListChecks} title={`No ${props.entityLabelPlural.toLowerCase()} yet`} description="The framework's requirements appear here once the journey has them." />
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="noMatches" bare title={`No ${props.entityLabelPlural.toLowerCase()} match`} description="Loosen a filter, or search for other words." onClearFilters={filtering ? () => setFilters(NO_FILTERS) : undefined} />
        </div>
      );
    }
    if (view === 'board') {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <BoardColumns
            columns={board}
            getId={(r) => r.id}
            renderCard={(r) => <BoardCard row={r} />}
            cardLabel={boardCardLabel}
            onOpen={(r) => onOpen(r.id)}
            activeId={openId}
            limit={BOARD_LIMIT}
            onShowAll={showAll}
            label="Requirements by status"
          />
        </div>
      );
    }
    return (
      <>
        <RecordTable
          caption={props.entityLabelPlural}
          columns={columns}
          items={items}
          sort={{ key: sort.key, dir: sort.dir }}
          onSort={(key) => setSort(nextSort(sort, key as SortKey))}
          selection={selectionApi}
          activeId={openId}
          cursorId={cursor}
          onActivate={(r) => onOpen(r.id)}
          actions={(r) => <RowMenu row={r} env={env} />}
          card={(row) => <ReqCard row={row} />}
        />
        <Pager className="mt-[8px]" page={pageClamped} pageSize={pageSize} total={sorted.length} onPage={setPageNo} onPageSize={setPageSize} pageSizes={PAGE_SIZES} noun={NOUN} />
      </>
    );
  })();

  return (
    <>
      <RecordExplorer
        label={props.entityLabelPlural}
        noun={NOUN}
        head={null}
        notices={(
          <>
            {!!error && !noList && (
              <ErrorState compact title={`Couldn't refresh the ${props.entityLabelPlural.toLowerCase()}`} message={`${errorMessage(error)} What is shown may be out of date.`} onRetry={canRetry(error) ? onRetry : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
            )}
            {missingOpen && (
              <Notice tone="warning" title="That requirement is not here" action={<Button variant="ghost" onClick={() => onOpen(null)}>Dismiss</Button>}>
                The address names a requirement this journey does not have.
              </Notice>
            )}
          </>
        )}
        quick={noList || loading || nothing ? [] : quick}
        onQuick={onQuick}
        quickLabel="Quick views"
        search={filters.search}
        onSearch={(q) => setFilters({ ...filters, search: q })}
        searchLabel={`Search the ${props.entityLabelPlural.toLowerCase()} by code, name, text, section or owner`}
        searchRef={searchRef}
        views={{ label: 'Show as', name: 'req-view', options: VIEWS.map((v) => ({ value: v, label: v === 'list' ? 'List' : 'Board' })), value: view, onChange: (v) => setView(v as ViewKey) }}
        actions={view === 'list' ? <Menu label="Sort" items={sortItems} /> : null}
        groups={groups}
        onToggle={toggleFacet}
        onClear={clearFacet}
        onClearAll={() => setFilters(NO_FILTERS)}
        filtering={filterCount(filters)}
        shown={filtered.length}
        applied={loading || noList ? null : (
          <AppliedFilters
            chips={chips.map((c) => ({ key: c.key, label: c.label }))}
            summary={`${formatCount(filtered.length)} of ${formatCount(rows.filter((r) => r.inScope).length)} ${rows.length === 1 ? NOUN.one : NOUN.other}`}
            onRemove={(key) => { const chip = chips.find((c) => c.key === key); if (chip) setFilters(removeChip(filters, chip)); }}
            onClear={() => setFilters(NO_FILTERS)}
          />
        )}
        body={body}
        bulk={!loading && view === 'list' && ticked.length > 0 && bulkDefs.length > 0 ? (fit) => (
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
          <RequirementDrawer
            row={openRow}
            onClose={() => onOpen(null)}
            onStep={(dir) => { const next = sorted[openAt + dir]; if (next) onOpen(next.id); }}
            hasPrev={openAt > 0}
            hasNext={openAt >= 0 && openAt < sorted.length - 1}
            frameworkLabel={props.frameworkLabel}
            users={people}
            rights={rights}
            scope={{ appFwId, records: props.records, loading: props.scopeLoading, error: props.scopeError, onRetry: props.onScopeRetry }}
            ticks={criteria.criteriaState}
            onTick={criteria.toggleCriterion}
            actions={actions}
            onAskScope={(r, applicable) => askScope([r.id], applicable)}
            onGoScope={() => { onOpen(null); props.onGoScope(); }}
          />
        )}
        ready={!loading && !noList}
      />
      <BulkOwnersDialog
        open={ownersFor !== null}
        rows={ownersRows}
        users={people}
        pending={actions.bulkAssign.isPending || actions.assign.isPending}
        onClose={() => setOwnersFor(null)}
        onSubmit={(picked, mode) => {
          if (ownersRows.length === 1) {
            const r = ownersRows[0];
            actions.assign.mutate({ controlId: r.id, userIds: mode === 'add' ? Array.from(new Set([...r.ownerIds, ...picked])) : picked }, { onSuccess: () => setOwnersFor(null) });
            return;
          }
          actions.bulkAssign.mutate({ ids: ownersRows.map((r) => r.id), picked, mode, skipped: 0, why: '' }, { onSuccess: () => setOwnersFor(null) });
        }}
      />
      <ScopeAskDialog
        targets={scopeRows.filter((r) => scopePlan.ids.includes(r.id))}
        applicable={!!scopeFor?.applicable}
        pending={actions.askScope.isPending || actions.bulkScope.isPending}
        skipped={scopePlan.skipped > 0 ? { count: scopePlan.skipped, why: scopePlan.why } : undefined}
        onClose={() => setScopeFor(null)}
        onSubmit={sendScope}
      />
    </>
  );
}
