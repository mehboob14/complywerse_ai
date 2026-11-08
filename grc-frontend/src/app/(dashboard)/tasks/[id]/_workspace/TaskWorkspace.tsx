'use client';

// One task, as a workspace (Stage 4, pattern C1: timeline first). The head says what the task is and offers the ONE step the person takes next (Start, Send for review, Complete, Verify, Request
// approval, Approve: taskRecord.nextStep, the same rule as My work and All tasks); AI helpers are in "Ask AI", Delete in "...". The main column is what happened and what is left to do: the
// description, the sub-tasks, the organization's own fields, and ONE Activity feed (comments and every change in words) with the box to write a comment on top. The rail on the right holds the
// properties, each edited where it is shown (Rail.tsx); under 1024 px it is a "Details" accordion above the main column. A document request's task shows its request card first and keeps its
// person, due date and status (they follow the request). Who may edit is what the old Edit button checked (`tasks:task_management:edit`), who may delete is what it checked (`...:delete`, and
// administrators for a document request's task); Approve and Reject are drawn only for the people the server lets decide today. Old ?tab= addresses scroll to the section that holds what the tab held.
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { FileText, Sparkles, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { AccordionRow, Button, Menu, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { DocumentTaskCard } from '@/components/governance/DocumentTaskActions';
import { usePermissions } from '@/hooks/usePermissions';
import { criticalTasksApi } from '@/lib/api';
import { formatDate, truncate } from '@/lib/format';
import { isDocumentTask, plainDescription } from '@/lib/documentTasks';
import { statusPill } from '@/lib/status';
import { taskStatus } from '@/lib/statuses/tasks';
import { ApprovalPill, PriorityPill, SlaPill, TaskStatusPill } from '../../_ui';
import { nextStep } from '../../taskRecord';
import { useMe } from '../../_work/workData';
import { Activity } from './Activity';
import { AiSheet, useTaskAi, type AiKind } from './AiSheet';
import { CustomFieldsCard } from './CustomFieldsCard';
import { DescriptionCard } from './DescriptionCard';
import { Rail } from './Rail';
import { SubTasks } from './SubTasks';
import { anchorOf, approvalView, factsLine, railRights, type ActivityFilter, type TaskPageData } from './taskPageModel';
import { runStep, useApproval, useMoveTask } from './useTaskActions';

const QUERY = '(max-width: 1023.98px)';
const subscribe = (onChange: () => void) => {
  const list = window.matchMedia(QUERY);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
};
/** Whether the window is narrower than the two-column layout (drawn wide on the server, corrected on the client). */
const useStacked = (): boolean => useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);

export function TaskWorkspace({ task }: { task: TaskPageData }) {
  const router = useRouter();
  const search = useSearchParams();
  const { hasPermission, isAdmin } = usePermissions();
  const me = useMe();
  const { confirm, confirmDialog } = useConfirm();
  const stacked = useStacked();
  const ai = useTaskAi(task);
  const [aiKind, setAiKind] = useState<AiKind | null>(null);
  const anchor = anchorOf(search?.get('tab'));
  const [filter, setFilter] = useState<ActivityFilter>(anchor?.filter ?? 'all');

  const rights = railRights(task, { canEdit: hasPermission('tasks:task_management:edit'), canDelete: hasPermission('tasks:task_management:delete'), isAdmin });
  const doc = isDocumentTask(task);
  const now = useMemo(() => new Date(), [task]);       // eslint-disable-line react-hooks/exhaustive-deps
  const approval = approvalView(task, me.id);
  const step = doc ? null : nextStep(task, me.id);
  const headNote = !step && !doc ? approval.note : null;
  const move = useMoveTask(task.id);
  const decide = useApproval(task);
  const stepping = move.isPending || decide.isPending;

  const remove = useReportedMutation({
    mutationFn: () => criticalTasksApi.delete(task.id),
    success: 'Task deleted',
    failure: "Couldn't delete the task",
    invalidate: [['critical-tasks'], ['my-tasks'], ['task-reports']],
    onSuccess: () => router.push('/tasks'),
  });
  const askDelete = async () => {
    const yes = await confirm({
      title: 'Delete this task?',
      message: doc ? 'The request in the document stays; only this task is removed.' : `“${truncate(task.title, 120).text}” and its sub-tasks and comments are removed.`,
      confirmLabel: 'Delete task',
      tone: 'danger',
    });
    if (yes) remove.mutate();
  };

  useEffect(() => { document.title = `${task.title} · Task`; }, [task.title]);
  useEffect(() => { if (anchor) document.getElementById(anchor.id)?.scrollIntoView({ block: 'start' }); }, []);       // eslint-disable-line react-hooks/exhaustive-deps

  const description = doc ? plainDescription(task.description) : task.description;
  const late = task.sla_status === 'Breached' || task.sla_status === 'At Risk';
  const rail = <Rail task={task} rights={rights} approval={approval} showApprovalNote={!headNote} now={now} />;

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        back={{ href: '/tasks', label: 'Back to Task Management' }}
        title={task.title}
        meta={factsLine(task)}
        chips={(
          <>
            <PriorityPill word={task.priority} size="md" />
            <TaskStatusPill word={task.status} size="md" />
            {late && <SlaPill word={task.sla_status} size="md" />}
            {task.approval_required && task.approval_status && <ApprovalPill word={task.approval_status} size="md" />}
          </>
        )}
        actions={(
          <>
            {step && (
              <Button variant="primary" loading={stepping} onClick={() => runStep(step, { move: (to) => move.mutate(to), decide: (input) => decide.mutate(input) })}>{step.label}</Button>
            )}
            {!doc && (
              <Menu
                label="Ask AI"
                items={[
                  { key: 'root', label: 'Find the root cause', icon: Sparkles, onSelect: () => { setAiKind('root'); ai.root.mutate(); } },
                  { key: 'description', label: 'Draft a description', icon: FileText, onSelect: () => { setAiKind('description'); ai.description.mutate(); } },
                ]}
              />
            )}
            {rights.canDelete && <Menu label="More actions" iconOnly items={[{ key: 'delete', label: 'Delete task', icon: Trash2, danger: true, onSelect: () => { void askDelete(); } }]} />}
          </>
        )}
      />
      {headNote && <p className="m-0 text-ds-body text-ds-fg-muted">{headNote}</p>}

      <div className={stacked ? 'flex flex-col gap-[16px]' : 'grid grid-cols-[minmax(0,1fr)_340px] items-start gap-[16px]'}>
        {stacked && (
          <div className="rounded-ds-card border border-ds-border bg-ds-surface px-[8px]">
            <AccordionRow title="Details" meta={`${statusPill(taskStatus, task.status).label}${task.due_date ? ` · Due ${formatDate(task.due_date, { calendar: true })}` : ''}`} level={2} region={false}>
              <div className="px-[8px] pb-[12px]">{rail}</div>
            </AccordionRow>
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-[16px]">
          {doc && <DocumentTaskCard request={task.document_request} meId={me.id} />}
          <DescriptionCard task={task} description={description} canEdit={rights.edit} />
          <SubTasks task={task} canDelete={hasPermission('tasks:task_management:delete')} now={now} />
          <CustomFieldsCard task={task} canEdit={rights.edit} />
          <Activity task={task} filter={filter} onFilter={setFilter} />
        </div>
        {!stacked && (
          <aside aria-label="Task details" className="rounded-ds-card border border-ds-border bg-ds-surface p-[16px]">
            <h2 className="mb-[12px] !text-ds-section !text-ds-fg">Details</h2>
            {rail}
          </aside>
        )}
      </div>

      <AiSheet kind={aiKind} ai={ai} onClose={() => setAiKind(null)} />
      {confirmDialog}
    </div>
  );
}
