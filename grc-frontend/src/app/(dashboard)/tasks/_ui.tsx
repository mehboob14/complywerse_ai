'use client';

// The few pieces the Task Management pages share, on the design-system tokens and the kit (components/ui/ds): the words of a task as pills, a title that is a link, the people of a task,
// the "via ..." line that says where a task came from, a section's heading and the line a form shows when the server refused it.
import type { ReactNode } from 'react';
import Link from 'next/link';
import { clsx } from 'clsx';
import { ArrowUpRight } from 'lucide-react';
import { Checkbox, PersonChip, PersonStack, StatusPill } from '@/components/ui/ds';
import { DocumentTaskLink } from '@/components/governance/DocumentTaskActions';
import { isDocumentTask } from '@/lib/documentTasks';
import { statusPill } from '@/lib/status';
import { subTaskStatus, taskApproval, taskPriority, taskSla, taskStatus } from '@/lib/statuses/tasks';
import { assigneeNames, type TaskRow } from './tasksModel';

export const PriorityPill = ({ word, size = 'sm' }: { word: string | null | undefined; size?: 'sm' | 'md' }) => <StatusPill size={size} {...statusPill(taskPriority, word)} />;
export const TaskStatusPill = ({ word, size = 'sm' }: { word: string | null | undefined; size?: 'sm' | 'md' }) => <StatusPill size={size} {...statusPill(taskStatus, word)} />;
export const SlaPill = ({ word, size = 'sm' }: { word: string | null | undefined; size?: 'sm' | 'md' }) => <StatusPill size={size} {...statusPill(taskSla, word)} />;
export const ApprovalPill = ({ word, size = 'md' }: { word: string | null | undefined; size?: 'sm' | 'md' }) => <StatusPill size={size} {...statusPill(taskApproval, word || 'not_requested')} />;
export const SubTaskPill = ({ word }: { word: string | null | undefined }) => <StatusPill size="sm" {...statusPill(subTaskStatus, word)} />;

// the padding and the matching negative margin make the link 24px high (44px on a phone) without moving anything: a line of text is 20px
const LINK = 'rounded-ds-control py-[2px] -my-[2px] max-md:py-[12px] max-md:-my-[12px] font-medium text-ds-fg underline-offset-[2px] hover:text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring';

/** A task's title as the link that opens it. A long title wraps (even one with no spaces) and is cut at two lines; the whole of it is the tooltip. The cut is on an inner span:
 *  `line-clamp` on the link itself shows its third line through the link's own padding. */
export function TaskLink({ id, title, className }: { id: number; title: string; className?: string }) {
  return <Link href={`/tasks/${id}`} title={title} className={clsx('block [overflow-wrap:anywhere]', LINK, className)}><span className="line-clamp-2">{title}</span></Link>;
}

/** Everyone on a task: the first person by name, "+N" for the others (the button lists them); "Unassigned" when nobody is. */
export function Owners({ task, size = 20 }: { task: Pick<TaskRow, 'assignees' | 'assigned_owner'>; size?: 20 | 24 }) {
  const names = assigneeNames(task);
  if (names.length === 0) return <PersonChip name={null} size={size} />;
  const rest = names.slice(1);
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-[6px]">
      <PersonChip name={names[0]} size={size} className="min-w-0" />
      {rest.length > 0 && <PersonStack people={rest} max={0} size={size} label="More people on this task" />}
    </span>
  );
}

const VIA = 'inline-flex items-center gap-[2px] text-ds-label font-medium text-ds-primary-text underline-offset-[2px] hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring rounded-ds-control';

/** Where a task came from, as a short line under its title: a regulatory change links to it, a document request offers the person's own step, another module is named. */
export function SourceNote({ task, meId }: { task: Pick<TaskRow, 'linked_regulatory_change_id' | 'document_request' | 'source_module' | 'source_entity_type'>; meId: number | null }): ReactNode {
  if (task.linked_regulatory_change_id) {
    return <Link href={`/governance/regulatory-changes/${task.linked_regulatory_change_id}?tab=tasks`} className={VIA}>via regulatory change <ArrowUpRight aria-hidden className="h-[12px] w-[12px]" /></Link>;
  }
  if (isDocumentTask(task)) return <DocumentTaskLink request={task.document_request} meId={meId} />;
  if (task.source_module) return <span className="text-ds-label text-ds-fg-muted">via {task.source_module.replace(/_/g, ' ')}</span>;
  return null;
}

/** A section's heading. It takes `!` (`!text-ds-section !text-ds-fg`) on purpose, as the kit's own headings do: the platform CSS remaps a bare h2. */
export function SectionHeading({ id, children, meta }: { id?: string; children: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-[8px]">
      <h2 id={id} className="min-w-0 break-words !text-ds-section !text-ds-fg">{children}</h2>
      {meta && <span className="text-ds-body text-ds-fg-muted">{meta}</span>}
    </div>
  );
}

/** What the server said about a form that did not save, at the top of the form it is about: said once, where the person is looking, with what they typed kept. */
export function FormProblem({ message, onRetry }: { message: string | null | undefined; onRetry?: () => void }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex flex-wrap items-center justify-between gap-x-[12px] gap-y-[8px] rounded-ds-control border border-ds-danger-border bg-ds-danger-soft px-[12px] py-[8px] text-ds-body text-ds-danger">
      <span className="min-w-0 break-words">{message}</span>
      {onRetry && <button type="button" onClick={onRetry} className="inline-flex min-h-ds-control shrink-0 items-center rounded-ds-control border border-ds-danger-border bg-ds-surface px-[12px] font-[600] text-ds-danger hover:bg-ds-danger-soft focus-visible:outline-none focus-visible:shadow-ds-ring">Retry</button>}
    </div>
  );
}

/** A row's tick box with a hit area of 32px (44px on a phone) around the 16px box, so a finger can find it; the label names the task it selects. */
export function TickBox({ label, checked, indeterminate = false, onChange }: { label: string; checked: boolean; indeterminate?: boolean; onChange: () => void }) {
  return (
    <label className="-m-[8px] inline-flex h-[32px] w-[32px] cursor-pointer items-center justify-center max-md:-m-[14px] max-md:h-[44px] max-md:w-[44px]">
      <Checkbox aria-label={label} checked={checked} indeterminate={indeterminate} onChange={onChange} />
    </label>
  );
}

/** A small card of facts on a task's page (the SLA, the owners, the reviewer, when it was made): a label above and the value under it. */
export function Fact({ label, children, tone }: { label: string; children: ReactNode; tone?: 'danger' }) {
  return (
    <div className={clsx('min-w-0 rounded-ds-card border p-[12px]', tone === 'danger' ? 'border-ds-danger-border bg-ds-danger-soft' : 'border-ds-border bg-ds-surface')}>
      <p className="text-ds-label text-ds-fg-muted">{label}</p>
      <div className="mt-[4px] min-w-0 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{children}</div>
    </div>
  );
}
