'use client';

// The checklist of a task: a progress bar and "2 of 5 done" in the card's head, one row per sub-task (a tick, the title, who it is for and when it is due), and a line to add one. A sub-task
// can have a person and a day (the API has always taken them; the old page offered the title only): when adding ("Owner and due date") and when editing a row. Ticking says nothing (the tick
// moving is the confirmation) unless it fails; add, edit and delete say what they did and show a failure with Retry. Deleting asks first and keeps the right the page has always checked
// (`tasks:task_management:delete`). The people are read when they are first needed.
import { useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button, Checkbox, Combobox, EmptyState, ErrorState, FormError, FormField, IconButton, PersonChip, ProgressBar, SectionCard, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { criticalTasksApi } from '@/lib/api';
import { formatCount, formatDate, truncate } from '@/lib/format';
import { TASK_REFRESH } from '../../_register/taskData';
import { useTenantUsers } from '../../_queries';
import { SubTaskPill } from '../../_ui';
import { dueWords } from '../../taskRecord';
import { TITLE_MAX, personName, userOptions, type SubTask } from '../../tasksModel';
import { SECTION_IDS, emptySub, sortSubTasks, subCreateBody, subFormOf, subPatch, subProblem, subTaskProgress, type SubForm, type TaskPageData } from './taskPageModel';

/** the owner and the day of a sub-task: the people are read when this is first drawn */
function Details({ form, set }: { form: SubForm; set: (next: SubForm) => void }) {
  const users = useTenantUsers();
  return (
    <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
      <FormField label="Owner">
        {users.isError && !users.data
          ? <ErrorState compact title="Couldn't load the people" message={errorMessage(users.error)} onRetry={canRetry(users.error) ? () => { void users.refetch(); } : undefined} />
          : <Combobox label="Owner" clearable searchable options={userOptions(users.data)} value={form.owner || null} onChange={(v) => set({ ...form, owner: v ?? '' })} placeholder={users.isPending ? 'Loading…' : 'Unassigned'} searchPlaceholder="Search people" />}
      </FormField>
      <FormField label="Due date"><TextInput type="date" value={form.due} onChange={(e) => set({ ...form, due: e.target.value })} /></FormField>
    </div>
  );
}

function AddLine({ task }: { task: TaskPageData }) {
  const [form, setForm] = useState<SubForm>(emptySub);
  const [more, setMore] = useState(false);
  const [tried, setTried] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const add = useReportedMutation({
    mutationFn: (v: SubForm) => criticalTasksApi.createSubTask(task.id, subCreateBody(v)),
    success: 'Sub-task added',
    failure: "Couldn't add the sub-task",
    invalidate: TASK_REFRESH,
    onSuccess: () => { setForm(emptySub()); setTried(false); setMore(false); field.current?.focus(); },
  });
  const problem = subProblem(form);
  const shown = (tried && problem) || (form.title.length > TITLE_MAX ? problem : null);       // too long is said at once (the table holds 255); empty only after a try
  const submit = () => { setTried(true); if (!problem) add.mutate(form); };

  return (
    <form className="flex flex-col gap-[8px]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex flex-col gap-[8px] sm:flex-row">
        <div className="min-w-0 flex-1">
          <TextInput ref={field} aria-label="New sub-task" placeholder="Add a sub-task" value={form.title} invalid={!!shown} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          {shown && <p role="alert" className="mt-[4px] text-ds-label text-ds-danger">{shown}</p>}
        </div>
        <Button type="submit" variant="primary" loading={add.isPending}>Add</Button>
      </div>
      <Button variant="link" size="sm" className="self-start" aria-expanded={more} onClick={() => setMore(!more)}>{more ? 'Hide owner and due date' : 'Owner and due date'}</Button>
      {more && <Details form={form} set={setForm} />}
    </form>
  );
}

function Row({ task, sub, canDelete, now }: { task: TaskPageData; sub: SubTask; canDelete: boolean; now: Date }) {
  const { confirm, confirmDialog } = useConfirm();
  const [editing, setEditing] = useState(false);
  const start = subFormOf(sub);
  const [form, setForm] = useState<SubForm>(start);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const last = useRef<Record<string, unknown> | null>(null);
  const done = sub.status === 'Completed';

  const toggle = useReportedMutation({
    mutationFn: (value: boolean) => criticalTasksApi.updateSubTask(task.id, sub.id, { status: value ? 'Completed' : 'Open' }),
    success: 'Sub-task updated',
    failure: "Couldn't update the sub-task",
    invalidate: TASK_REFRESH,
    toast: 'errors',                                                    // the tick moving is the confirmation
  });
  const close = () => { setEditing(false); setError(null); setTried(false); };
  const save = useReportedMutation({
    mutationFn: (patch: Record<string, unknown>) => criticalTasksApi.updateSubTask(task.id, sub.id, patch),
    success: 'Sub-task saved',
    failure: "Couldn't save the sub-task",
    invalidate: TASK_REFRESH,
    toast: 'success',
    onSuccess: close,
    onError: (e) => setError(e),
  });
  const remove = useReportedMutation({
    mutationFn: () => criticalTasksApi.deleteSubTask(task.id, sub.id),
    success: 'Sub-task deleted',
    failure: "Couldn't delete the sub-task",
    invalidate: TASK_REFRESH,
  });
  const ask = async () => {
    const yes = await confirm({ title: 'Delete this sub-task?', message: `“${truncate(sub.title, 100).text}” is removed from the task.`, confirmLabel: 'Delete sub-task', tone: 'danger' });
    if (yes) remove.mutate();
  };

  const problem = subProblem(form);
  const submit = () => {
    setTried(true);
    if (problem) return;
    const patch = subPatch(form, start);
    if (Object.keys(patch).length === 0) { close(); return; }
    setError(null);
    last.current = patch;
    save.mutate(patch);
  };

  if (editing) {
    return (
      <li className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]" onKeyDown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close(); } }}>
        <div className="flex flex-col gap-[12px]">
          <FormField label="Title" required error={tried ? problem : null}><TextInput autoFocus value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></FormField>
          <Details form={form} set={setForm} />
          <FormError title="Couldn't save the sub-task" error={error} onRetry={last.current ? () => { setError(null); save.mutate(last.current as Record<string, unknown>); } : undefined} />
          <div className="flex flex-wrap items-center gap-[8px]">
            <Button variant="primary" size="sm" loading={save.isPending} onClick={submit}>Save</Button>
            <Button size="sm" disabled={save.isPending} onClick={close}>Cancel</Button>
          </div>
        </div>
      </li>
    );
  }
  const words = dueWords({ due_date: sub.due_date, status: sub.status }, now);
  return (
    <li className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] rounded-ds-card border border-ds-border bg-ds-surface px-[12px] py-[2px]">
      <Checkbox
        className="min-w-0 flex-1"
        checked={done}
        disabled={toggle.isPending}
        onChange={(e) => toggle.mutate(e.target.checked)}
        label={<span dir="auto" className={`[overflow-wrap:anywhere] ${done ? 'text-ds-fg-muted line-through' : 'text-ds-fg'}`}>{sub.title}</span>}
      />
      <span className="flex flex-wrap items-center gap-[8px]">
        {!done && sub.status !== 'Open' && <SubTaskPill word={sub.status} />}
        {sub.assigned_owner && <PersonChip name={personName(sub.assigned_owner)} size={20} />}
        {sub.due_date && (
          <span className={`text-ds-label ${words?.late ? 'font-[600] text-ds-danger' : 'text-ds-fg-muted'}`}>
            Due {formatDate(sub.due_date, { calendar: true })}{words?.late ? ` · ${words.text}` : ''}
          </span>
        )}
        <IconButton label={`Edit the sub-task: ${truncate(sub.title, 60).text}`} onClick={() => { setForm(start); setEditing(true); }}><Pencil aria-hidden /></IconButton>
        {canDelete && <IconButton label={`Delete the sub-task: ${truncate(sub.title, 60).text}`} onClick={() => { void ask(); }}><Trash2 aria-hidden /></IconButton>}
      </span>
      {confirmDialog}
    </li>
  );
}

export function SubTasks({ task, canDelete, now }: { task: TaskPageData; canDelete: boolean; now: Date }) {
  const subs = sortSubTasks(task.sub_tasks);
  const progress = subTaskProgress(subs);
  return (
    <SectionCard id={SECTION_IDS.subtasks} title="Sub-tasks" meta={progress.total > 0 ? `${formatCount(progress.done)} of ${formatCount(progress.total)} done` : undefined}>
      <div className="flex flex-col gap-[12px]">
        {progress.total > 0 && <ProgressBar value={progress.percent} label="Sub-tasks done" valueText={`${progress.done} of ${progress.total}`} showValue={false} tone={progress.done === progress.total ? 'success' : 'primary'} />}
        <AddLine task={task} />
        {subs.length === 0 ? (
          <EmptyState bare kind="firstUse" title="No sub-tasks yet" info="Break the task into smaller steps and tick them off here." />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
            {subs.map((s) => <Row key={s.id} task={task} sub={s} canDelete={canDelete} now={now} />)}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}
