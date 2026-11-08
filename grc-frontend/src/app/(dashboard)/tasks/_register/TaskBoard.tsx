'use client';

/**
 * The register's Board: the tasks in columns by status (the six steps of the workflow, then "Other status" for a word a module wrote), each column with its true count and its first cards,
 * "Show all N" for the rest. A card opens the details; a card's "Move to" menu moves it one step the workflow allows (the server's map; a step the approval gate holds back says so).
 * There is no drag: a keyboard and a finger move a task the same way, through the menu. Where the board's own box has room for two columns they sit side by side and the board scrolls
 * sideways inside its frame; with less, the columns stack. The page scrolls, not the board.
 */
import { useRef } from 'react';
import { clsx } from 'clsx';
import { ArrowRight } from 'lucide-react';
import { Button, Menu, type MenuItem } from '@/components/ui/ds';
import { useContainerWidth } from '@/components/records/useContainerWidth';
import { formatCount, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { taskStatus } from '@/lib/statuses/tasks';
import { approvalGate, type RegisterTask } from '../taskRecord';
import { STATUSES, allowedTransitions } from '../tasksModel';
import { statusValue } from './taskFacets';
import { OwnerCell, PriorityCell, DueCell, subline, type RowEnv } from './TaskRows';

const STACK_BELOW = 520;
const OTHER = 'other';

export interface BoardColumn { id: string; label: string; rows: RegisterTask[] }

/** The tasks in the column of their status, the six steps in the workflow's order and a last column for any other word; every task is in exactly one. */
export function boardColumns(rows: readonly RegisterTask[]): BoardColumn[] {
  const columns: BoardColumn[] = STATUSES.map((s) => ({ id: s, label: statusPill(taskStatus, s).label, rows: [] }));
  const other: BoardColumn = { id: OTHER, label: 'Other status', rows: [] };
  rows.forEach((t) => {
    const column = columns.filter((c) => c.id === statusValue(t.status))[0];
    (column ?? other).rows.push(t);
  });
  return other.rows.length > 0 ? columns.concat([other]) : columns;
}

function MoveMenu({ task, env }: { task: RegisterTask; env: RowEnv }) {
  const items: MenuItem[] = allowedTransitions(task).map((status, i) => {
    const held = approvalGate(task, status);
    return { key: status, label: statusPill(taskStatus, status).label, icon: ArrowRight, section: i === 0 ? 'Move to' : undefined, onSelect: () => env.onMove(task, status), disabled: held, reason: held ? 'Needs approval first' : undefined };
  });
  if (items.length === 0) return null;
  return <Menu label={`Move ${truncate(task.title, 50).text} to another status`} iconOnly items={items} size="sm" />;
}

function Card({ task, env, active, onOpen }: { task: RegisterTask; env: RowEnv; active: boolean; onOpen: (id: number) => void }) {
  const line = subline(task);
  return (
    <li data-record-row={task.id} className={clsx('flex flex-col gap-[6px] rounded-ds-card border px-[10px] py-[8px]', active ? 'border-ds-primary bg-ds-primary-soft' : 'border-ds-border-strong bg-ds-surface')}>
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        aria-current={active ? 'true' : undefined}
        className="min-h-ds-control rounded-ds-control text-left focus-visible:outline-none focus-visible:shadow-ds-ring"
      >
        <span dir="auto" title={task.title} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{task.title}</span>
        {line && <span className="block truncate text-ds-label text-ds-fg-muted">{line}</span>}
      </button>
      <span className="flex min-w-0 flex-wrap items-center gap-x-[8px] gap-y-[4px]">
        <PriorityCell task={task} />
        <DueCell task={task} now={env.now} />
        <span className="ml-auto"><OwnerCell task={task} plain /></span>
      </span>
      {allowedTransitions(task).length > 0 && <span className="flex justify-end"><MoveMenu task={task} env={env} /></span>}
    </li>
  );
}

export interface TaskBoardProps {
  rows: readonly RegisterTask[];
  env: RowEnv;
  activeId: number | null;
  onOpen: (id: number) => void;
  /** "Show all N" of a column: the page narrows to that status and shows the list */
  onShowAll: (statusId: string) => void;
  /** cards shown in a column before "Show all N" */
  limit?: number;
}

export function TaskBoard({ rows, env, activeId, onOpen, onShowAll, limit = 8 }: TaskBoardProps) {
  const box = useRef<HTMLDivElement>(null);
  const width = useContainerWidth(box);
  const stacked = width != null && width < STACK_BELOW;
  const columns = boardColumns(rows);
  return (
    <div ref={box} role="group" aria-label="Tasks by status" className={clsx('grid gap-[10px] overflow-x-auto p-[10px]', stacked ? 'grid-flow-row auto-rows-min' : 'grid-flow-col auto-cols-[minmax(240px,1fr)] items-start')}>
      {columns.map((col) => {
        const shown = col.rows.slice(0, limit);
        return (
          <section key={col.id} aria-label={`${col.label}, ${formatCount(col.rows.length)}`} className="flex min-h-0 min-w-0 flex-col rounded-ds-card border border-ds-border bg-ds-surface-subtle">
            <h3 className="m-0 flex items-center gap-[6px] px-[10px] py-[8px] !text-ds-body !font-[600] !text-ds-fg">
              <span className="min-w-0 flex-1 truncate">{col.label}</span>
              <span className="shrink-0 tabular-nums text-ds-label !font-normal text-ds-fg-muted">{formatCount(col.rows.length)}</span>
            </h3>
            <ul className="m-0 flex min-h-0 list-none flex-col gap-[6px] px-[8px] pb-[8px]">
              {shown.map((t) => <Card key={t.id} task={t} env={env} active={activeId === t.id} onOpen={onOpen} />)}
              {col.rows.length === 0 && <li className="px-[2px] py-[4px] text-ds-label text-ds-fg-muted">No tasks</li>}
              {col.rows.length > shown.length && (
                <li><Button variant="link" size="sm" onClick={() => onShowAll(col.id)}>{`Show all ${formatCount(col.rows.length)}`}</Button></li>
              )}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
