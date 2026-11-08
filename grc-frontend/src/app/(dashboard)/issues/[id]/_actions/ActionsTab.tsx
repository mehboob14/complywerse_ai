'use client';

// The Actions tab: the corrective actions of this issue in the order they are worked (open ones by date, then the done ones), each with its status, who is on it, when it is due and the one
// step it expects next; the other steps, Edit, Send to Task Management and Delete are in its menu. An action that became a task is run from Task Management (its status flows back), so it has
// no status steps here and says where it is managed. New, Edit, the steps and Delete need the right to edit issues, which is what the server asks. Every write says what happened or why it
// failed; a failed read says so with Retry (never "no actions").
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Pencil, Plus, Rocket, Trash2 } from 'lucide-react';
import { Button, ClampedText, EmptyState, Menu, PersonChip, useConfirm, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import { issuesApi } from '@/lib/api';
import { formatDate, truncate } from '@/lib/format';
import { actionStepsFrom, type ActionStep } from '@/lib/issues/words';
import { actionStatus, actionType } from '@/lib/statuses/issues';
import { ActionLatePill, ActionStatusPill } from '../../actions/_register/ActionDetail';
import { Feed, type FeedState } from '../_timeline/TimelineTab';
import { REFRESH, type IssueRecord } from '../workspaceData';
import { ActionPanel } from './ActionPanel';
import { VerifyDialog } from './VerifyDialog';
import { orderActions, summarize, summaryLine, type IssueActionRow } from './actionsModel';

const MUTED = 'text-ds-fg-muted';

export function ActionsTab({ issue, actions, canEdit }: { issue: IssueRecord; actions: FeedState<IssueActionRow[]>; canEdit: boolean }) {
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState<IssueActionRow | null | undefined>(undefined);   // undefined: closed, null: a new one
  const [verifying, setVerifying] = useState<IssueActionRow | null>(null);
  const issueName = `${issue.code ?? `ISS-${issue.id}`} · ${truncate(issue.title, 80).text}`;
  const now = useMemo(() => new Date(), [actions.data]);                                // eslint-disable-line react-hooks/exhaustive-deps

  const create = useReportedMutation({
    mutationFn: async (payload: Record<string, unknown>) => (await issuesApi.actions.create(issue.id, payload)).data,
    success: 'Action added', failure: "Couldn't add the action", retryable: false, invalidate: REFRESH, onSuccess: () => setEditing(undefined),
  });
  const update = useReportedMutation({
    mutationFn: async (v: { id: number; payload: Record<string, unknown> }) => (await issuesApi.actions.patch(v.id, v.payload)).data,
    success: 'Action saved', failure: "Couldn't save the action", retryable: false, invalidate: REFRESH, onSuccess: () => setEditing(undefined),
  });
  const move = useReportedMutation({
    mutationFn: async (v: { action: IssueActionRow; step: ActionStep }) => (await issuesApi.actions.patch(v.action.id, { status: v.step.to })).data,
    success: (_d, v) => `Marked ${actionStatus.label(v.step.to).toLowerCase()}`, failure: "Couldn't change the action", invalidate: REFRESH,
  });
  const verify = useReportedMutation({
    mutationFn: async (v: { action: IssueActionRow; body: { effectiveness_review_at?: string; notes?: string } }) => (await issuesApi.actions.verify(v.action.id, v.body)).data,
    success: 'Action verified', failure: "Couldn't verify the action", retryable: false, invalidate: REFRESH, onSuccess: () => setVerifying(null),
  });
  const remove = useReportedMutation({
    mutationFn: async (a: IssueActionRow) => (await issuesApi.actions.delete(a.id)).data,
    success: 'Action deleted', failure: "Couldn't delete the action", invalidate: REFRESH,
  });
  const promote = useReportedMutation({
    mutationFn: async (a: IssueActionRow) => (await issuesApi.actions.promoteToTask(a.id)).data,
    success: { title: 'Sent to Task Management', message: 'From now on its status is kept on the task.' }, failure: "Couldn't send the action to Task Management", invalidate: [...REFRESH, ['critical-tasks']],
  });

  const run = async (a: IssueActionRow, s: ActionStep) => {
    if (s.kind === 'verify') { setVerifying(a); return; }
    if (s.danger) {
      const yes = await confirm({ title: 'Cancel this action?', message: `“${truncate(a.title, 80).text}” will be marked cancelled. You can restore it later.`, confirmLabel: 'Cancel action', tone: 'danger' });
      if (!yes) return;
    }
    move.mutate({ action: a, step: s });
  };
  const askDelete = async (a: IssueActionRow) => {
    const yes = await confirm({ title: 'Delete this action?', message: `“${truncate(a.title, 80).text}” will be deleted from this issue. This can't be undone.`, confirmLabel: 'Delete action', tone: 'danger' });
    if (yes) remove.mutate(a);
  };
  const askPromote = async (a: IssueActionRow) => {
    const yes = await confirm({
      title: 'Send this action to Task Management?', message: `“${truncate(a.title, 80).text}” becomes a task. From then on its status is kept on the task, and the buttons here stop moving it.`, confirmLabel: 'Send to Task Management',
    });
    if (yes) promote.mutate(a);
  };
  const stepsOf = (a: IssueActionRow): ActionStep[] => (canEdit && !a.linked_critical_task_id ? actionStepsFrom(a.status) : []);

  return (
    <div className="flex flex-col gap-[12px]">
      <Feed state={actions} noun="corrective actions">
        {(rows) => {
          const line = summaryLine(summarize(rows, now));
          return (
            <>
              <div className="flex flex-wrap items-center gap-[12px]">
                <span className={`text-ds-body ${MUTED}`}>{line ?? 'No corrective actions yet'}</span>
                {canEdit && <Button variant="primary" className="ml-auto" leftIcon={<Plus aria-hidden />} onClick={() => setEditing(null)}>New action</Button>}
              </div>
              {rows.length === 0 ? (
                <EmptyState bare kind="firstUse" title="No corrective actions" description={canEdit ? 'Add the steps that put this right and stop it coming back.' : 'Nothing has been planned to put this right yet.'} />
              ) : (
                <ul className="m-0 list-none p-0">
                  {orderActions(rows).map((a) => {
                    const steps = stepsOf(a);
                    const primary = steps.find((s) => s.primary) ?? null;
                    const rest = steps.filter((s) => s !== primary);
                    const items: MenuItem[] = [
                      ...rest.map((s): MenuItem => ({ key: s.key, label: s.label, danger: s.danger, onSelect: () => { void run(a, s); } })),
                      { key: 'edit', label: 'Edit', icon: Pencil, hidden: !canEdit, onSelect: () => setEditing(a) },
                      { key: 'promote', label: 'Send to Task Management', icon: Rocket, hidden: !canEdit || !!a.linked_critical_task_id, onSelect: () => { void askPromote(a); } },
                      { key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: !canEdit, onSelect: () => { void askDelete(a); } },
                    ];
                    return (
                      <li key={a.id} className="flex flex-wrap items-start gap-x-[12px] gap-y-[8px] border-b border-ds-border py-[12px] last:border-b-0">
                        <div className="min-w-0 flex-1 basis-[16rem]">
                          <span dir="auto" className="block break-words text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{a.title}</span>
                          <span className={`mt-[2px] flex flex-wrap items-center gap-x-[8px] gap-y-[2px] text-ds-label ${MUTED}`}>
                            <span>{a.action_type ? actionType.label(a.action_type) : 'Action'}</span>
                            <span aria-hidden>·</span>
                            <PersonChip size={20} name={a.assignee_name} />
                            <span aria-hidden>·</span>
                            <span>{a.due_date ? `Due ${formatDate(a.due_date, { calendar: true })}` : 'No due date'}</span>
                          </span>
                          {a.description?.trim() && <ClampedText className="mt-[6px]" text={a.description} lines={2} />}
                          {a.verified_at && <span className={`mt-[4px] block text-ds-label ${MUTED}`}>{`Verified${a.verified_by_name ? ` by ${a.verified_by_name}` : ''} · ${formatDate(a.verified_at)}`}</span>}
                          {a.linked_critical_task_id && (
                            <Link href={`/tasks/${a.linked_critical_task_id}`} className="mt-[4px] inline-flex min-h-ds-control items-center gap-[4px] rounded-ds-control text-ds-label font-[600] text-ds-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">
                              Managed in Task Management<ArrowUpRight aria-hidden size={14} />
                            </Link>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-[8px]">
                          <span className="flex flex-col items-start gap-[2px]"><ActionStatusPill a={a} /><ActionLatePill a={a} now={now} /></span>
                          {primary && <Button size="sm" variant="primary" loading={move.isPending && move.variables?.action.id === a.id} onClick={() => { void run(a, primary); }}>{primary.label}</Button>}
                          {items.some((m) => !m.hidden) && <Menu iconOnly label={`Actions for ${truncate(a.title, 60).text}`} items={items} />}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          );
        }}
      </Feed>
      {editing !== undefined && (
        <ActionPanel
          key={editing?.id ?? 'new'}
          action={editing}
          issueName={issueName}
          saving={create.isPending || update.isPending}
          onClose={() => setEditing(undefined)}
          onSubmit={(payload) => (editing ? update.mutate({ id: editing.id, payload }) : create.mutate(payload))}
        />
      )}
      {verifying && (
        <VerifyDialog
          actionName={truncate(verifying.title, 80).text}
          saving={verify.isPending}
          onClose={() => setVerifying(null)}
          onSubmit={(body) => verify.mutate({ action: verifying, body })}
        />
      )}
      {confirmDialog}
    </div>
  );
}
