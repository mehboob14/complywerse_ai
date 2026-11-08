'use client';

// The drawer of one corrective action: its status and dates, who is on it, the issue it belongs to and its words. An action that became a task is run from Task Management (its
// status flows back from the task), so the drawer says so and offers no status buttons for it.
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { ClampedText, Fact, FactList, Notice, PersonChip, StatusPill } from '@/components/ui/ds';
import { formatDate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { actionStatus, actionType, lateness } from '@/lib/statuses/issues';
import { actionLateDays, isManagedInTasks, issueLine, type ActionRow } from '@/lib/issues/actionDef';
import { lateWord } from '@/lib/issues/words';

const MUTED = 'text-ds-fg-muted';

export function ActionStatusPill({ a }: { a: ActionRow }) {
  return <StatusPill size="sm" {...statusPill(actionStatus, a.status || 'planned')} />;
}
export function ActionLatePill({ a, now }: { a: ActionRow; now: Date }) {
  const days = actionLateDays(a, now);
  return days == null ? null : <StatusPill size="sm" tone={lateness.tone('overdue')} label={lateWord(days)} />;
}

export function ActionDetail({ a, now }: { a: ActionRow; now: Date }) {
  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[8px]"><ActionStatusPill a={a} /><ActionLatePill a={a} now={now} /></div>
      {isManagedInTasks(a) && (
        <Notice tone="info" title="Managed in Task Management" action={<Link href={`/tasks/${a.linked_critical_task_id}`} className="inline-flex min-h-ds-control items-center gap-[4px] text-ds-body font-[600] text-ds-primary-text underline-offset-2 hover:underline">Open the task<ArrowUpRight aria-hidden size={14} /></Link>}>
          Its status is kept there, so change it on the task.
        </Notice>
      )}
      <FactList min={150}>
        <Fact label="Issue">
          <Link href={`/issues/${a.issue_id}`} className="inline-flex max-w-full items-center gap-[4px] text-ds-primary-text underline-offset-2 hover:underline min-h-ds-control"><span className="line-clamp-2 break-words">{issueLine(a)}</span><ArrowUpRight aria-hidden size={14} className="shrink-0" /></Link>
        </Fact>
        <Fact label="Type">{a.action_type ? actionType.label(a.action_type) : null}</Fact>
        <Fact label="Due">{a.due_date ? formatDate(a.due_date, { calendar: true }) : null}</Fact>
        <Fact label="Assigned to"><PersonChip name={a.assignee_name} /></Fact>
        <Fact label="Completed">{a.completed_at ? formatDate(a.completed_at) : null}</Fact>
        <Fact label="Verified by">{a.verified_by_name ? <span>{a.verified_by_name}{a.verified_at ? ` · ${formatDate(a.verified_at)}` : ''}</span> : null}</Fact>
        <Fact label="Effectiveness review">{a.effectiveness_review_at ? formatDate(a.effectiveness_review_at) : null}</Fact>
        <Fact label="Added">{a.created_at ? formatDate(a.created_at) : null}</Fact>
      </FactList>
      {a.description ? <div><p className={`mb-[4px] text-ds-label ${MUTED}`}>Notes</p><ClampedText text={a.description} lines={6} /></div> : null}
    </div>
  );
}
