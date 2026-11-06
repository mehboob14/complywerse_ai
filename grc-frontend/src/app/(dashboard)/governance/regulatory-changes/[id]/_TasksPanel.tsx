'use client';

// Implementation tasks: a short list you can work straight from (who, when,
// where it stands), and a popup that shows and edits everything about one task.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, ExternalLink, Eye, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import { MultiSelectDropdown, RightSlidePanel, useToast } from '@/components/ui';
import { regulatoryApi } from '@/lib/api';
import RowActionsMenu from '../../documents/_workspace/RowActionsMenu';
import {
  ConfirmDialog, Field, PRIORITIES, PeoplePicker, PillSelect, Segmented, TASK_STATUSES, TASK_TYPES, apiError,
  assigneesOf, dueIn, fmtDate, inDays, inputCls, labelOf, useObligations, useTasks, useUsers, type TabFilter,
  type Task,
} from '../_ui';

/** A task not yet created, prefilled from wherever it was raised. */
export type TaskDraft = Omit<Partial<Task>, 'id'> & { id?: undefined };

const DOT: Record<string, string> = { critical: 'bg-rose-500', high: 'bg-orange-500', medium: 'bg-amber-400', low: 'bg-teal-500' };
const GRID = 'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_10rem_7rem_7.5rem_2rem]';

export function useTaskActions(changeId: number) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['regulatory-tasks', changeId] });
    qc.invalidateQueries({ queryKey: ['regulatory-change', changeId] });
  };
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => regulatoryApi.updateTask(id, data),
    onSuccess: refresh,
  });
  const remove = useMutation({ mutationFn: (id: number) => regulatoryApi.deleteTask(id), onSuccess: refresh });
  return { update, remove, refresh };
}

export default function TasksPanel({ changeId, onOpen, initial = {} }: {
  changeId: number; onOpen: (t: Task | TaskDraft) => void; initial?: TabFilter;
}) {
  const { toast } = useToast();
  const { data: tasks = [], isLoading } = useTasks(changeId);
  const { data: obligations = [] } = useObligations(changeId);
  const { people } = useUsers();
  const { update, remove } = useTaskActions(changeId);
  const clauseOf = useMemo(() => new Map(obligations.map((o) => [o.id, o.ref || 'no clause'])), [obligations]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(initial.status || '');
  const [who, setWho] = useState(initial.who || '');
  const [lateOnly, setLateOnly] = useState(!!initial.late);
  const [deleting, setDeleting] = useState<Task | null>(null);

  const isLate = (t: Task) => t.status !== 'completed' && (dueIn(t.due_date)?.late ?? false);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tasks.filter((t) => (!status || t.status === status)
      && (!who || (who === 'none' ? assigneesOf(t).length === 0 : assigneesOf(t).includes(Number(who))))
      && (!lateOnly || isLate(t))
      && (!q || `${t.title} ${t.description || ''}`.toLowerCase().includes(q)));
  }, [tasks, search, status, who, lateOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const done = tasks.filter((t) => t.status === 'completed').length;
  const active = tasks.filter((t) => t.status === 'in_progress').length;
  const unassigned = tasks.filter((t) => assigneesOf(t).length === 0).length;
  const late = tasks.filter(isLate).length;
  const saveFailed = (e: unknown) => toast({ title: 'Not saved', message: apiError(e), type: 'error' });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tasks"
            aria-label="Search tasks" className={`${inputCls} h-8 py-1 pl-8`} />
        </div>
        <MultiSelectDropdown title="Status" size="sm" multiSelect={false} autoApply
          items={TASK_STATUSES.map((s) => ({ value: s.value, label: s.label }))}
          selectedValues={status ? [status] : []} onApply={(v) => setStatus(v[0] || '')} />
        <MultiSelectDropdown title="Assignee" size="sm" multiSelect={false} autoApply forceSearch
          items={[{ value: 'none', label: 'Unassigned' }, ...people]}
          selectedValues={who ? [who] : []} onApply={(v) => setWho(v[0] || '')} />
        <button type="button" onClick={() => onOpen({ title: '', task_type: 'process_change', priority: 'medium' })}
          className="btn-primary ml-auto flex h-8 items-center gap-1.5 px-3 text-xs">
          <Plus className="h-4 w-4" /> Add task
        </button>
      </div>

      {tasks.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(done / tasks.length) * 100}%` }} />
          </div>
          <span><b className="font-semibold text-slate-900">{done}</b> of {tasks.length} completed</span>
          {active > 0 && <button type="button" onClick={() => setStatus('in_progress')} className="text-amber-700 hover:underline">{active} in progress</button>}
          {unassigned > 0 && <button type="button" onClick={() => setWho('none')} className="text-slate-600 hover:underline">{unassigned} unassigned</button>}
          {late > 0 && (
            <button type="button" onClick={() => setLateOnly((v) => !v)} className={`text-rose-700 hover:underline ${lateOnly ? 'font-semibold' : ''}`}>
              {late} late
            </button>
          )}
          {(status || who || lateOnly || search) && (
            <button type="button" onClick={() => { setStatus(''); setWho(''); setLateOnly(false); setSearch(''); }}
              className="text-primary-700 hover:underline">Show all</button>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className={`${GRID} hidden border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:grid`}>
          <span>Task</span><span>Assignee</span><span>Due</span><span>Status</span><span />
        </div>
        {isLoading ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading tasks…</p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-10 text-center text-sm text-slate-500">
            <ClipboardList className="mb-2 h-8 w-8 text-slate-300" />
            {tasks.length === 0 ? 'No tasks yet. Add one, or raise it from an obligation or an impact assessment.' : 'No task matches these filters.'}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((t) => {
              const due = dueIn(t.due_date);
              const lateNow = t.status !== 'completed' && due?.late;
              return (
                <li key={t.id} onClick={() => onOpen(t)} className={`${GRID} cursor-pointer px-4 py-2.5 hover:bg-slate-50`}>
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span title={`${labelOf(PRIORITIES, t.priority)} priority`}
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[t.priority || 'medium'] || DOT.medium}`} />
                    <div className="min-w-0">
                      <p className={`truncate text-sm font-medium ${t.status === 'completed' ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{t.title}</p>
                      <p className="truncate text-[11px] text-slate-500">
                        {labelOf(TASK_TYPES, t.task_type)}
                        {t.obligation_id && clauseOf.has(t.obligation_id) && <span className="text-primary-700"> · Clause {clauseOf.get(t.obligation_id)}</span>}
                        {t.assignee_department && ` · ${t.assignee_department}`}
                        <span className="sm:hidden">
                          {' · '}{(t.assignees || []).map((a) => a.display_name).join(', ') || 'Unassigned'}
                          {t.due_date ? ` · due ${fmtDate(t.due_date)}` : ''}
                        </span>
                      </p>
                    </div>
                  </div>
                  <div className="hidden min-w-0 sm:block">
                    <PeoplePicker value={assigneesOf(t)} label={`People on ${t.title}`}
                      onChange={(ids) => update.mutate({ id: t.id, data: { assignee_ids: ids } }, { onError: saveFailed })} />
                  </div>
                  <div className="hidden text-xs sm:block">
                    {t.due_date ? (
                      <>
                        <p className="text-slate-800">{fmtDate(t.due_date)}</p>
                        {due && t.status !== 'completed' && <p className={`text-[11px] ${lateNow ? 'text-rose-700' : 'text-slate-500'}`}>{due.text}</p>}
                      </>
                    ) : <span className="text-slate-400">No date</span>}
                  </div>
                  <PillSelect value={t.status} options={TASK_STATUSES} label={`Status of ${t.title}`}
                    onChange={(v) => update.mutate({ id: t.id, data: { status: v } }, { onError: saveFailed })} />
                  <div className="hidden sm:block" onClick={(e) => e.stopPropagation()}>
                    <RowActionsMenu actions={[
                      { key: 'open', label: 'Open', icon: Eye, onClick: () => onOpen(t) },
                      { key: 'delete', label: 'Delete', icon: Trash2, variant: 'danger', onClick: () => setDeleting(t) },
                    ]} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog open={!!deleting} title="Delete this task?" busy={remove.isPending}
        message={<>&ldquo;{deleting?.title}&rdquo; will be removed from this change.</>}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && remove.mutate(deleting.id, {
          onSuccess: () => { setDeleting(null); toast({ title: 'Task deleted', type: 'success' }); },
          onError: saveFailed,
        })} />
    </div>
  );
}

type TaskForm = { title: string; description: string; task_type: string; priority: string; status: string; assignee_ids: number[]; due_date: string };
const formOf = (t: Task | TaskDraft): TaskForm => ({
  title: t.title || '', description: t.description || '', task_type: t.task_type || 'process_change',
  priority: t.priority || 'medium', status: t.status || 'pending', assignee_ids: assigneesOf(t),
  due_date: (t.due_date || '').slice(0, 10),
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** One task: everything about it, and every field editable. A new task opens here too. */
export function TaskEditor({ changeId, task, onClose }: { changeId: number; task: Task | TaskDraft | null; onClose: () => void }) {
  const { toast } = useToast();
  const { data: obligations = [] } = useObligations(changeId);
  const { update, remove, refresh } = useTaskActions(changeId);
  const start = useMemo(() => (task ? formOf(task) : null), [task]);
  const [form, setForm] = useState<TaskForm | null>(start);
  const [confirming, setConfirming] = useState(false);
  const isNew = !task?.id;

  const create = useMutation({
    mutationFn: (f: TaskForm) => regulatoryApi.createTask(changeId, {
      title: f.title.trim(), description: f.description.trim() || null, task_type: f.task_type, priority: f.priority,
      assignee_ids: f.assignee_ids, due_date: f.due_date || null, obligation_id: task?.obligation_id ?? null,
      impact_assessment_id: task?.impact_assessment_id ?? null, linked_policy_id: task?.linked_policy_id ?? null,
      linked_control_id: task?.linked_control_id ?? null,
    }),
    onSuccess: () => { refresh(); toast({ title: 'Task added', type: 'success' }); onClose(); },
    onError: (e) => toast({ title: 'Not added', message: apiError(e), type: 'error' }),
  });

  if (!task || !form || !start) return null;
  const set = (patch: Partial<TaskForm>) => setForm({ ...form, ...patch });
  const changed = (Object.keys(form) as Array<keyof TaskForm>).filter((k) => !same(form[k], start[k]));
  const busy = create.isPending || update.isPending;

  const save = () => {
    if (!form.title.trim()) return;
    if (isNew) { create.mutate(form); return; }
    const data = Object.fromEntries(changed.map((k) => [k, k === 'due_date' ? form.due_date || null : form[k]]));
    update.mutate({ id: task.id as number, data }, {
      onSuccess: () => { toast({ title: 'Task saved', type: 'success' }); onClose(); },
      onError: (e) => toast({ title: 'Not saved', message: apiError(e), type: 'error' }),
    });
  };
  const obligation = task.obligation_id ? obligations.find((o) => o.id === task.obligation_id) : undefined;
  const raisedFrom = obligation ? `clause ${obligation.ref || '—'}: ${obligation.summary}`
    : task.linked_policy_title ? `policy: ${task.linked_policy_title}`
      : task.linked_control_name ? `control: ${task.linked_control_name}`
        : task.impact_assessment_id ? 'an impact assessment' : null;

  return (
    <RightSlidePanel isOpen onClose={onClose} title={isNew ? 'New task' : 'Task'} width="w-full max-w-xl"
      subtitle={isNew ? undefined : [task.creator_name && `Created by ${task.creator_name}`,
        task.completed_at && `completed ${fmtDate(task.completed_at)}`].filter(Boolean).join(' · ') || undefined}
      footer={(
        <div className="flex items-center gap-2">
          {!isNew && (
            <button type="button" onClick={() => setConfirming(true)}
              className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-rose-50 hover:text-rose-700">
              <Trash2 className="h-4 w-4" /> Delete
            </button>
          )}
          <button type="button" onClick={onClose}
            className="ml-auto rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="button" onClick={save} disabled={busy || !form.title.trim() || (!isNew && changed.length === 0)}
            className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} {isNew ? 'Add task' : 'Save changes'}
          </button>
        </div>
      )}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <Field label="Title">
          <input value={form.title} onChange={(e) => set({ title: e.target.value })} required autoFocus={isNew}
            placeholder="What needs doing" className={inputCls} />
        </Field>
        {!isNew && (
          <Field label="Status">
            <Segmented value={form.status} options={TASK_STATUSES} onChange={(v) => set({ status: v })} label="Status" />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="People on it" hint="Each of them finds it in Task Management too.">
            <PeoplePicker block value={form.assignee_ids} onChange={(ids) => set({ assignee_ids: ids })} label="People on this task" />
          </Field>
          <Field label="Due date">
            <input type="date" value={form.due_date} onChange={(e) => set({ due_date: e.target.value })} className={inputCls} />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {([['1 week', 7], ['2 weeks', 14], ['1 month', 30], ['3 months', 90]] as const).map(([name, days]) => (
                <button key={name} type="button" onClick={() => set({ due_date: inDays(days) })}
                  className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-primary-50 hover:text-primary-700">
                  {name}
                </button>
              ))}
            </div>
          </Field>
          <Field label="Type">
            <select value={form.task_type} onChange={(e) => set({ task_type: e.target.value })} className={inputCls}>
              {TASK_TYPES.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <Segmented value={form.priority} options={PRIORITIES} onChange={(v) => set({ priority: v })} label="Priority" />
          </Field>
        </div>
        <Field label="Description">
          <textarea value={form.description} onChange={(e) => set({ description: e.target.value })} rows={6}
            placeholder="What to do, and how you'll know it's done" className={`${inputCls} resize-y`} />
        </Field>
        {(raisedFrom || task.critical_task_id) && (
          <div className="space-y-1 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
            {raisedFrom && <p className="line-clamp-2">Raised from {raisedFrom}</p>}
            {task.critical_task_id && (
              <Link href={`/tasks/${task.critical_task_id}`} className="inline-flex items-center gap-1 font-medium text-primary-700 hover:underline">
                Open in Task Management <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        )}
      </form>

      <ConfirmDialog open={confirming} title="Delete this task?" busy={remove.isPending}
        message={<>&ldquo;{task.title}&rdquo; will be removed from this change.</>}
        onCancel={() => setConfirming(false)}
        onConfirm={() => remove.mutate(task.id as number, {
          onSuccess: () => { setConfirming(false); toast({ title: 'Task deleted', type: 'success' }); onClose(); },
          onError: (e) => toast({ title: 'Not deleted', message: apiError(e), type: 'error' }),
        })} />
    </RightSlidePanel>
  );
}
