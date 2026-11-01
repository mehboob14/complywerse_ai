'use client';

// The board's table: the tasks of one page as a register (a table from 768px, cards below) on the kit. A title is the link that opens the task (the only way in, as before) with its category,
// its source and where it came from under it; the columns give way as the window narrows (Created first, then Priority, Owner and Due with its SLA, so a phone gets cards with the facts as
// lines); every header that sorts says which way it sorts, and the sort is the server's (the list asks for it). The tick box of a row selects it for a bulk action.
import type { ReactNode } from 'react';
import { NOT_SET, formatDate } from '@/lib/format';
import { RegisterTable, type RegisterColumn, type SortState } from '@/components/ui/ds';
import { Owners, PriorityPill, SlaPill, SourceNote, TaskLink, TaskStatusPill, TickBox } from './_ui';
import type { TaskRow } from './tasksModel';

export interface TaskTableProps {
  caption: string;
  rows: TaskRow[];
  loading: boolean;
  error: { message: string; onRetry?: () => void } | null;
  empty: ReactNode;
  footer?: ReactNode;
  sort: SortState;
  onSort: (next: SortState) => void;
  selected: ReadonlySet<number>;
  onToggle: (id: number) => void;
  meId: number | null;
}

/** What sits under a title: its category, its source and where it came from. */
function Under({ task, meId }: { task: TaskRow; meId: number | null }) {
  return (
    <div className="mt-[2px] flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-ds-label font-normal text-ds-fg-muted">
      {task.category && <span className="break-words">{task.category}</span>}
      {task.source && <span className="break-words">{task.source}</span>}
      <SourceNote task={task} meId={meId} />
    </div>
  );
}

/** The due day with how the SLA stands under it: the SLA is worked out from the due date, so they are read together. */
function DueSla({ task }: { task: TaskRow }) {
  return (
    <div className="flex flex-col items-start gap-[4px]">
      <span className="whitespace-nowrap">{formatDate(task.due_date, { calendar: true, empty: NOT_SET })}</span>
      <SlaPill word={task.sla_status} />
    </div>
  );
}

export function TaskTable({ caption, rows, loading, error, empty, footer, sort, onSort, selected, onToggle, meId }: TaskTableProps) {
  const columns: RegisterColumn<TaskRow>[] = [
    {
      key: 'select', header: 'Select', width: 'w-[56px]', card: 'hide',
      cell: (t) => <TickBox label={`Select ${t.title}`} checked={selected.has(t.id)} onChange={() => onToggle(t.id)} />,
    },
    {
      key: 'title', header: 'Title', isRowHeader: true, sortable: true,
      cell: (t) => (
        <div className="min-w-0">
          <TaskLink id={t.id} title={t.title} />
          <Under task={t} meId={meId} />
        </div>
      ),
    },
    { key: 'status', header: 'Status', sortable: true, card: 'meta', cell: (t) => <TaskStatusPill word={t.status} /> },
    { key: 'priority', header: 'Priority', priority: 2, sortable: true, card: 'meta', cell: (t) => <PriorityPill word={t.priority} /> },
    { key: 'owner', header: 'Owner', priority: 2, card: 'meta', cell: (t) => <Owners task={t} /> },
    { key: 'due_date', header: 'Due', priority: 2, sortable: true, card: 'meta', cell: (t) => <DueSla task={t} /> },
    {
      key: 'created_at', header: 'Created', priority: 3, sortable: true, firstDir: 'desc',
      cell: (t) => <span className="whitespace-nowrap">{formatDate(t.created_at)}</span>,
    },
  ];

  return (
    <RegisterTable
      caption={caption}
      columns={columns}
      rows={rows}
      getRowId={(t) => t.id}
      sort={sort}
      onSortChange={onSort}
      loading={loading}
      error={error}
      empty={empty}
      footer={footer}
      cardTitle={(t) => (
        <div className="flex min-w-0 items-start gap-[10px]">
          <TickBox label={`Select ${t.title}`} checked={selected.has(t.id)} onChange={() => onToggle(t.id)} />
          <div className="min-w-0 flex-1">
            <TaskLink id={t.id} title={t.title} />
            <Under task={t} meId={meId} />
          </div>
        </div>
      )}
    />
  );
}
