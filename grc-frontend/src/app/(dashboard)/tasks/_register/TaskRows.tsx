'use client';

/**
 * The rows of the All tasks register, as configuration for records/RecordTable: the columns (Task, Status, Priority, Owner, Due), the card a phone gets, the row's menu. The title is shown
 * in two lines (the whole text is the link's title and the details panel), under it what the task is and where it came from ("Vendor finding · Remediation · 2 of 5 sub-tasks"); the
 * owner is the first person with "+N" for the rest, or "Unassigned"; the due day says in words how late or soon it is. Nothing appears only on hover: every action is in the row's menu,
 * reachable by Tab, Enter and the arrow keys. What a cell says is decided in taskRecord.ts and taskFacets.ts.
 */
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { Menu, PersonChip, PersonStack, StatusPill, type MenuItem } from '@/components/ui/ds';
import { RowLead, type RecordColumn, type RecordRow } from '@/components/records/RecordTable';
import type { FitColumn } from '@/components/records/explorerFit';
import { NOT_SET, formatDate, truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { taskPriority, taskStatus } from '@/lib/statuses/tasks';
import { taskButtons } from '@/lib/documentTasks';
import { KIND_LABEL, approvalGate, dueWords, isDoneStatus, kindOf, nextStep, type NextStep, type RegisterTask } from '../taskRecord';
import { assigneeNames, allowedTransitions } from '../tasksModel';

/** A plain left click; a click with a modifier (or the middle button) belongs to the browser: a new tab. */
const plainClick = (e: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

export const TASK_FIT: Record<'status' | 'priority' | 'owner' | 'due', Omit<FitColumn, 'key'>> = {
  status: { px: 148 },
  priority: { px: 112, dropRank: 2 },
  owner: { px: 104, dropRank: 1, wide: { px: 176, titleMin: 420 } },
  due: { px: 132 },
};

export interface RowEnv {
  now: Date;
  me: number | null;
  hrefOf: (id: number) => string;
  /** the title was pressed: the details open over the list */
  onPeek: (id: number) => void;
  onOpen: (id: number) => void;
  /** a next step (Start, Send for review, Approve ...) or a move to a status, from the menu */
  onStep: (task: RegisterTask, step: NextStep) => void;
  onMove: (task: RegisterTask, status: string) => void;
  /** go to a page (a document request's own step) */
  onGo: (href: string) => void;
}

/** "Vendor finding · Remediation · 2 of 5 sub-tasks": what the task is and where it came from, in one line under its title. */
export function subline(t: RegisterTask): string {
  const kind = kindOf(t);
  return [t.source_label || (kind === 'task' ? null : KIND_LABEL[kind]), t.category, t.sub_task_total ? `${t.sub_task_done ?? 0} of ${t.sub_task_total} sub-tasks` : null].filter(Boolean).join(' · ');
}

function TaskTitle({ row, env }: { row: RecordRow<RegisterTask>; env: RowEnv }) {
  const t = row.record;
  const line = subline(t);
  return (
    <div className="min-w-0">
      <div dir="auto" className="line-clamp-2 min-w-0 text-ds-body [overflow-wrap:anywhere]">
        <Link
          href={env.hrefOf(t.id)}
          prefetch={false}
          title={t.title}
          onClick={(e) => { e.stopPropagation(); if (plainClick(e)) { e.preventDefault(); env.onPeek(t.id); } }}
          className="scroll-mt-[44px] rounded-ds-control py-[1px] font-[600] text-ds-fg hover:text-ds-primary-text hover:underline focus-visible:bg-ds-primary-soft focus-visible:text-ds-primary-text focus-visible:underline focus-visible:outline-none"
        >
          {t.title}
        </Link>
      </div>
      {line && <p className="m-0 truncate text-ds-label text-ds-fg-muted" title={line}>{line}</p>}
    </div>
  );
}

export const StatusCell = ({ task }: { task: RegisterTask }) => <StatusPill size="sm" {...statusPill(taskStatus, task.status)} />;
export const PriorityCell = ({ task }: { task: RegisterTask }) => <StatusPill size="sm" {...statusPill(taskPriority, task.priority)} />;

/** Everyone on the task: the first person (by name when the column is wide, else the avatar with the name in its tooltip) and "+N" for the others; "Unassigned" for nobody. In a table row "+N" is
 *  the kit's button that lists the rest; in a card (which is itself a button) and on a board card it is words with the names as its tooltip: the details list everyone. */
export function OwnerCell({ task, withName = false, plain = false }: { task: RegisterTask; withName?: boolean; plain?: boolean }) {
  const names = assigneeNames(task);
  if (names.length === 0) return <PersonChip name={null} />;
  const rest = names.slice(1);
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-[6px]" title={names.join(', ')}>
      <PersonChip name={names[0]} className={withName ? 'min-w-0' : 'min-w-0 [&>span:last-child]:sr-only'} />
      {rest.length > 0 && (plain
        ? <span className="shrink-0 text-ds-label tabular-nums text-ds-fg-muted"><span aria-hidden>+{rest.length}</span><span className="sr-only">{`and ${rest.length} more: ${rest.join(', ')}`}</span></span>
        : <PersonStack people={rest} max={0} label="More people on this task" />)}
    </span>
  );
}

/** Everyone on the task, one name to a line (the details panel: the whole list, scrolling when it is long). */
export function PeopleList({ task }: { task: RegisterTask }) {
  const names = assigneeNames(task);
  if (names.length === 0) return <PersonChip name={null} />;
  return (
    <ul tabIndex={names.length > 6 ? 0 : undefined} aria-label={names.length > 6 ? 'People on this task' : undefined} className="m-0 flex max-h-[168px] list-none flex-col gap-[4px] overflow-y-auto p-0 focus-visible:outline-none focus-visible:shadow-ds-ring">
      {names.map((n, i) => <li key={`${n}-${i}`}><PersonChip name={n} /></li>)}
    </ul>
  );
}

/** The due day, and under it how late or soon it is in words (a danger word when it is late: never colour alone). */
export function DueCell({ task, now }: { task: RegisterTask; now: Date }) {
  if (!task.due_date) return <span className="text-ds-body text-ds-fg-muted">{NOT_SET}</span>;
  const words = dueWords(task, now);
  return (
    <span className="flex flex-col items-start">
      <span className="whitespace-nowrap text-ds-body text-ds-fg">{formatDate(task.due_date, { calendar: true })}</span>
      {words && <span className={`whitespace-nowrap text-ds-label ${words.late ? 'font-[600] text-ds-danger' : 'text-ds-fg-muted'}`}>{words.text}</span>}
    </span>
  );
}

export function taskColumns(env: RowEnv): RecordColumn<RegisterTask>[] {
  return [
    { key: 'title', header: 'Task', sortKey: 'title', cell: (row) => <RowLead row={row}><TaskTitle row={row} env={env} /></RowLead> },
    { key: 'status', header: 'Status', sortKey: 'status', fit: TASK_FIT.status, cell: (row) => <StatusCell task={row.record} /> },
    { key: 'priority', header: 'Priority', sortKey: 'priority', fit: TASK_FIT.priority, cell: (row) => <PriorityCell task={row.record} /> },
    { key: 'owner', header: 'Owner', sortKey: 'owner', fit: TASK_FIT.owner, cell: (row, look) => <OwnerCell task={row.record} withName={look.wide} /> },
    { key: 'due', header: 'Due', sortKey: 'due_date', fit: TASK_FIT.due, cell: (row) => <DueCell task={row.record} now={env.now} /> },
  ];
}

/** The card a row is where the list has no room for a table: the title (two lines), the status and priority, how soon it is due, and the owner. */
export function TaskCard({ row, env }: { row: RecordRow<RegisterTask>; env: RowEnv }) {
  const t = row.record;
  const words = dueWords(t, env.now);
  const line = subline(t);
  return (
    <div className="flex min-w-0 flex-col gap-[4px]">
      <span dir="auto" title={t.title} className="line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{t.title}</span>
      {line && <span className="truncate text-ds-label text-ds-fg-muted">{line}</span>}
      <span className="flex min-w-0 flex-wrap items-center gap-x-[10px] gap-y-[4px]">
        <StatusCell task={t} />
        <PriorityCell task={t} />
        {words && <span className={`whitespace-nowrap text-ds-label ${words.late ? 'font-[600] text-ds-danger' : 'text-ds-fg-muted'}`}>{words.text}</span>}
        <span className="ml-auto"><OwnerCell task={t} plain /></span>
      </span>
    </div>
  );
}

/** The menu items that move a task: its next step first, then every status the workflow allows from where it is (a step the approval gate holds back says why). */
export function moveItems(task: RegisterTask, env: Pick<RowEnv, 'me' | 'onStep' | 'onMove' | 'onGo'>): MenuItem[] {
  const items: MenuItem[] = [];
  const step = nextStep(task, env.me);
  if (step) items.push({ key: 'step', label: step.label, onSelect: () => env.onStep(task, step), section: 'Next step' });
  if (kindOf(task) === 'document') {
    taskButtons(task.document_request, env.me).forEach((b, i) => items.push({ key: `doc-${i}`, label: b.label, onSelect: () => env.onGo(b.href), section: i === 0 ? 'Document request' : undefined }));
    return items;
  }
  allowedTransitions(task).filter((status) => !step || step.to !== status).forEach((status, i) => {         // the next step is already the first item
    const held = approvalGate(task, status);
    items.push({
      key: `move-${status}`, label: statusPill(taskStatus, status).label, onSelect: () => env.onMove(task, status), section: i === 0 ? 'Move to' : undefined,
      disabled: held, reason: held ? 'Needs approval first' : undefined,
    });
  });
  return items;
}

/** The row's menu: Open, then what can be done to the task. Always drawn; reachable by Tab, Enter and the arrow keys. */
export function RowMenu({ task, env }: { task: RegisterTask; env: RowEnv }) {
  const items: MenuItem[] = [{ key: 'open', label: 'Open task', icon: Eye, onSelect: () => env.onOpen(task.id) }, ...moveItems(task, env)];
  return <Menu label={`Actions for ${truncate(task.title, 60).text}`} iconOnly items={items} />;
}

export { isDoneStatus };
