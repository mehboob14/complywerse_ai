'use client';

// The approval part of the rail. Whether the task needs approval is a switch (for the people who may edit); when it does, the panel says where the approval stands (who decided and when),
// offers Request approval to anyone who can see the task (the server accepts it from them), and Approve and Reject ONLY to the reviewer who is not the owner: what the server lets act today
// (the router also lets "an admin" decide, but tests an attribute no user has, so an administrator who is not the reviewer is refused: no button is drawn for them, and the panel says who is
// being waited for). An optional comment goes with the request or the decision.
import { useState } from 'react';
import { Shield, ShieldCheck, ShieldX } from 'lucide-react';
import { Button, Checkbox, Fact, TextInput } from '@/components/ui/ds';
import { formatDateTime } from '@/lib/format';
import { ApprovalPill } from '../../_ui';
import { personName } from '../../tasksModel';
import { approvalRequiredPatch, type ApprovalView, type TaskPageData } from './taskPageModel';
import { useApproval, useUpdateTask } from './useTaskActions';

export function ApprovalPanel({ task, view, canEdit, showNote }: { task: TaskPageData; view: ApprovalView; canEdit: boolean; showNote: boolean }) {
  const [comment, setComment] = useState('');
  const decide = useApproval(task, () => setComment(''));
  const flag = useUpdateTask(task.id);
  const busy = (action: string) => decide.isPending && decide.variables?.action === action;
  const run = (action: 'request' | 'approve' | 'reject') => decide.mutate({ action, comment: comment.trim(), to: action === 'request' ? view.requestFor : undefined });
  const asking = view.canRequest || view.canDecide;

  return (
    <Fact label="Approval">
      <div className="flex flex-col gap-[8px]">
        {canEdit ? (
          <Checkbox
            label="Needs approval before it is completed"
            checked={task.approval_required}
            disabled={flag.isPending}
            onChange={(e) => flag.mutate({ patch: approvalRequiredPatch(e.target.checked), said: e.target.checked ? 'This task now needs approval' : 'This task no longer needs approval' })}
          />
        ) : (
          <span>{task.approval_required ? 'Needed before it is completed' : 'Not needed'}</span>
        )}
        {view.state !== 'not_needed' && (
          <>
            <span className="flex flex-wrap items-center gap-[8px]">
              <ApprovalPill word={task.approval_status} />
              {task.approved_by && task.approved_at && (
                <span className="text-ds-label text-ds-fg-muted">{task.approval_status === 'Approved' ? 'Approved' : 'Reviewed'} by {personName(task.approved_by)}, {formatDateTime(task.approved_at)}</span>
              )}
            </span>
            {showNote && view.note && <span className="text-ds-label text-ds-fg-muted">{view.note}</span>}
            {asking && <TextInput aria-label="Comment with the approval (optional)" placeholder="Comment (optional)" value={comment} onChange={(e) => setComment(e.target.value)} />}
            {asking && (
              <span className="flex flex-wrap items-center gap-[8px]">
                {view.canRequest && <Button leftIcon={<Shield aria-hidden />} loading={busy('request')} disabled={decide.isPending} onClick={() => run('request')}>{view.requestLabel}</Button>}
                {view.canDecide && (
                  <>
                    <Button variant="primary" leftIcon={<ShieldCheck aria-hidden />} loading={busy('approve')} disabled={decide.isPending} onClick={() => run('approve')}>Approve</Button>
                    <Button variant="dangerOutline" leftIcon={<ShieldX aria-hidden />} loading={busy('reject')} disabled={decide.isPending} onClick={() => run('reject')}>Reject</Button>
                  </>
                )}
              </span>
            )}
          </>
        )}
      </div>
    </Fact>
  );
}
