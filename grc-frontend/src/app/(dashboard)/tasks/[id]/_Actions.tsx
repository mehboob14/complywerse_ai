'use client';

// What a person does with a task from its page: move it to its next status, and (for a task that needs approval) ask for, give or refuse that approval. The requests are the old ones
// (transition with the new status and an optional comment; request-approval, approve and reject with a comment); what changed is that each one says what happened after the server
// answered, in the server's words when it refused (a step the workflow does not allow, an approval still missing), with Retry where trying again can help. Nothing here decides
// who may do what: the server does (it refuses a step that is not allowed, and a Completed or Verified step until the approval is given).
import { useState } from 'react';
import { Shield, ShieldCheck, ShieldX } from 'lucide-react';
import { criticalTasksApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { Button, SectionCard, TextInput, useReportedMutation } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { taskStatus } from '@/lib/statuses/tasks';
import { ApprovalPill } from '../_ui';
import { personName, type TaskDetail } from '../tasksModel';

/** Move the task one step: a button per status the workflow allows from where it is, and a comment that is saved with the step. */
export function Transitions({ task, steps }: { task: TaskDetail; steps: string[] }) {
  const [comment, setComment] = useState('');
  const move = useReportedMutation({
    mutationFn: (status: string) => criticalTasksApi.transition(task.id, { new_status: status, comment: comment || undefined }),
    success: (_, status) => `Moved to ${taskStatus.label(status)}`,
    failure: "Couldn't move the task",
    invalidate: [['critical-task', task.id]],
    onSuccess: () => setComment(''),
  });
  const gated = task.approval_required && task.approval_status !== 'Approved' && steps.some((s) => s === 'Completed' || s === 'Verified');
  if (steps.length === 0) return null;
  return (
    <SectionCard id="transitions" title="Move this task" info="A task moves one step at a time. Add a comment if the step needs an explanation: it is saved with the task.">
      <div className="flex flex-col gap-[12px]">
        <div className="flex flex-wrap items-center gap-[8px]">
          {steps.map((status) => (
            <Button key={status} loading={move.isPending && move.variables === status} disabled={move.isPending && move.variables !== status} onClick={() => move.mutate(status)}>
              {statusPill(taskStatus, status).label}
            </Button>
          ))}
        </div>
        <TextInput aria-label="Comment for the step" placeholder="Optional comment for the step" value={comment} onChange={(e) => setComment(e.target.value)} />
        {gated && <p className="text-ds-body text-ds-fg-muted">This task needs approval before it can be completed or verified. Ask for it in the Approval section below.</p>}
      </div>
    </SectionCard>
  );
}

type Decision = 'request' | 'approve' | 'reject';
const WORDS: Record<Decision, { done: string; failed: string }> = {
  request: { done: 'Approval requested', failed: "Couldn't request approval" },
  approve: { done: 'Task approved', failed: "Couldn't approve the task" },
  reject: { done: 'Approval refused', failed: "Couldn't refuse the approval" },
};

/** The approval of a task that needs one: who decided and when, the comment, and the buttons for the step the approval is at (request or re-request, approve, reject). */
export function Approval({ task }: { task: TaskDetail }) {
  const [comment, setComment] = useState('');
  const decide = useReportedMutation({
    mutationFn: ({ action, text }: { action: Decision; text: string }) => {
      if (action === 'request') return criticalTasksApi.requestApproval(task.id, { comment: text });
      if (action === 'approve') return criticalTasksApi.approveTask(task.id, { comment: text });
      return criticalTasksApi.rejectTask(task.id, { comment: text });
    },
    success: (_, v) => WORDS[v.action].done,
    failure: "Couldn't record the decision",
    invalidate: [['critical-task', task.id]],
    onSuccess: () => setComment(''),
  });
  if (!task.approval_required) return null;
  const run = (action: Decision) => decide.mutate({ action, text: comment });
  const busy = (action: Decision) => decide.isPending && decide.variables?.action === action;
  const status = task.approval_status;

  return (
    <SectionCard id="approval" title="Approval" actions={<ApprovalPill word={status} />}>
      <div className="flex flex-col gap-[12px]">
        {task.approved_by && task.approved_at && (
          <p className="text-ds-body text-ds-fg-muted">{status === 'Approved' ? 'Approved' : 'Reviewed'} by {personName(task.approved_by)} on {formatDateTime(task.approved_at)}</p>
        )}
        <TextInput aria-label="Approval comment" placeholder="Approval comment" value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="flex flex-wrap items-center gap-[8px]">
          {(!status || status === 'Rejected') && <Button leftIcon={<Shield aria-hidden />} loading={busy('request')} disabled={decide.isPending} onClick={() => run('request')}>{status === 'Rejected' ? 'Request again' : 'Request approval'}</Button>}
          {status === 'Pending' && (
            <>
              <Button variant="primary" leftIcon={<ShieldCheck aria-hidden />} loading={busy('approve')} disabled={decide.isPending} onClick={() => run('approve')}>Approve</Button>
              <Button variant="dangerOutline" leftIcon={<ShieldX aria-hidden />} loading={busy('reject')} disabled={decide.isPending} onClick={() => run('reject')}>Reject</Button>
            </>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
