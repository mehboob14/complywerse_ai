'use client';

/**
 * Task Management > All tasks: the Facet explorer. This file is the Task CONFIGURATION of components/records (RecordExplorer): it owns the data (one complete lean request for every task the
 * person may see, the people), the page's state (filters, sort, grouping, view, page and the task open live in the ADDRESS on the kit's useAddressState, so a link opens the same view), the
 * mutations and what each part draws. What a filter MEANS is taskRecord.ts and taskFacets.ts (the facets and their live counts over components/records/facetEngine.ts, held to the plain
 * filter by a test); the old links (?status= ?priority= ?owner= ?sort= ?view=kanban ...) are taskAddress.ts.
 *
 * The register loads ONCE, whole: every count, facet number, board column and the export are over all the tasks (the response says when it could not hold them all). The old board asked the
 * server for a page, counted the page it had and could not move a task from its Kanban. Every write is reported when the server has answered (useReportedMutation, a failure stays on screen
 * with a Retry); one step of one task changes its row at once without loading the list again.
 */
import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import {
  Button, EmptyState, ErrorState, Menu, Notice, Pager, SkeletonRows, Td, Tr, useAddressState, useNotify, useReportedMutation, type FilterChip, type MenuItem,
} from '@/components/ui/ds';
import { InfoTip } from '@/components/ui/InfoTip';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { AppliedFilters } from '@/components/records/AppliedFilters';
import { BulkBar } from '@/components/records/BulkBar';
import { RecordExplorer } from '@/components/records/RecordExplorer';
import { RecordTable, type RecordItem } from '@/components/records/RecordTable';
import { countOf, evaluate } from '@/components/records/facetEngine';
import { moveCursor, selectAllMatching, tickState, toggleAll, toggleOne } from '@/components/records/explorerModel';
import type { FacetGroupView } from '@/components/records/FacetRail';
import { useExplorerKeys } from '@/components/records/useExplorerKeys';
import { useSelection } from '@/components/records/useSelection';
import { useMyUserId } from '@/components/governance/DocumentTaskActions';
import { criticalTasksApi } from '@/lib/api';
import { formatCount, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { taskStatus } from '@/lib/statuses/tasks';
import { AiPriorities } from '../_AiPriorities';
import { useTenantUsers } from '../_queries';
import type { NextStep, RegisterTask } from '../taskRecord';
import { lastPage, coverage, PAGE_SIZES } from '../tasksModel';
import { REGISTER_SCHEMA, filtersPatch, openPatch, pageOf, type RegisterAddress, type RegisterView } from './taskAddress';
import { TASKS_KEY, patchTask, stepPatch, TASK_REFRESH, useLeanTasks } from './taskData';
import { exportName, toCsv } from './taskExport';
import {
  FACET_TITLE, GROUPS, GROUP_LABEL, NO_FILTERS, OPEN_AT_FIRST, QUICK_IDS, QUICK_LABEL, RAIL_ORDER, SEARCHABLE, SORT_KEYS, SORT_LABEL, chosenOf, filterChips, filterCount, groupOf, groupTasks, indexTasks,
  inQuick, isFiltering, nextSort, orderedOptions, peopleNames, railOptions, removeChip, ruleOf, sortTasks, type FacetKey, type Filters, type GroupBy, type QuickId, type SortKey,
} from './taskFacets';
import { TaskBoard } from './TaskBoard';
import { TaskDrawer } from './TaskDrawer';
import { RowMenu, TaskCard, taskColumns, type RowEnv } from './TaskRows';
import { useBulkTasks } from './BulkTasks';

const RAIL_LIMIT: Partial<Record<FacetKey, number>> = { owner: 7, reviewer: 7, creator: 7, source: 7, category: 7 };
const NONE_ROWS: RegisterTask[] = [];

function download(data: BlobPart, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

type Change = { task: RegisterTask; kind: 'transition'; to: string } | { task: RegisterTask; kind: 'request_approval'; to?: string } | { task: RegisterTask; kind: 'approve' };

export function TaskRegister({ canCreate, onNew }: { canCreate: boolean; onNew: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const notify = useNotify();
  const uid = useId();
  const me = useMyUserId();

  // ── the page's state: in the address ──
  const [address, setAddress] = useAddressState(REGISTER_SCHEMA);
  const page = useMemo(() => pageOf(address as RegisterAddress), [address]);
  const { filters, sort, view, group, openId } = page;
  const setFilters = useCallback((next: Filters) => setAddress(filtersPatch(next)), [setAddress]);
  const setOpenId = useCallback((id: number | null) => setAddress(openPatch(id)), [setAddress]);

  // ── the data ──
  const tasksQ = useLeanTasks();
  const usersQ = useTenantUsers();
  const rows: RegisterTask[] = tasksQ.data?.items ?? NONE_ROWS;
  const total = tasksQ.data?.total;
  const noList = tasksQ.isError && !tasksQ.data;                      // the list could not be read at all: never drawn as an empty register
  const loading = tasksQ.isPending;
  const cover = coverage(rows.length, total);
  const onlyMine = tasksQ.data?.scope === 'mine';
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [tasksQ.data]);
  const ctx = useMemo(() => ({ me, now }), [me, now]);
  const names = useMemo(() => peopleNames(rows, (usersQ.data ?? []).map((u) => ({ id: u.id, display_name: u.display_name || u.username }))), [rows, usersQ.data]);

  // ── the facets: one index of the tasks, one pass for the matches and every live count ──
  const index = useMemo(() => indexTasks(rows, ctx), [rows, ctx]);
  const searched = useDeferredValue(filters.search);
  const applied = useMemo(() => (searched === filters.search ? filters : { ...filters, search: searched }), [filters, searched]);
  const result = useMemo(() => evaluate(index, chosenOf(applied), ruleOf(applied, ctx)), [index, applied, ctx]);
  const filtered = result.matches;
  const filtering = isFiltering(filters);
  const matchKey = useMemo(() => `${filtered.length}:${filtered.reduce((h, t) => (h * 31 + t.id) >>> 0, 7)}`, [filtered]);

  const options = useMemo(() => railOptions(rows, names, ctx), [rows, names, ctx]);
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
    QUICK_IDS.forEach((id) => { out[id] = id === 'all' ? rows.length : rows.reduce((n, t) => n + (inQuick(id, t, ctx) ? 1 : 0), 0); });
    return out;
  }, [rows, ctx]);
  const activeQuick: QuickId = filters.quick ?? 'all';
  const quickNote = (id: QuickId): string | undefined => (me == null && (id === 'mine' || id === 'approve' || id === 'created') ? 'Your account could not be read, so this view is empty.' : undefined);
  const quick: FilterChip[] = QUICK_IDS.map((id) => ({
    key: id, label: QUICK_LABEL[id], active: activeQuick === id, count: quickCounts[id] ?? 0, title: quickNote(id), flag: quickNote(id) ? { label: 'Incomplete', tone: 'warning' as const } : undefined,
  }));
  const onQuick = (id: string) => setFilters({ ...filters, quick: id === 'all' || activeQuick === id ? null : (id as QuickId) });

  // ── the list: sorted, grouped, a page of it ──
  const sorted = useMemo(() => sortTasks(filtered, sort, names), [filtered, sort, names]);
  const ordered = useMemo(() => groupTasks(sorted, group, names, now), [sorted, group, names, now]);
  const size = page.size;
  const pages = lastPage(ordered.length, size);
  const pageNo = Math.min(Math.max(1, page.page), pages);
  useEffect(() => {
    if (!loading && !noList && page.page !== pageNo) setAddress({ page: pageNo });       // a stale address, or a filter that left fewer pages, is the last page
  }, [loading, noList, page.page, pageNo, setAddress]);
  const pageRows = useMemo(() => ordered.slice((pageNo - 1) * size, pageNo * size), [ordered, pageNo, size]);

  // ── ticks, the cursor, the details ──
  const selection = useSelection(matchKey);
  const [cursor, setCursor] = useState<number | null>(null);
  const openRow = openId != null ? rows.find((t) => t.id === openId) ?? null : null;
  const openAt = openRow ? ordered.findIndex((t) => t.id === openRow.id) : -1;
  const missingOpen = openId != null && !loading && !noList && !openRow;
  const ticked = useMemo(() => {
    const matching = new Set(filtered.map((t) => t.id));
    return Array.from(selection.selected).filter((id) => matching.has(id));
  }, [selection.selected, filtered]);

  // ── one step of one task ──
  const change = useReportedMutation({
    mutationFn: async (v: Change) => {
      if (v.kind === 'transition') return (await criticalTasksApi.transition(v.task.id, { new_status: v.to })).data as Record<string, unknown>;
      if (v.kind === 'request_approval') { await criticalTasksApi.requestApproval(v.task.id, { comment: '', ...(v.to ? { transition_to: v.to } : {}) }); return { approval_status: 'Pending' } as Record<string, unknown>; }
      await criticalTasksApi.approveTask(v.task.id, { comment: '' });
      return { approval_status: 'Approved' } as Record<string, unknown>;
    },
    success: (_, v) => {
      const name = truncate(v.task.title, 70).text;
      if (v.kind === 'transition') return { title: `Moved to ${statusPill(taskStatus, v.to).label}`, message: name };
      if (v.kind === 'approve') return { title: 'Task approved', message: name };
      return { title: 'Approval requested', message: v.task.reviewer ? `${v.task.reviewer.display_name ?? 'The reviewer'} can now approve “${name}”.` : 'No reviewer is set yet, so nobody can approve it. Set a reviewer on the task.' };
    },
    failure: "Couldn't update the task",
    invalidate: TASK_REFRESH.filter((k) => k[0] !== 'critical-tasks'),
    onSuccess: (answer, v) => {
      patchTask(qc, v.task.id, stepPatch(answer));
      // a recurring task that was completed makes its next occurrence: that row is not in the list yet
      void qc.invalidateQueries({ queryKey: [...TASKS_KEY], refetchType: v.kind === 'transition' && v.to === 'Completed' && v.task.recurrence_pattern ? 'active' : 'none' });
    },
  });
  const onStep = useCallback((task: RegisterTask, step: NextStep) => {
    if (step.id === 'approve') change.mutate({ task, kind: 'approve' });
    else if (step.id === 'request_approval') change.mutate({ task, kind: 'request_approval', to: step.to });
    else if (step.to) change.mutate({ task, kind: 'transition', to: step.to });
  }, [change]);
  const onMove = useCallback((task: RegisterTask, to: string) => change.mutate({ task, kind: 'transition', to }), [change]);

  // ── rows, handlers ──
  const hrefOf = (id: number) => `/tasks/${id}`;
  const env: RowEnv = { now, me, hrefOf, onPeek: setOpenId, onOpen: (id) => router.push(hrefOf(id)), onStep, onMove, onGo: (href) => router.push(href) };
  const columns = useMemo(() => taskColumns(env), [env.now, env.me]);   // eslint-disable-line react-hooks/exhaustive-deps

  const items: RecordItem<RegisterTask>[] = useMemo(() => {
    const out: RecordItem<RegisterTask>[] = [];
    let last: string | null = null;
    const counts = new Map<string, number>();
    if (group !== 'none') ordered.forEach((t) => { const k = groupOf(t, group, names, now).key; counts.set(k, (counts.get(k) ?? 0) + 1); });
    pageRows.forEach((record, i) => {
      if (group !== 'none') {
        const g = groupOf(record, group, names, now);
        if (g.key !== last || i === 0) {
          const n = counts.get(g.key) ?? 0;
          out.push({
            kind: 'group', id: `${g.key}-${i}`,
            table: (span) => (
              <Tr><Td colSpan={span} className="[&&]:!bg-ds-surface-subtle [&&]:!py-[4px]"><span className="text-ds-label font-[600] text-ds-fg">{g.label}</span><span className="ml-[8px] text-ds-label tabular-nums text-ds-fg-muted">{formatCount(n)}</span></Td></Tr>
            ),
            card: <li className="px-[4px] pt-[8px] text-ds-label font-[600] text-ds-fg">{g.label}<span className="ml-[8px] tabular-nums font-normal text-ds-fg-muted">{formatCount(n)}</span></li>,
          });
          last = g.key;
        }
      }
      out.push({ kind: 'row', id: record.id, record, depth: 0 });
    });
    return out;
  }, [pageRows, ordered, group, names, now]);
  const pageIds = useMemo(() => pageRows.map((t) => t.id), [pageRows]);

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

  // ── export, bulk ──
  const exportRows = (list: readonly RegisterTask[], selectionOnly: boolean) => {
    download(`﻿${toCsv(list)}`, exportName(new Date().toISOString().slice(0, 10), list.length, selectionOnly), 'text/csv;charset=utf-8');
  };
  const bulk = useBulkTasks({
    ids: ticked,
    users: usersQ,
    onDone: selection.clear,
    onExport: () => exportRows(rows.filter((t) => ticked.indexOf(t.id) >= 0), true),
  });

  // ── what the page says ──
  const noun = { one: 'task', other: 'tasks' };
  const chips = filterChips(filters, options);
  const nothing = rows.length === 0;
  const sortItems: MenuItem[] = SORT_KEYS.map((k, i) => ({
    key: `sort:${k}`, label: SORT_LABEL[k], checked: sort.key === k, radio: true, section: i === 0 ? 'Sort by' : undefined,
    trailing: sort.key === k ? (sort.dir === 'asc' ? '↑ ascending' : '↓ descending') : undefined, onSelect: () => setAddress({ sort: nextSort(sort, k as SortKey) }),
  }));
  const groupItems: MenuItem[] = GROUPS.map((g, i) => ({ key: `group:${g}`, label: GROUP_LABEL[g], checked: group === g, radio: true, section: i === 0 ? 'Group by' : undefined, onSelect: () => setAddress({ group: g as GroupBy, page: 1 }) }));
  const selectionApi = view === 'list' ? {
    ticked: selection.selected,
    onToggle: (id: number) => selection.set((s) => toggleOne(s, id)),
    state: tickState(selection.selected, pageIds),
    onToggleAll: () => selection.set((s) => toggleAll(s, pageIds)),
    headLabel: 'Select all tasks on this page',
    rowLabel: (t: RegisterTask) => `Select ${truncate(t.title, 60).text}`,
  } : undefined;

  const body = (() => {
    if (noList) return <ErrorState title="Couldn't load the tasks" message={errorMessage(tasksQ.error)} onRetry={canRetry(tasksQ.error) ? () => { void tasksQ.refetch(); } : undefined} />;
    if (loading) return <div aria-busy="true" className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]"><SkeletonRows rows={10} columns={5} label="Loading the tasks" /></div>;
    if (nothing) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState
            kind="firstUse"
            bare
            title={onlyMine ? 'No tasks for you yet' : 'No tasks yet'}
            info="Tasks you create appear here, with the ones other parts of the platform raise for people: document reviews and acknowledgements, committee actions and regulatory changes."
            action={canCreate ? <Button variant="primary" onClick={onNew}>New task</Button> : undefined}
          />
        </div>
      );
    }
    if (filtered.length === 0) {
      return (
        <div className="rounded-ds-card border border-ds-border bg-ds-surface">
          <EmptyState kind="noMatches" bare title="No tasks match" description="Loosen a filter, or search for other words." onClearFilters={filtering ? () => setFilters(NO_FILTERS) : undefined} />
        </div>
      );
    }
    if (view === 'board') {
      return (
        <div className="relative overflow-clip rounded-ds-card border border-ds-border bg-ds-surface">
          <TaskBoard
            rows={sorted}
            env={env}
            activeId={openId}
            onOpen={setOpenId}
            onShowAll={(statusId) => { setAddress({ ...filtersPatch({ ...filters, status: statusId === 'other' ? [] : [statusId] }), view: 'list' }); }}
          />
        </div>
      );
    }
    return (
      <>
        <RecordTable
          caption="Tasks"
          columns={columns}
          items={items}
          sort={{ key: sort.key, dir: sort.dir }}
          onSort={(key) => setAddress({ sort: nextSort(sort, key as SortKey) })}
          selection={selectionApi}
          activeId={openId}
          cursorId={cursor}
          onActivate={(t) => setOpenId(t.id)}
          actions={(t) => <RowMenu task={t} env={env} />}
          card={(row) => <TaskCard row={row} env={env} />}
        />
        <Pager
          className="mt-[8px]"
          page={pageNo}
          pageSize={size}
          total={ordered.length}
          onPage={(p) => setAddress({ page: p }, { push: true })}
          onPageSize={(n) => setAddress({ size: n, page: 1 })}
          pageSizes={PAGE_SIZES}
          noun={noun}
        />
      </>
    );
  })();

  const viewOptions = [{ value: 'list', label: 'List' }, { value: 'board', label: 'Board' }];
  const head = (
    <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px]">
      {!noList && !loading && <span role="status" className="text-ds-body font-[600] tabular-nums text-ds-fg">{formatCount(total ?? rows.length)} {(total ?? rows.length) === 1 ? noun.one : noun.other}</span>}
      {onlyMine && !noList && (
        <span className="text-ds-body text-ds-fg-muted">
          Your tasks
          <InfoTip text="The ones you own, are assigned to, review or created. People with the View all right on the Task Board see every task in the organization." label="About whose tasks these are" />
        </span>
      )}
    </div>
  );

  // the server refused the whole list (no right to Task Management): its words, once, and no filters or buttons that could only fail
  if (tasksQ.isError && statusOf(tasksQ.error) === 403) return <ErrorState title="Couldn't load the tasks" message={errorMessage(tasksQ.error)} />;

  return (
    <>
      <RecordExplorer
        label="Tasks"
        noun={noun}
        head={head}
        notices={(
          <>
            {tasksQ.isError && !noList && (
              <ErrorState compact title="Couldn't refresh the tasks" message={`${errorMessage(tasksQ.error)} What is shown may be out of date.`} onRetry={canRetry(tasksQ.error) ? () => { void tasksQ.refetch(); } : undefined} className="rounded-ds-card border border-ds-danger-border bg-ds-danger-soft" />
            )}
            {cover.cut && <Notice tone="info" title="Only part of the list is loaded">The first {formatCount(cover.loaded)} of {formatCount(cover.total)} tasks are shown. Filter to narrow it down.</Notice>}
            {missingOpen && (
              <Notice tone="warning" title="That task is not in your list" action={<Button variant="ghost" onClick={() => setOpenId(null)}>Dismiss</Button>}>
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
        searchLabel="Search tasks by title, person, category or source"
        searchRef={searchRef}
        views={{ label: 'Task layout', name: `${uid}-view`, options: viewOptions, value: view, onChange: (v) => setAddress({ view: v as RegisterView }) }}
        actions={(fit) => (
          <>
            <Menu label={group === 'none' ? 'Group' : `Group: ${GROUP_LABEL[group]}`} items={groupItems} />
            {view === 'list' && <Menu label="Sort" items={sortItems} />}
            <Button leftIcon={<Download aria-hidden />} onClick={() => exportRows(sorted, false)} disabled={filtered.length === 0 || loading} title={`Export the ${formatCount(filtered.length)} tasks shown as a spreadsheet`}>
              <span className={fit.tight ? 'sr-only' : undefined}>Export</span>
            </Button>
            <AiPriorities />
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
            summary={`${formatCount(filtered.length)} of ${formatCount(rows.length)} ${rows.length === 1 ? noun.one : noun.other}`}
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
            onSelectAll={() => selection.set(selectAllMatching(filtered.map((t) => t.id)))}
            onClear={selection.clear}
            actions={bulk.actions}
            more={bulk.more}
          />
        ) : undefined}
        detail={(
          <TaskDrawer
            row={openRow}
            env={env}
            onClose={() => setOpenId(null)}
            onStep={(dir) => { const next = ordered[openAt + dir]; if (next) setOpenId(next.id); }}
            hasPrev={openAt > 0}
            hasNext={openAt >= 0 && openAt < ordered.length - 1}
            busy={change.isPending}
          />
        )}
        ready={!loading && !noList}
      />
      {bulk.dialogs}
    </>
  );
}

