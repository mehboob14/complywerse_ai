'use client';

// One task: everything about it, every field editable; a new task opens here too, filled in from wherever it was raised (an obligation, an impact assessment). On the kit: a drawer that asks
// before typed input is thrown away, FormField fields, a failure said in the drawer with what was typed kept, and a confirmation when it worked. A task here is a task in Task Management for
// everyone on it (the link opens it there).
import { useMemo, useState } from 'react';
import { ExternalLink, Trash2 } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';
import { Button, FormField, SegmentedControl, Select, Textarea, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { regulatoryApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { priority } from '@/lib/status';
import { optionsOf, taskStatus, taskType } from '@/lib/statuses/regulatory';
import { useObligations } from '../_lib/data';
import { DUE_PRESETS, inDays } from '../_lib/drafts';
import { PRIORITIES, assigneesOf } from '../_lib/regulatoryModel';
import type { Task, TaskDraft } from '../_lib/types';
import { PeopleField } from '../_parts/shared';

type Form = { title: string; description: string; task_type: string; priority: string; status: string; assignee_ids: number[]; due_date: string };
const formOf = (t: Task | TaskDraft): Form => ({
  title: t.title || '', description: t.description || '', task_type: t.task_type || 'process_change', priority: t.priority || 'medium', status: t.status || 'pending',
  assignee_ids: assigneesOf(t), due_date: (t.due_date || '').slice(0, 10),
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const STATUS_OPTIONS = optionsOf(taskStatus);

export const REFRESH_TASKS = (changeId: number) => [['regulatory-tasks', changeId], ['regulatory-change', changeId], ['regulatory-changes'], ['regulatory-overview'], ['regulatory-my-work']];

export function TaskEditor({ changeId, task, onClose }: { changeId: number; task: Task | TaskDraft | null; onClose: () => void }) {
  const { confirm, confirmDialog } = useConfirm();
  const obligations = useObligations(changeId);
  const start = useMemo(() => (task ? formOf(task) : null), [task]);
  const [form, setForm] = useState<Form | null>(start);
  const [problem, setProblem] = useState('');
  const isNew = !task?.id;
  const invalidate = REFRESH_TASKS(changeId);

  const create = useReportedMutation({
    mutationFn: (f: Form) => regulatoryApi.createTask(changeId, {
      title: f.title.trim(), description: f.description.trim() || null, task_type: f.task_type, priority: f.priority, assignee_ids: f.assignee_ids, due_date: f.due_date || null,
      obligation_id: task?.obligation_id ?? null, impact_assessment_id: task?.impact_assessment_id ?? null, linked_policy_id: task?.linked_policy_id ?? null, linked_control_id: task?.linked_control_id ?? null,
    }),
    success: { title: 'Task added', message: 'Everyone on it finds it in Task Management too.' }, failure: "Couldn't add the task", retryable: false, toast: 'success', invalidate,
    onSuccess: onClose, onError: (e) => setProblem(errorMessage(e)),
  });
  const update = useReportedMutation({
    mutationFn: (data: Record<string, unknown>) => regulatoryApi.updateTask(task?.id as number, data),
    success: 'Task saved', failure: "Couldn't save the task", toast: 'success', invalidate,
    onSuccess: onClose, onError: (e) => setProblem(errorMessage(e)),
  });
  const remove = useReportedMutation({
    mutationFn: () => regulatoryApi.deleteTask(task?.id as number),
    success: 'Task deleted', failure: "Couldn't delete the task", invalidate, onSuccess: onClose,
  });

  if (!task || !form || !start) return null;
  const set = (patch: Partial<Form>) => setForm({ ...form, ...patch });
  const changed = (Object.keys(form) as Array<keyof Form>).filter((k) => !same(form[k], start[k]));
  const busy = create.isPending || update.isPending;
  const ok = !!form.title.trim();

  const save = () => {
    setProblem('');
    if (!ok) return;
    if (isNew) { create.mutate(form); return; }
    update.mutate(Object.fromEntries(changed.map((k) => [k, k === 'due_date' ? form.due_date || null : form[k]])));
  };
  const askDelete = async () => {
    const yes = await confirm({ title: 'Delete this task?', message: `“${task.title}” will be removed from this change, and from Task Management.`, confirmLabel: 'Delete task', tone: 'danger' });
    if (yes) remove.mutate();
  };
  const obligation = task.obligation_id ? (obligations.data ?? []).find((o) => o.id === task.obligation_id) : undefined;
  const raisedFrom = obligation ? `clause ${obligation.ref || '—'}: ${obligation.summary}`
    : task.linked_policy_title ? `policy: ${task.linked_policy_title}` : task.linked_control_name ? `control: ${task.linked_control_name}` : task.impact_assessment_id ? 'an impact assessment' : null;

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={changed.length > 0}
      title={isNew ? 'New task' : 'Task'}
      width="w-full max-w-xl"
      subtitle={isNew ? undefined : [task.creator_name && `Created by ${task.creator_name}`, task.completed_at && `completed ${formatDate(task.completed_at)}`].filter(Boolean).join(' · ') || undefined}
      footer={(
        <div className="flex items-center gap-[8px]">
          {!isNew && <Button variant="ghost" leftIcon={<Trash2 aria-hidden />} loading={remove.isPending} onClick={() => { void askDelete(); }}>Delete</Button>}
          <span className="ml-auto flex gap-[8px]">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!ok || (!isNew && changed.length === 0)} onClick={save}>{isNew ? 'Add task' : 'Save changes'}</Button>
          </span>
        </div>
      )}
    >
      <form className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); if (!busy) save(); }}>
        <FormField label="Title" required error={!ok && changed.includes('title') ? 'Say what needs doing.' : undefined}>
          <TextInput value={form.title} maxLength={500} autoFocus={isNew} placeholder="What needs doing" onChange={(e) => set({ title: e.target.value })} />
        </FormField>
        {!isNew && <FormField label="Status"><SegmentedControl label="Status" name="task-status" options={STATUS_OPTIONS} value={form.status} onChange={(v) => set({ status: v })} /></FormField>}
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="People on it" hint="Each of them finds it in Task Management too.">
            <PeopleField label="People on this task" value={form.assignee_ids} known={task.assignees} onChange={(ids) => set({ assignee_ids: ids })} />
          </FormField>
          <FormField label="Due date" optional>
            <TextInput type="date" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} />
            <span className="mt-[4px] flex flex-wrap gap-[4px]">
              {DUE_PRESETS.map(([name, days]) => <Button key={name} size="sm" onClick={() => set({ due_date: inDays(days) })}>{name}</Button>)}
            </span>
          </FormField>
          <FormField label="Type">
            <Select value={form.task_type} onChange={(e) => set({ task_type: e.target.value })}>{optionsOf(taskType).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select>
          </FormField>
          <FormField label="Priority">
            <Select value={form.priority} onChange={(e) => set({ priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p} value={p}>{priority.label(p)}</option>)}</Select>
          </FormField>
        </div>
        <FormField label="Description" optional>
          <Textarea rows={6} value={form.description} placeholder="What to do, and how you'll know it's done" onChange={(e) => set({ description: e.target.value })} />
        </FormField>
        {(raisedFrom || task.critical_task_id) && (
          <div className="flex flex-col gap-[4px] rounded-ds-control bg-ds-surface-subtle px-[12px] py-[8px] text-ds-label text-ds-fg-muted">
            {raisedFrom && <p className="m-0 line-clamp-2">{`Raised from ${raisedFrom}`}</p>}
            {task.critical_task_id && <Button variant="link" href={`/tasks/${task.critical_task_id}`} rightIcon={<ExternalLink aria-hidden />}>Open in Task Management</Button>}
          </div>
        )}
        {problem && <p role="alert" className="m-0 text-ds-body text-ds-danger">{problem}</p>}
      </form>
      {confirmDialog}
    </RightSlidePanel>
  );
}
