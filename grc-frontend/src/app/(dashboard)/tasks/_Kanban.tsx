'use client';

// The Kanban view: one column per status of the workflow, in order, with the tasks of the one request the view makes (the server's first hundred, as the board always showed). A task whose
// status is none of the six (a module wrote its own word) is in a last column of its own, never nowhere. A card is the link that opens the task and says its priority, SLA, source, people
// and due day in words. Wide windows scroll the columns sideways INSIDE the board (a labelled region you can focus and scroll with the arrow keys); a phone stacks them.
import { TONE } from '@/lib/status';
import { taskStatus } from '@/lib/statuses/tasks';
import { formatCount } from '@/lib/format';
import { ErrorState, Skeleton } from '@/components/ui/ds';
import { Owners, PriorityPill, SlaPill, TaskLink, TaskStatusPill, dueLine } from './_ui';
import { kanbanColumns, type TaskRow } from './tasksModel';

function Card({ task, showStatus }: { task: TaskRow; showStatus: boolean }) {
  return (
    <li className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
      <TaskLink id={task.id} title={task.title} />
      <div className="mt-[8px] flex flex-wrap items-center gap-[6px]">
        {showStatus && <TaskStatusPill word={task.status} />}
        <PriorityPill word={task.priority} />
        <SlaPill word={task.sla_status} />
      </div>
      <p className="mt-[8px] text-ds-label text-ds-fg-muted [overflow-wrap:anywhere]">{task.source}</p>
      <div className="mt-[6px] min-w-0"><Owners task={task} /></div>
      <p className="mt-[6px] text-ds-label text-ds-fg-muted">{dueLine(task.due_date)}</p>
    </li>
  );
}

function Column({ status, tasks, other = false }: { status: string; tasks: TaskRow[]; other?: boolean }) {
  const dot = TONE[taskStatus.tone(other ? '' : status)].dot;
  const name = other ? 'Other status' : taskStatus.label(status);
  const scrolls = tasks.length > 3;
  return (
    <section aria-label={`${name}, ${formatCount(tasks.length)} ${tasks.length === 1 ? 'task' : 'tasks'}`} className="min-w-0 rounded-ds-card border border-ds-border bg-ds-surface-hover md:w-[264px] md:shrink-0">
      <header className="flex items-center justify-between gap-[8px] border-t-[3px] px-[12px] py-[10px]" style={{ borderTopColor: dot }}>
        <h3 className="min-w-0 truncate !text-ds-body !font-[600] !text-ds-fg">{name}</h3>
        <span className="rounded-full bg-ds-surface px-[8px] text-ds-label tabular-nums text-ds-fg-muted">{formatCount(tasks.length)}</span>
      </header>
      <ul tabIndex={scrolls ? 0 : undefined} aria-label={scrolls ? `${name} tasks` : undefined} className="m-0 flex list-none flex-col gap-[8px] p-[8px] focus-visible:outline-none focus-visible:shadow-ds-ring md:max-h-[640px] md:overflow-y-auto">
        {tasks.length === 0
          ? <li className="px-[4px] py-[12px] text-center text-ds-body text-ds-fg-muted">No tasks</li>
          : tasks.map((t) => <Card key={t.id} task={t} showStatus={other} />)}
      </ul>
    </section>
  );
}

export function Kanban({ tasks, loading, error }: { tasks: TaskRow[]; loading: boolean; error: { message: string; onRetry?: () => void } | null }) {
  if (error) return <ErrorState title="Couldn't load the tasks" message={error.message} onRetry={error.onRetry} />;
  if (loading) {
    return (
      <div role="status" aria-label="Loading the board" className="flex flex-col gap-[12px] md:flex-row">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[220px] w-full md:w-[264px] md:shrink-0" />)}
      </div>
    );
  }
  const { columns, other } = kanbanColumns(tasks);
  return (
    <div role="region" aria-label="Task board columns" tabIndex={0} className="flex flex-col gap-[12px] focus-visible:outline-none focus-visible:shadow-ds-ring md:flex-row md:overflow-x-auto md:pb-[8px]">
      {columns.map((c) => <Column key={c.status} status={c.status} tasks={c.tasks} />)}
      {other.length > 0 && <Column status="" tasks={other} other />}
    </div>
  );
}
