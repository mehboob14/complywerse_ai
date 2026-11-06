'use client';

// My Tasks: the tasks the signed-in person owns, is assigned to or reviews (GET critical-tasks/my-tasks), as four counts and the lists behind them: overdue, active tasks by priority, and the
// ones done recently. It is the Task Management page's "My Tasks" tab and the page at /tasks/my-tasks (the same view, its own head there). The rules are the page's own, unchanged: a task is
// active until it is Completed or Verified, overdue when the server calls it Breached (its due moment has passed), at risk when the server says At Risk. A failed read is an error with the
// server's words, never "No tasks assigned to you"; the lists say how many tasks they hold.
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { criticalTasksApi } from '@/lib/api';
import { formatCount, formatDate } from '@/lib/format';
import { isDocumentTask } from '@/lib/documentTasks';
import { EmptyState, ErrorState, SectionCard, SkeletonRows, StatTile } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { DocumentTaskLink, useMyUserId } from '@/components/governance/DocumentTaskActions';
import { retryRead } from './_queries';
import { PriorityPill, SlaPill, TaskLink, TaskStatusPill, dueLine } from './_ui';
import { COMPLETED_SHOWN, myTasksView, recentlyCompleted, type TaskRow } from './tasksModel';

// the person's own step on a document request sits beside its row, as a button-sized link
const STEP = 'shrink-0 rounded-ds-control border border-ds-border-strong bg-ds-primary-soft px-[8px] py-[4px]';

function Item({ task, meId, done = false }: { task: TaskRow; meId: number | null; done?: boolean }) {
  return (
    <li className="flex flex-col gap-[8px] rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[10px] sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-[8px]">
          {done && <CheckCircle2 aria-hidden className="mt-[2px] h-[16px] w-[16px] shrink-0 text-ds-success" />}
          <TaskLink id={task.id} title={task.title} className={done ? '!text-ds-fg-muted' : undefined} />
        </div>
        <div className="mt-[4px] flex flex-wrap items-center gap-x-[8px] gap-y-[4px] text-ds-label text-ds-fg-muted">
          <TaskStatusPill word={task.status} />
          <span className="[overflow-wrap:anywhere]">{[task.source, task.category].filter(Boolean).join(' · ')}</span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-[8px] sm:justify-end">
        {done
          ? <span className="text-ds-label text-ds-fg-muted">Completed {formatDate(task.completed_at)}</span>
          : <span className="text-ds-label text-ds-fg-muted">{dueLine(task.due_date)}</span>}
        {!done && <SlaPill word={task.sla_status} />}
        {isDocumentTask(task) && <DocumentTaskLink request={task.document_request} meId={meId} className={STEP} />}
      </div>
    </li>
  );
}

const List = ({ children }: { children: ReactNode }) => <ul className="m-0 flex list-none flex-col gap-[8px] p-0">{children}</ul>;

export function MyTasksView() {
  const meId = useMyUserId();
  const q = useQuery<TaskRow[]>({
    queryKey: ['my-tasks'],
    queryFn: async () => (await criticalTasksApi.myTasks()).data,
    retry: retryRead,
  });

  if (q.isPending) {
    return (
      <div className="flex flex-col gap-[16px]" role="status" aria-label="Loading your tasks">
        <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">{['Active', 'Overdue', 'At risk', 'Completed'].map((label) => <StatTile key={label} label={label} value={null} loading />)}</div>
        <SkeletonRows rows={4} columns={3} />
      </div>
    );
  }
  if (q.isError) return <ErrorState title="Couldn't load your tasks" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;

  const all = q.data ?? [];
  if (all.length === 0) {
    return <EmptyState kind="firstUse" title="No tasks assigned to you" info="Tasks you own, are assigned to or review will appear here." />;
  }
  const v = myTasksView(all);
  const recent = recentlyCompleted(v.completed);

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
        <StatTile label="Active" value={formatCount(v.active.length)} unit="tasks" />
        <StatTile label="Overdue" value={formatCount(v.overdue.length)} unit="tasks" tone={v.overdue.length > 0 ? 'danger' : 'default'} info="Active tasks whose due date has passed: the server calls them Breached." />
        <StatTile label="At risk" value={formatCount(v.atRisk.length)} unit="tasks" tone={v.atRisk.length > 0 ? 'warning' : 'default'} info="Active tasks due within the next three days." />
        <StatTile label="Completed" value={formatCount(v.completed.length)} unit="tasks" tone={v.completed.length > 0 ? 'success' : 'default'} />
      </div>

      {v.overdue.length > 0 && (
        <SectionCard id="my-overdue" title="Overdue tasks" meta={`${formatCount(v.overdue.length)} ${v.overdue.length === 1 ? 'task' : 'tasks'}`}>
          <List>{v.overdue.map((t) => <Item key={t.id} task={t} meId={meId} />)}</List>
        </SectionCard>
      )}

      {v.groups.filter((g) => g.tasks.length > 0).map((g) => (
        <SectionCard key={g.priority} id={`my-${g.priority.toLowerCase()}`} title={`${g.priority} priority`} meta={`${formatCount(g.tasks.length)} ${g.tasks.length === 1 ? 'task' : 'tasks'}`} actions={<PriorityPill word={g.priority} />}>
          <List>{g.tasks.map((t) => <Item key={t.id} task={t} meId={meId} />)}</List>
        </SectionCard>
      ))}

      {v.other.length > 0 && (
        <SectionCard id="my-other" title="Other priorities" meta={`${formatCount(v.other.length)} ${v.other.length === 1 ? 'task' : 'tasks'}`} info="Active tasks whose priority is none of Critical, High, Medium or Low.">
          <List>{v.other.map((t) => <Item key={t.id} task={t} meId={meId} />)}</List>
        </SectionCard>
      )}

      {recent.length > 0 && (
        <SectionCard
          id="my-completed"
          title="Recently completed"
          meta={v.completed.length > recent.length ? `The latest ${formatCount(recent.length)} of ${formatCount(v.completed.length)}` : `${formatCount(v.completed.length)} ${v.completed.length === 1 ? 'task' : 'tasks'}`}
          info={`The ${COMPLETED_SHOWN} tasks completed most recently.`}
        >
          <List>{recent.map((t) => <Item key={t.id} task={t} meId={meId} done />)}</List>
        </SectionCard>
      )}
    </div>
  );
}
