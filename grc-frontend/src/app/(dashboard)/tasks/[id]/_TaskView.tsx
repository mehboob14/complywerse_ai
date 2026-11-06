'use client';

// One task, on its own page: the head (title, priority, status, where it came from, and the actions the person may take), the facts (SLA, owners, reviewer, when it was made), what the person can
// do now (move it a step, approve it), and the tabs (Details, Sub-tasks, Comments, Evidence, History; the open one is ?tab=). The rules that were this page's are kept, and each is in the open: who may
// edit or delete (the rights the page has always checked: `tasks:task_management:edit` and `:delete`, plus an administrator-only delete for a document request's task), which steps the workflow
// allows (the server's map), what a document request's task does not offer (steps, AI helpers, the owner and due date), and the edit form's payload (tasksModel.ts). Everything that writes says what
// happened after the server answered; deleting asks first.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, FileText, Pencil, Sparkles, Trash2 } from 'lucide-react';
import { criticalTasksApi } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { Button, Notice, Tabs, TabPanel, useConfirm, useReportedMutation, useTabParam } from '@/components/ui/ds';
import { DocumentTaskCard, useMyUserId } from '@/components/governance/DocumentTaskActions';
import { usePermissions } from '@/hooks/usePermissions';
import { EMPTY, formatDate, formatDateTime, truncate } from '@/lib/format';
import { canDeleteTask, isDocumentTask, plainDescription } from '@/lib/documentTasks';
import { Owners, Fact, PriorityPill, SlaPill, TaskStatusPill } from '../_ui';
import { DETAIL_TABS, allowedTransitions, personName, type TaskDetail } from '../tasksModel';
import { AiPanels, useTaskAi } from './_AiPanels';
import { Approval, Transitions } from './_Actions';
import { EditTaskDrawer } from './_EditTask';
import { CommentsPanel, DetailsPanel, EvidencePanel, HistoryPanel, SubTasksPanel } from './_Panels';

export function TaskView({ task }: { task: TaskDetail }) {
  const router = useRouter();
  const { hasPermission, isAdmin } = usePermissions();
  const canEdit = hasPermission('tasks:task_management:edit');
  const canDelete = hasPermission('tasks:task_management:delete');
  const meId = useMyUserId();
  const { confirm, confirmDialog } = useConfirm();
  const [tab, setTab] = useTabParam('tab', DETAIL_TABS, { fallback: 'details' });
  const [editing, setEditing] = useState(false);
  const ai = useTaskAi(task);

  const remove = useReportedMutation({
    mutationFn: () => criticalTasksApi.delete(task.id),
    success: 'Task deleted',
    failure: "Couldn't delete the task",
    invalidate: [['critical-tasks']],
    onSuccess: () => router.push('/tasks'),
  });

  // a document request's task: completed by doing the step in the document (its card's button), deleted by administrators only
  const docTask = isDocumentTask(task);
  const steps = allowedTransitions(task);
  const canDeleteThis = canDeleteTask(task, { isAdmin, hasDeleteRight: canDelete });
  const description = docTask ? plainDescription(task.description) : task.description;
  const req = task.document_request;
  // a document task's details in plain words (its source module and record ids are the platform's, not the person's)
  const docFacts: Array<[string, string]> | null = docTask ? [
    ['Document', req?.document_title || EMPTY],
    ['Version', req?.version || EMPTY],
    ['Requested by', personName(task.created_by) || EMPTY],
    ['Due', formatDate(req?.due_date ?? task.due_date, { calendar: true })],
    ['Category', task.category],
  ] : null;

  const askDelete = async () => {
    const yes = await confirm({
      title: 'Delete this task?',
      message: docTask ? 'The request in the document stays; only this task is removed.' : `“${truncate(task.title, 120).text}” and its sub-tasks and comments are removed.`,
      confirmLabel: 'Delete task',
      tone: 'danger',
    });
    if (yes) remove.mutate();
  };

  const via = task.source_module ? ` · via ${docTask ? 'a document request' : task.source_module.replace(/_/g, ' ')}` : '';
  const people = task.assignees && task.assignees.length > 1 ? task.assignees.length : 0;

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        back={{ href: '/tasks', label: 'Back to Task Management' }}
        title={task.title}
        meta={<>Task #{task.id} · {task.source} · {task.category}{via}{task.escalation_level > 0 && <span className="text-ds-danger"> · Escalation level {task.escalation_level}</span>}</>}
        chips={(
          <>
            <PriorityPill word={task.priority} size="md" />
            <TaskStatusPill word={task.status} size="md" />
            {/* a task promoted from a CAPA action: its status syncs back to the issue */}
            {task.linked_issue_id ? <Button variant="link" size="sm" href={`/issues/${task.linked_issue_id}`} rightIcon={<ArrowUpRight aria-hidden />} title="This task was promoted from a CAPA action: its status syncs from here back to the issue">Linked issue #{task.linked_issue_id}</Button> : null}
            {/* a task on a regulatory change: edits here show there, and there, here */}
            {task.linked_regulatory_change_id ? <Button variant="link" size="sm" href={`/governance/regulatory-changes/${task.linked_regulatory_change_id}?tab=tasks`} rightIcon={<ArrowUpRight aria-hidden />} title="This task is part of a regulatory change; its status, people and dates stay in step with it">Regulatory change #{task.linked_regulatory_change_id}</Button> : null}
          </>
        )}
        actions={(
          <>
            {/* a document task's description is the request's own words: no AI root cause or description */}
            {!docTask && <Button leftIcon={<Sparkles aria-hidden />} loading={ai.askRoot.isPending} onClick={() => ai.askRoot.mutate()}>Root cause</Button>}
            {!docTask && <Button leftIcon={<FileText aria-hidden />} loading={ai.askDescription.isPending} onClick={() => ai.askDescription.mutate()}>AI description</Button>}
            {canEdit && <Button leftIcon={<Pencil aria-hidden />} onClick={() => setEditing(true)}>Edit</Button>}
            {canDeleteThis && <Button variant="dangerOutline" leftIcon={<Trash2 aria-hidden />} loading={remove.isPending} onClick={() => { void askDelete(); }}>Delete</Button>}
          </>
        )}
      />

      {docTask && <DocumentTaskCard request={task.document_request} meId={meId} />}

      <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">
        <Fact label="SLA status" tone={task.sla_status === 'Breached' ? 'danger' : undefined}>
          <SlaPill word={task.sla_status} size="md" />
          {task.due_date && <p className="mt-[6px] text-ds-label font-normal text-ds-fg-muted">Due {formatDate(task.due_date, { calendar: true })}</p>}
        </Fact>
        <Fact label={people > 0 ? `Owners (${people})` : 'Owner'}><Owners task={task} size={24} /></Fact>
        <Fact label="Reviewer">{task.reviewer ? personName(task.reviewer) : <span className="font-normal text-ds-fg-muted">Not set</span>}</Fact>
        <Fact label="Created">
          {formatDateTime(task.created_at)}
          <p className="mt-[4px] text-ds-label font-normal text-ds-fg-muted">by {personName(task.created_by) || 'System'}</p>
        </Fact>
      </div>

      <Transitions task={task} steps={steps} />
      <Approval task={task} />
      {task.recurrence_pattern && <Notice tone="info">Recurring: every {task.recurrence_interval || 1} {task.recurrence_pattern}(s).</Notice>}

      <Tabs
        ariaLabel="Task sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'details', label: 'Details' },
          { key: 'subtasks', label: 'Sub-tasks', count: task.sub_tasks?.length || 0 },
          { key: 'comments', label: 'Comments', count: task.comments?.length || 0 },
          { key: 'evidence', label: 'Evidence' },
          { key: 'history', label: 'History' },
        ]}
      >
        <TabPanel tabKey="details" className="pt-[12px]">{tab === 'details' && <DetailsPanel task={task} description={description} docFacts={docFacts} />}</TabPanel>
        <TabPanel tabKey="subtasks" className="pt-[12px]">{tab === 'subtasks' && <SubTasksPanel task={task} canDelete={canDelete} />}</TabPanel>
        <TabPanel tabKey="comments" className="pt-[12px]">{tab === 'comments' && <CommentsPanel task={task} />}</TabPanel>
        <TabPanel tabKey="evidence" className="pt-[12px]">{tab === 'evidence' && <EvidencePanel task={task} />}</TabPanel>
        <TabPanel tabKey="history" className="pt-[12px]">{tab === 'history' && <HistoryPanel task={task} />}</TabPanel>
      </Tabs>

      <AiPanels ai={ai} />
      {editing && <EditTaskDrawer task={task} onClose={() => setEditing(false)} />}
      {confirmDialog}
    </div>
  );
}
