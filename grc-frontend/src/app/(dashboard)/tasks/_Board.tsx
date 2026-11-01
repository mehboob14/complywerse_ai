'use client';

// The Task Board tab: every task the person may see, as a table or a Kanban, with a search, filters, sorting and paging that live in the address (?q= &source= &priority= &status= &category=
// &owner= &sort= &page= &size= &view=) so a link, a reload and Back land where the person was. The list asks the server for the filters, the sort and ONE page of the answer; the count is the
// server's total (it used to say "184 tasks" over a table of 100). What the person may see is the server's rule (administrators and `view_all` see every task, everyone else the tasks they
// take part in); a refused read says so in the server's words. Ticking rows offers the bulk actions (_BulkBar); AI Reprioritize is _AiPriorities.
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { formatCount } from '@/lib/format';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, Checkbox, Combobox, EmptyState, ErrorState, Notice, Pager, SegmentedControl, Select, TextInput, useAddressState } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { useMyUserId } from '@/components/governance/DocumentTaskActions';
import { AiPriorities } from './_AiPriorities';
import { BulkBar } from './_BulkBar';
import { Kanban } from './_Kanban';
import { TaskTable } from './_TaskTable';
import { useDebounced } from './_ui';
import { useTaskList, useTenantUsers } from './_queries';
import {
  BOARD_SCHEMA, FILTER_CATEGORIES, FILTER_SOURCES, KANBAN_LIMIT, PAGE_SIZES, PRIORITIES, STATUSES, coverage, filterCount, lastPage, listParams, pageSizeOf, sortFromHeader, userOptions,
} from './tasksModel';

const FILTER = 'lg:w-[150px]';

export function Board({ canCreate, onNew }: { canCreate: boolean; onNew: () => void }) {
  const [s, set] = useAddressState(BOARD_SCHEMA);
  const meId = useMyUserId();
  const users = useTenantUsers();
  const size = pageSizeOf(s.size);
  const params = useMemo(() => listParams(s), [s]);
  const q = useTaskList(params);
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set<number>());

  // the search box answers at once; the request follows when the person pauses
  const [typed, setTyped] = useState(s.q);
  const settled = useDebounced(typed, 300);
  useEffect(() => { if (settled.trim() !== s.q) set({ q: settled.trim(), page: 1 }); }, [settled]);        // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTyped(s.q); }, [s.q]);                                                              // Back, a link: the address is the truth again

  // ticks belong to what is on screen: another page, filter, sort or view clears them
  const key = JSON.stringify(params);
  useEffect(() => { setSelected(new Set<number>()); }, [key]);

  const data = q.data;
  const tasks = data?.items ?? [];
  const total = data?.total ?? 0;
  const onlyMine = data?.scope === 'mine';
  const loading = q.isPending;
  const failure = q.isError ? { message: errorMessage(q.error, "Couldn't load the tasks."), onRetry: canRetry(q.error) ? () => { void q.refetch(); } : undefined } : null;
  const filters = filterCount(s);

  // a page that no longer exists (a stale address, or a filter that left fewer pages) is the last one
  useEffect(() => {
    if (s.view === 'table' && data && !q.isPlaceholderData && s.page > lastPage(data.total, size)) set({ page: lastPage(data.total, size) });
  }, [data, q.isPlaceholderData, s.page, s.view, size]);                                                   // eslint-disable-line react-hooks/exhaustive-deps

  // the server refused the whole board (no right to Task Management): its words, once, and no filters or buttons that could only fail
  if (q.isError && statusOf(q.error) === 403) return <ErrorState title="Couldn't load the tasks" message={errorMessage(q.error)} />;

  const ownerOptions = userOptions(onlyMine ? data?.owners : users.data);
  const toggle = (id: number) => setSelected((cur) => { const next = new Set<number>(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const ids = tasks.map((t) => t.id);
  const ticked = ids.filter((id) => selected.has(id));
  const clearFilters = () => { setTyped(''); set({ q: '', source: '', priority: '', status: '', category: '', owner: '', page: 1 }); };
  const cover = coverage(tasks.length, total);

  const empty = filters > 0
    ? <EmptyState bare kind="noMatches" title="No tasks match" onClearFilters={clearFilters} />
    : (
      <EmptyState
        bare
        kind="firstUse"
        title={onlyMine ? 'No tasks for you yet' : 'No tasks yet'}
        info="Tasks you create appear here, with the ones other parts of the platform raise for people: document reviews and acknowledgements, committee actions and regulatory changes."
        action={canCreate ? <Button variant="primary" onClick={onNew}>New task</Button> : undefined}
      />
    );

  return (
    <div className="flex flex-col gap-[12px]">
      {onlyMine && (
        <p className="text-ds-body text-ds-fg-muted">
          Your tasks: the ones you own, are assigned to, review or created.
          <InfoTip text="People with the View all right on the Task Board see every task in the organization." label="About whose tasks these are" />
        </p>
      )}

      <div className="flex flex-col gap-[8px] lg:flex-row lg:flex-wrap lg:items-center">
        <TextInput type="search" aria-label="Search tasks" placeholder="Search tasks" leftAdornment={<Search aria-hidden />} value={typed} onChange={(e) => setTyped(e.target.value)} className="lg:w-[240px]" />
        {/* on a phone the five filters are two to a row; from 1024px they join the row of the search box (`contents`) */}
        <div className="grid grid-cols-2 gap-[8px] sm:grid-cols-3 lg:contents">
          <Select aria-label="Source" placeholder="All sources" value={s.source} onChange={(e) => set({ source: e.target.value, page: 1 })} className={FILTER}>
            {FILTER_SOURCES.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
          <Select aria-label="Priority" placeholder="All priorities" value={s.priority} onChange={(e) => set({ priority: e.target.value, page: 1 })} className={FILTER}>
            {PRIORITIES.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
          <Select aria-label="Status" placeholder="All statuses" value={s.status} onChange={(e) => set({ status: e.target.value, page: 1 })} className={FILTER}>
            {STATUSES.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
          <Select aria-label="Category" placeholder="All categories" value={s.category} onChange={(e) => set({ category: e.target.value, page: 1 })} className={FILTER}>
            {FILTER_CATEGORIES.map((v) => <option key={v} value={v}>{v}</option>)}
          </Select>
          <Combobox
            label="Owner"
            clearable
            searchable
            options={ownerOptions}
            value={s.owner || null}
            onChange={(v) => set({ owner: v ?? '', page: 1 })}
            placeholder="All owners"
            searchPlaceholder="Search users"
            emptyText={users.isError && !onlyMine ? 'The people could not be loaded' : 'No matches'}
            className="lg:w-[190px]"
          />
        </div>
        {users.isError && !onlyMine && canRetry(users.error) && <Button size="sm" onClick={() => { void users.refetch(); }}>Retry loading owners</Button>}
        {filters > 0 && <Button variant="ghost" onClick={clearFilters}>Clear filters</Button>}
        <div className="flex flex-wrap items-center gap-[8px] lg:ml-auto">
          <SegmentedControl
            label="Board layout"
            name="task-board-view"
            value={s.view}
            onChange={(view) => set({ view, page: 1 })}
            options={[{ value: 'table', label: 'Table' }, { value: 'kanban', label: 'Kanban' }]}
          />
          <AiPriorities />
        </div>
      </div>

      {ticked.length > 0 && <BulkBar ids={ticked} users={users} onClear={() => setSelected(new Set<number>())} />}

      {s.view === 'kanban' ? (
        <>
          {!loading && !failure && cover.cut && (
            <Notice tone="warning" title={`Showing the first ${formatCount(cover.loaded)} of ${formatCount(cover.total)} tasks`}>
              The columns count the tasks that are loaded ({formatCount(KANBAN_LIMIT)} at most). Narrow the board with the filters to see the rest, or switch to the table, which pages through all of them.
            </Notice>
          )}
          <Kanban tasks={tasks} loading={loading} error={failure} />
        </>
      ) : (
        <>
          {tasks.length > 0 && !failure && (
            <Checkbox
              label={`Select all ${formatCount(tasks.length)} on this page`}
              checked={ticked.length === tasks.length}
              indeterminate={ticked.length > 0 && ticked.length < tasks.length}
              onChange={() => setSelected(ticked.length === tasks.length ? new Set<number>() : new Set<number>(ids))}
              className="self-start"
            />
          )}
          <TaskTable
            caption="Tasks"
            rows={tasks}
            loading={loading}
            error={failure}
            empty={empty}
            sort={s.sort}
            onSort={(next) => set({ sort: sortFromHeader(next), page: 1 })}
            selected={selected}
            onToggle={toggle}
            meId={meId}
            footer={total > 0 ? (
              <Pager page={s.page} pageSize={size} total={total} onPage={(page) => set({ page }, { push: true })} onPageSize={(n) => set({ size: n, page: 1 })} pageSizes={PAGE_SIZES} noun={{ one: 'task', other: 'tasks' }} />
            ) : undefined}
          />
        </>
      )}
    </div>
  );
}
