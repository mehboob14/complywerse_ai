'use client';

// Implementation tasks: a table you can work from (who, when, where it stands), and a drawer that shows and edits everything about one task. The filters are in the address (the Overview's
// "past due" and "nobody assigned" land here that way). Late means not completed with the due day passed, the same reading the register and the Overview count. Each task is also a task in Task Management.
import { useMemo } from 'react';
import { CheckCircle2, ClipboardList, Eye, Plus, Trash2 } from 'lucide-react';
import {
  Button, Checkbox, EmptyState, ErrorState, Menu, Notice, PersonStack, ProgressBar, RegisterTable, Select, StatusPill, TextInput, useConfirm, useReportedMutation, type MenuItem, type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { regulatoryApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { priority, statusPill } from '@/lib/status';
import { optionsOf, taskStatus, taskType } from '@/lib/statuses/regulatory';
import { NO_TASK_FILTERS, taskFiltering, taskFiltersOf, taskPatch, type DetailAddress, type TaskFilters } from '../_lib/detailAddress';
import { usePeople, useObligations, useTasks } from '../_lib/data';
import { assigneesOf, dueWords, isTaskLate } from '../_lib/regulatoryModel';
import type { Task, TaskDraft } from '../_lib/types';
import { REFRESH_TASKS } from './_TaskEditor';

export default function TasksTab({ changeId, address, setAddress, onOpen, today }: { changeId: number; address: DetailAddress; setAddress: (patch: Partial<DetailAddress>) => void; onOpen: (t: Task | TaskDraft) => void; today: Date }) {
  const { confirm, confirmDialog } = useConfirm();
  const tasksQ = useTasks(changeId);
  const obligations = useObligations(changeId);
  const people = usePeople();
  const tasks = useMemo(() => tasksQ.data ?? [], [tasksQ.data]);
  const clauseOf = useMemo(() => new Map((obligations.data ?? []).map((o) => [o.id, o.ref || 'no clause'])), [obligations.data]);

  const filters = taskFiltersOf(address);
  const setFilters = (f: TaskFilters) => setAddress(taskPatch(f));
  const shown = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return tasks.filter((t) => (!filters.status || t.status === filters.status)
      && (!filters.who || (filters.who === 'none' ? assigneesOf(t).length === 0 : assigneesOf(t).includes(Number(filters.who))))
      && (!filters.late || isTaskLate(t, today))
      && (!q || `${t.title} ${t.description || ''}`.toLowerCase().includes(q)));
  }, [tasks, filters.q, filters.status, filters.who, filters.late, today]);  // eslint-disable-line react-hooks/exhaustive-deps
  const filtering = taskFiltering(filters);

  const done = tasks.filter((t) => t.status === 'completed').length;
  const late = tasks.filter((t) => isTaskLate(t, today)).length;
  const unassigned = tasks.filter((t) => t.status !== 'completed' && assigneesOf(t).length === 0).length;

  const invalidate = REFRESH_TASKS(changeId);
  const complete = useReportedMutation({
    mutationFn: (id: number) => regulatoryApi.updateTask(id, { status: 'completed' }), success: 'Task completed', failure: "Couldn't complete the task", invalidate,
  });
  const remove = useReportedMutation({
    mutationFn: (id: number) => regulatoryApi.deleteTask(id), success: 'Task deleted', failure: "Couldn't delete the task", invalidate,
  });
  const askDelete = async (t: Task) => {
    const yes = await confirm({ title: 'Delete this task?', message: `“${t.title}” will be removed from this change, and from Task Management.`, confirmLabel: 'Delete task', tone: 'danger' });
    if (yes) remove.mutate(t.id);
  };

  const rowMenu = (t: Task) => {
    const items: MenuItem[] = [
      { key: 'open', label: 'Open', icon: Eye, onSelect: () => onOpen(t) },
      { key: 'done', label: 'Mark completed', icon: CheckCircle2, onSelect: () => complete.mutate(t.id), hidden: t.status === 'completed' },
      { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: () => { void askDelete(t); } },
    ];
    return <Menu label={`Actions for ${t.title.slice(0, 60)}`} iconOnly items={items} />;
  };
  const assigneeOptions = [{ value: 'none', label: 'Unassigned' }].concat(people.users.map((u) => ({ value: String(u.id), label: u.display_name })));
  const columns: RegisterColumn<Task>[] = [
    {
      key: 'title', header: 'Task', isRowHeader: true,
      cell: (t) => (
        <div className="min-w-0">
          <p className={`m-0 line-clamp-2 text-ds-body font-[600] [overflow-wrap:anywhere] ${t.status === 'completed' ? 'text-ds-fg-muted line-through' : 'text-ds-fg'}`} title={t.title}>{t.title}</p>
          <p className="m-0 text-ds-label text-ds-fg-muted">
            {taskType.label(t.task_type)}
            {t.obligation_id && clauseOf.has(t.obligation_id) && <span className="text-ds-primary-text">{` · Clause ${clauseOf.get(t.obligation_id)}`}</span>}
            {t.assignee_department && ` · ${t.assignee_department}`}
            {t.priority && ` · ${priority.label(t.priority)} priority`}
          </p>
        </div>
      ),
    },
    { key: 'who', header: 'Assignee', priority: 2, cell: (t) => <PersonStack people={(t.assignees || []).map((a) => a.display_name)} label="On this task" size={24} />, card: 'meta' },
    {
      key: 'due', header: 'Due', priority: 2, card: 'meta',
      cell: (t) => {
        if (!t.due_date) return <span className="text-ds-body text-ds-fg-muted">No date</span>;
        const due = dueWords(t.due_date, today);
        const lateNow = isTaskLate(t, today);
        return (
          <span className="block whitespace-nowrap">
            <span className="block text-ds-body text-ds-fg">{formatDate(t.due_date, { calendar: true })}</span>
            {due && t.status !== 'completed' && <span className={`block text-ds-label ${lateNow ? 'font-[600] text-ds-danger' : 'text-ds-fg-muted'}`}>{due.text}</span>}
          </span>
        );
      },
    },
    { key: 'status', header: 'Status', cell: (t) => <StatusPill size="sm" {...statusPill(taskStatus, t.status)} />, card: 'meta' },
    {
      key: 'menu', header: '', width: 'w-[48px]', card: 'hide',
      cell: (t) => rowMenu(t),
    },
  ];

  if (tasksQ.isError && !tasksQ.data) {
    return <ErrorState title="Couldn't load the tasks" message={errorMessage(tasksQ.error)} onRetry={canRetry(tasksQ.error) ? () => { void tasksQ.refetch(); } : undefined} />;
  }

  return (
    <div className="flex flex-col gap-[12px]">
      {tasks.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[6px]">
          <div className="w-[160px]"><ProgressBar value={Math.round((done / tasks.length) * 100)} label="Tasks completed" showValue={false} tone={late > 0 ? 'danger' : 'success'} /></div>
          <span className="text-ds-body text-ds-fg-body"><b className="font-[600] text-ds-fg">{done}</b>{` of ${tasks.length} completed`}</span>
          {unassigned > 0 && <Button variant="link" onClick={() => setFilters({ ...filters, who: 'none' })}>{`${unassigned} unassigned`}</Button>}
          {late > 0 && <Button variant="link" onClick={() => setFilters({ ...filters, late: !filters.late })}><span className="text-ds-danger">{`${late} late`}</span></Button>}
        </div>
      )}

      <div role="search" aria-label="Filter the tasks" className="flex flex-wrap items-end gap-[8px]">
        <TextInput type="search" value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} aria-label="Search tasks" placeholder="Search tasks" autoComplete="off" className="min-w-[160px] max-w-[280px] flex-1" />
        <Select aria-label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className="w-auto">
          <option value="">All statuses</option>{optionsOf(taskStatus).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Select aria-label="Assignee" value={filters.who} onChange={(e) => setFilters({ ...filters, who: e.target.value })} className="w-auto">
          <option value="">Anyone</option>{assigneeOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
        <Checkbox label={`Late only (${late})`} checked={filters.late} onChange={(e) => setFilters({ ...filters, late: e.target.checked })} />
        {filtering && <Button variant="link" onClick={() => setFilters(NO_TASK_FILTERS)}>Show all</Button>}
        <Button className="ml-auto" variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => onOpen({ title: '', task_type: 'process_change', priority: 'medium' })}>Add task</Button>
      </div>
      {people.isError && !people.data && <Notice tone="warning" title="People could not be loaded" action={<Button onClick={() => { void people.refetch(); }}>Retry</Button>}>The assignee filter lists only who is on these tasks until they load.</Notice>}

      <RegisterTable<Task>
        caption="Tasks of this change"
        columns={columns}
        rows={shown}
        getRowId={(t) => t.id}
        onRowActivate={onOpen}
        loading={tasksQ.isPending}
        cardTitle={(t) => <span className={`line-clamp-3 text-ds-body font-[600] [overflow-wrap:anywhere] ${t.status === 'completed' ? 'text-ds-fg-muted line-through' : 'text-ds-fg'}`}>{t.title}</span>}
        cardActions={rowMenu}
        empty={(
          <EmptyState
            kind={filtering ? 'noMatches' : 'firstUse'} bare icon={ClipboardList} title={tasks.length === 0 ? 'No tasks yet' : 'No task matches'}
            description={tasks.length === 0 ? 'Add one, or raise it from an obligation or an impact assessment.' : 'Loosen a filter, or search for other words.'}
            onClearFilters={filtering && tasks.length > 0 ? () => setFilters(NO_TASK_FILTERS) : undefined}
          />
        )}
        footer={filtering && tasks.length > 0 ? <p role="status" className="m-0 text-ds-label text-ds-fg-muted">{`${shown.length} of ${tasks.length} tasks match.`}</p> : undefined}
      />
      {confirmDialog}
    </div>
  );
}
