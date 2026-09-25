'use client';

// Obligations — every duty the circular sets, clause by clause. Each row says what
// it requires, who owns it and whether we comply; owners are picked and a task is
// raised right from the row. Open one to read the circular's own words, link
// controls and follow its tasks, then step to the next with Next. A quote the
// circular doesn't contain word for word is flagged for a person to check.

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, ClipboardList, ListChecks, Loader2, Pencil, Plus, Search,
  ShieldCheck, Sparkles, Trash2,
} from 'lucide-react';
import { AnimatedModal, MultiSelectDropdown, RightSlidePanel, useToast } from '@/components/ui';
import { regulatoryApi } from '@/lib/api';
import ObligationControls from './_ObligationControls';
import type { TaskDraft } from './_TasksPanel';
import {
  COMPLIANCE, ConfirmDialog, Face, Field, OBLIGATION_TYPES, PRIORITIES, PeoplePicker, Pill, PillSelect, Segmented,
  TASK_STATUSES, apiError, assigneesOf, fmtDate, inputCls, labelOf, ownersOf, toneOf, useLinks, useObligations,
  useTasks, useUsers, words, type Obligation, type RegLink, type TabFilter, type Task,
} from '../_ui';

// Only what the AI read needs checking against the circular; a person's own entry doesn't.
const toCheckOf = (o: Obligation) => o.source === 'ai' && !o.verified;
const BAR: Record<string, string> = {
  compliant: 'bg-emerald-500', partially_compliant: 'bg-amber-400', non_compliant: 'bg-rose-500',
  not_applicable: 'bg-slate-300', not_assessed: 'bg-slate-200',
};
const CONTROL_FILTERS = [
  { value: 'met', label: 'Met by a control' }, { value: 'review', label: 'Suggestions to review' },
  { value: 'none', label: 'No control yet' },
];
const GRID = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_9rem_8rem_2rem_1rem]';

function controlState(links: RegLink[] = []) {
  const confirmed = links.filter((l) => l.status === 'confirmed').length;
  const proposed = links.filter((l) => l.status === 'proposed').length;
  return { confirmed, proposed, key: confirmed ? 'met' : proposed ? 'review' : 'none' };
}

function ControlNote({ links }: { links?: RegLink[] }) {
  const { confirmed, proposed } = controlState(links);
  if (confirmed) return <span className="inline-flex items-center gap-0.5 text-emerald-700"><ShieldCheck className="h-3 w-3" /> {confirmed} control{confirmed === 1 ? '' : 's'}</span>;
  if (proposed) return <span className="inline-flex items-center gap-0.5 text-amber-700"><Sparkles className="h-3 w-3" /> {proposed} control{proposed === 1 ? '' : 's'} to review</span>;
  return <span>No control yet</span>;
}

/** A task for an obligation: its words, its deadline, and its owners on it. */
const taskFor = (o: Obligation): TaskDraft => ({
  title: o.summary.length > 140 ? `${o.summary.slice(0, 137)}…` : o.summary,
  description: [o.ref && `Clause ${o.ref}.`, o.quote && `The circular: “${o.quote}”`, o.notes].filter(Boolean).join('\n\n'),
  task_type: 'process_change', priority: o.priority, due_date: o.deadline, obligation_id: o.id, assignee_ids: ownersOf(o),
});

export default function ObligationsPanel({ changeId, onTask, initial = {} }: {
  changeId: number; onTask: (task: Task | TaskDraft) => void; initial?: TabFilter;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: all = [], isLoading } = useObligations(changeId);
  const { data: links = [] } = useLinks(changeId);
  const { data: tasks = [] } = useTasks(changeId);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState(initial.status || '');
  const [type, setType] = useState('');
  const [control, setControl] = useState(initial.control || '');
  const [toCheck, setToCheck] = useState(!!initial.toCheck);
  const [order, setOrder] = useState<number[]>([]);        // the list as it was when a popup opened
  const [openId, setOpenId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Obligation | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: ['regulatory-obligations', changeId] });
  const refreshLinks = () => qc.invalidateQueries({ queryKey: ['regulatory-links', changeId] });
  const failed = (e: unknown) => toast({ title: 'Not saved', message: apiError(e), type: 'error' });
  const save = useMutation({
    mutationFn: ({ id, data }: { id: number; data: Record<string, unknown> }) => regulatoryApi.updateObligation(id, data),
    onSuccess: refresh, onError: failed,
  });
  const remove = useMutation({
    mutationFn: (id: number) => regulatoryApi.deleteObligation(id),
    onSuccess: (_r, id) => { refresh(); refreshLinks(); setRemoving(null); if (openId === id) setOpenId(null); toast({ title: 'Obligation removed', type: 'success' }); },
    onError: failed,
  });
  const suggest = useMutation({
    mutationFn: () => regulatoryApi.suggestControls(changeId),
    onSuccess: () => { refreshLinks(); toast({ title: 'Control suggestions updated', message: 'Review them on each obligation.', type: 'success' }); },
    onError: failed,
  });

  const byObligation = useMemo(() => {
    const out: Record<number, RegLink[]> = {};
    for (const l of links) if (l.obligation_id) (out[l.obligation_id] ||= []).push(l);
    return out;
  }, [links]);
  const tasksOf = useMemo(() => {
    const out: Record<number, Task[]> = {};
    for (const t of tasks) if (t.obligation_id) (out[t.obligation_id] ||= []).push(t);
    return out;
  }, [tasks]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return all.filter((o) => (!status || o.compliance_status === status) && (!type || o.obligation_type === type)
      && (!control || controlState(byObligation[o.id]).key === control) && (!toCheck || toCheckOf(o))
      && (!q || [o.summary, o.quote || '', o.ref || '', ...(o.owners || []).map((w) => w.display_name)]
        .some((s) => s.toLowerCase().includes(q))));
  }, [all, status, type, control, toCheck, search, byObligation]);

  const counts = Object.fromEntries(COMPLIANCE.map((s) => [s.value, all.filter((o) => o.compliance_status === s.value).length]));
  const met = all.filter((o) => controlState(byObligation[o.id]).confirmed > 0).length;
  const toReview = links.filter((l) => l.status === 'proposed').length;
  const unverified = all.filter(toCheckOf).length;
  const filtered = !!(search || status || type || control || toCheck);

  const open = (o: Obligation) => { setOrder(shown.map((x) => x.id)); setOpenId(o.id); };
  const current = all.find((o) => o.id === openId) || null;
  const at = current ? order.indexOf(current.id) : -1;

  if (isLoading) return <p className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading obligations…</p>;

  return (
    <div className="space-y-3">
      {all.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
          <div className="flex h-2 overflow-hidden rounded-full bg-slate-100" aria-hidden>
            {COMPLIANCE.map((s) => counts[s.value] > 0 && (
              <div key={s.value} className={BAR[s.value]} style={{ width: `${(counts[s.value] / all.length) * 100}%` }} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
            {COMPLIANCE.map((s) => counts[s.value] > 0 && (
              <button key={s.value} type="button" onClick={() => setStatus(status === s.value ? '' : s.value)}
                className={`inline-flex items-center gap-1.5 hover:text-slate-900 ${status === s.value ? 'font-semibold text-slate-900' : ''}`}>
                <span className={`h-2 w-2 rounded-full ${BAR[s.value]}`} /> {counts[s.value]} {s.label.toLowerCase()}
              </button>
            ))}
            <span className="hidden text-slate-300 sm:inline">|</span>
            <button type="button" onClick={() => setControl(control === 'met' ? '' : 'met')} className="inline-flex items-center gap-1 hover:text-slate-900">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> {met} of {all.length} met by a control
            </button>
            {toReview > 0 && (
              <button type="button" onClick={() => setControl(control === 'review' ? '' : 'review')} className="text-amber-800 hover:underline">
                {toReview} suggestion{toReview === 1 ? '' : 's'} to review
              </button>
            )}
            {unverified > 0 && (
              <button type="button" onClick={() => setToCheck((v) => !v)} className="inline-flex items-center gap-1 text-amber-800 hover:underline">
                <AlertTriangle className="h-3.5 w-3.5" /> {unverified} to check against the circular
              </button>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search obligations"
            aria-label="Search obligations" className={`${inputCls} h-8 py-1 pl-8`} />
        </div>
        <MultiSelectDropdown title="Compliance" size="sm" multiSelect={false} autoApply
          items={COMPLIANCE.map((s) => ({ value: s.value, label: s.label }))}
          selectedValues={status ? [status] : []} onApply={(v) => setStatus(v[0] || '')} />
        <MultiSelectDropdown title="Type" size="sm" multiSelect={false} autoApply
          items={OBLIGATION_TYPES.map((t) => ({ value: t, label: words(t) }))}
          selectedValues={type ? [type] : []} onApply={(v) => setType(v[0] || '')} />
        <MultiSelectDropdown title="Controls" size="sm" multiSelect={false} autoApply items={CONTROL_FILTERS}
          selectedValues={control ? [control] : []} onApply={(v) => setControl(v[0] || '')} />
        {filtered && (
          <button type="button" onClick={() => { setSearch(''); setStatus(''); setType(''); setControl(''); setToCheck(false); }}
            className="text-xs text-primary-700 hover:underline">Clear</button>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={() => suggest.mutate()} disabled={suggest.isPending || all.length === 0}
            title="Suggest the controls that meet each obligation"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {suggest.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Suggest controls
          </button>
          <button type="button" onClick={() => setAdding(true)} className="btn-primary flex h-8 items-center gap-1.5 px-3 text-xs">
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className={`${GRID} hidden border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:grid`}>
          <span>Obligation {filtered && all.length > 0 && <span className="normal-case tracking-normal">· {shown.length} of {all.length}</span>}</span>
          <span>Owners</span><span>Compliance</span><span /><span />
        </div>
        {shown.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-10 text-center text-sm text-slate-500">
            <ListChecks className="mb-2 h-8 w-8 text-slate-300" />
            {all.length === 0 ? 'No obligations yet. They appear as the circular is read.' : 'None match these filters.'}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((o) => {
              const mine = tasksOf[o.id] || [];
              const done = mine.filter((t) => t.status === 'completed').length;
              return (
                <li key={o.id} onClick={() => open(o)} className={`${GRID} cursor-pointer px-4 py-2.5 hover:bg-slate-50`}>
                  <div className="flex min-w-0 items-start gap-2.5">
                    <span className="mt-0.5 min-w-[2.25rem] shrink-0 rounded bg-slate-100 px-1 py-0.5 text-center font-mono text-[11px] text-slate-700">
                      {o.ref || '—'}
                    </span>
                    <div className="min-w-0">
                      <p className="line-clamp-2 text-sm text-slate-900">{o.summary}</p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-500">
                        <span>{words(o.obligation_type)}</span>
                        {(o.deadline || o.deadline_text) && <span className="text-rose-700">Due {o.deadline ? fmtDate(o.deadline) : o.deadline_text}</span>}
                        <ControlNote links={byObligation[o.id]} />
                        {mine.length > 0 && <span className="text-primary-700">{done}/{mine.length} task{mine.length === 1 ? '' : 's'} done</span>}
                        {toCheckOf(o) && <span className="inline-flex items-center gap-0.5 text-amber-700"><AlertTriangle className="h-3 w-3" /> Check the wording</span>}
                      </p>
                    </div>
                  </div>
                  <div className="hidden min-w-0 sm:block">
                    <PeoplePicker value={ownersOf(o)} placeholder="No owner" label={`Owners of clause ${o.ref || o.id}`}
                      onChange={(ids) => save.mutate({ id: o.id, data: { owner_ids: ids } })} />
                  </div>
                  <PillSelect value={o.compliance_status} options={COMPLIANCE} label={`Compliance with clause ${o.ref || o.id}`}
                    onChange={(v) => save.mutate({ id: o.id, data: { compliance_status: v } })} />
                  <button type="button" onClick={(e) => { e.stopPropagation(); onTask(taskFor(o)); }}
                    title="Create a task for this obligation" aria-label={`Create a task for clause ${o.ref || o.id}`}
                    className="hidden h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-primary-50 hover:text-primary-700 sm:inline-flex">
                    <ClipboardList className="h-4 w-4" />
                  </button>
                  <ChevronRight className="hidden h-4 w-4 text-slate-300 sm:block" />
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {current && (
        <ObligationDrawer
          key={current.id}
          o={current}
          position={at >= 0 ? `${at + 1} of ${order.length}` : undefined}
          links={byObligation[current.id] || []}
          tasks={tasksOf[current.id] || []}
          onOpenTask={onTask}
          onPrev={at > 0 ? () => setOpenId(order[at - 1]) : undefined}
          onNext={at >= 0 && at < order.length - 1 ? () => setOpenId(order[at + 1]) : undefined}
          onClose={() => setOpenId(null)}
          onSave={(data) => save.mutate({ id: current.id, data })}
          saving={save.isPending}
          onLinksChanged={refreshLinks}
          onRemove={() => setRemoving(current)}
          onTask={() => onTask(taskFor(current))}
        />
      )}

      <AddObligation changeId={changeId} open={adding} onClose={() => setAdding(false)} onAdded={refresh} />

      <ConfirmDialog open={!!removing} title="Remove this obligation?" busy={remove.isPending}
        message={<>Clause {removing?.ref || '—'}: &ldquo;{removing?.summary}&rdquo;. Its control links go with it.</>}
        confirmLabel="Remove" onCancel={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing.id)} />
    </div>
  );
}

function ObligationDrawer({ o, position, links, tasks, onOpenTask, onPrev, onNext, onClose, onSave, saving, onLinksChanged,
  onRemove, onTask }: {
  o: Obligation; position?: string; links: RegLink[]; tasks: Task[]; onOpenTask: (t: Task) => void; onPrev?: () => void;
  onNext?: () => void; onClose: () => void; onSave: (data: Record<string, unknown>) => void; saving: boolean;
  onLinksChanged: () => void; onRemove: () => void; onTask: () => void;
}) {
  const { toast } = useToast();
  const { users, departments } = useUsers();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({
    summary: o.summary, ref: o.ref || '', obligation_type: o.obligation_type, priority: o.priority, deadline: o.deadline || '',
  });
  const deptItems = o.department && !departments.some((d) => d.value === o.department)
    ? [{ value: o.department, label: o.department }, ...departments] : departments;

  // The first owner's department fills an empty Department.
  const pickOwners = (ids: number[]) => {
    const first = users.find((u) => u.id === ids[0]);
    onSave({ owner_ids: ids, ...(!o.department && first?.department ? { department: first.department } : {}) });
  };

  return (
    <RightSlidePanel isOpen onClose={onClose} width="w-full max-w-2xl"
      title={o.ref ? `Clause ${o.ref}` : 'Obligation'}
      subtitle={[words(o.obligation_type), position].filter(Boolean).join(' · ')}
      footer={(
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onRemove}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-slate-500 hover:bg-rose-50 hover:text-rose-700">
            <Trash2 className="h-4 w-4" /> Remove
          </button>
          <button type="button" onClick={onTask}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
            <ClipboardList className="h-4 w-4" /> Create task
          </button>
          <div className="ml-auto flex items-center gap-1">
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin text-slate-400" aria-label="Saving" />}
            <button type="button" onClick={onPrev} disabled={!onPrev} aria-label="Previous obligation"
              className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
              <ChevronLeft className="h-4 w-4" /> Previous
            </button>
            <button type="button" onClick={onNext} disabled={!onNext} aria-label="Next obligation"
              className="btn-primary inline-flex items-center gap-1 px-3 py-1.5 text-sm disabled:opacity-40">
              Next <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}>
      <div className="space-y-5">
        {editing ? (
          <form className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.summary.trim().length < 3) return;
              onSave({ summary: draft.summary.trim(), ref: draft.ref.trim() || null, obligation_type: draft.obligation_type,
                priority: draft.priority, deadline: draft.deadline || null });
              setEditing(false);
            }}>
            <Field label="What the circular requires">
              <textarea value={draft.summary} rows={3} onChange={(e) => setDraft({ ...draft, summary: e.target.value })} className={inputCls} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Clause"><input value={draft.ref} onChange={(e) => setDraft({ ...draft, ref: e.target.value })} className={inputCls} /></Field>
              <Field label="Type">
                <select value={draft.obligation_type} onChange={(e) => setDraft({ ...draft, obligation_type: e.target.value })} className={inputCls}>
                  {OBLIGATION_TYPES.map((t) => <option key={t} value={t}>{words(t)}</option>)}
                </select>
              </Field>
              <Field label="Deadline"><input type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} className={inputCls} /></Field>
            </div>
            <Field label="Priority"><Segmented value={draft.priority} options={PRIORITIES} onChange={(v) => setDraft({ ...draft, priority: v })} label="Priority" /></Field>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setEditing(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-white">Cancel</button>
              <button type="submit" className="btn-primary px-3 py-1.5 text-sm">Save</button>
            </div>
          </form>
        ) : (
          <div>
            <div className="flex items-start gap-2">
              <p className="flex-1 text-[15px] font-medium leading-snug text-slate-900">{o.summary}</p>
              <button type="button" onClick={() => setEditing(true)} aria-label="Edit the obligation"
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Pill tone={toneOf(PRIORITIES, o.priority)}>{labelOf(PRIORITIES, o.priority)} priority</Pill>
              {(o.deadline || o.deadline_text) && <Pill tone="bg-rose-50 text-rose-700">Due {o.deadline ? fmtDate(o.deadline) : o.deadline_text}</Pill>}
              {o.applies_to.map((a) => <Pill key={a} tone="bg-slate-100 text-slate-600">{a}</Pill>)}
              {o.source === 'manual' && <Pill tone="bg-slate-100 text-slate-600">Added by hand</Pill>}
            </div>
          </div>
        )}

        {o.quote && (
          <figure className="rounded-lg border-l-4 border-slate-300 bg-slate-50 px-3 py-2.5">
            <blockquote className="whitespace-pre-line text-sm leading-relaxed text-slate-700">{o.quote}</blockquote>
            <figcaption className={`mt-1.5 flex items-center gap-1 text-[11px] ${o.verified ? 'text-emerald-700' : 'text-amber-800'}`}>
              {o.verified
                ? <><CheckCircle2 className="h-3.5 w-3.5" /> The circular says this word for word</>
                : <><AlertTriangle className="h-3.5 w-3.5" /> Not found word for word. Check it against the circular.</>}
            </figcaption>
          </figure>
        )}

        <Field label="Do we comply?">
          <Segmented value={o.compliance_status} options={COMPLIANCE} onChange={(v) => onSave({ compliance_status: v })} label="Compliance" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Owners">
            <PeoplePicker block value={ownersOf(o)} onChange={pickOwners} placeholder="No owner yet" label="Owners of this obligation" />
          </Field>
          <Field label="Department" hint={!o.department ? 'Filled in from the owner when you pick one.' : undefined}>
            <MultiSelectDropdown title="Who carries it out" triggerVariant="input" size="md" multiSelect={false} autoApply forceSearch
              items={deptItems} selectedValues={o.department ? [o.department] : []} showAvatars={false}
              onApply={(v) => onSave({ department: v[0] || null })} onCreate={(text) => onSave({ department: text.trim() })} />
          </Field>
        </div>

        <Field label="How we comply">
          <textarea defaultValue={o.notes || ''} rows={3} className={`${inputCls} resize-y`}
            placeholder="What we do today, what is outstanding, where the evidence is"
            onBlur={(e) => {
              if (e.target.value === (o.notes || '')) return;
              onSave({ notes: e.target.value });
              toast({ title: 'Notes saved', type: 'success' });
            }} />
        </Field>

        <section className="rounded-lg border border-slate-200 p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Tasks for it</p>
            <button type="button" onClick={onTask} className="inline-flex items-center gap-1 text-xs font-medium text-primary-700 hover:underline">
              <Plus className="h-3.5 w-3.5" /> Create task
            </button>
          </div>
          {tasks.length === 0 ? (
            <p className="text-xs text-slate-500">None yet. A task raised here goes to its owners, and to Task Management.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {tasks.map((t) => (
                <li key={t.id}>
                  <button type="button" onClick={() => onOpenTask(t)} className="flex w-full items-center gap-2 py-1.5 text-left hover:bg-slate-50">
                    <span className={`min-w-0 flex-1 truncate text-sm ${t.status === 'completed' ? 'text-slate-500 line-through' : 'text-slate-800'}`}>{t.title}</span>
                    <span className="flex -space-x-1.5">
                      {(t.assignees || []).slice(0, 3).map((a) => <Face key={a.id} id={a.id} name={a.display_name} />)}
                    </span>
                    {assigneesOf(t).length === 0 && <span className="text-[11px] text-slate-400">Unassigned</span>}
                    {t.due_date && <span className="text-[11px] text-slate-500">{fmtDate(t.due_date)}</span>}
                    <Pill tone={toneOf(TASK_STATUSES, t.status)}>{labelOf(TASK_STATUSES, t.status)}</Pill>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="rounded-lg border border-slate-200 p-3">
          <ObligationControls obligationId={o.id} links={links} onChanged={onLinksChanged}
            onError={(e) => toast({ title: 'Not saved', message: apiError(e), type: 'error' })} />
        </div>
      </div>
    </RightSlidePanel>
  );
}

function AddObligation({ changeId, open, onClose, onAdded }: { changeId: number; open: boolean; onClose: () => void; onAdded: () => void }) {
  const { toast } = useToast();
  const empty = { summary: '', ref: '', obligation_type: 'requirement', priority: 'medium', deadline: '' };
  const [draft, setDraft] = useState(empty);
  const add = useMutation({
    mutationFn: () => regulatoryApi.addObligation(changeId, {
      summary: draft.summary.trim(), ref: draft.ref.trim() || undefined, obligation_type: draft.obligation_type,
      priority: draft.priority, deadline: draft.deadline || undefined,
    }),
    onSuccess: () => { onAdded(); setDraft(empty); onClose(); toast({ title: 'Obligation added', type: 'success' }); },
    onError: (e) => toast({ title: 'Not added', message: apiError(e), type: 'error' }),
  });
  const ok = draft.summary.trim().length >= 3;
  return (
    <AnimatedModal isOpen={open} onClose={onClose} size="lg" title="Add an obligation"
      subtitle="A duty the AI missed, or one from another source"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" form="add-obligation" disabled={!ok || add.isPending} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm disabled:opacity-50">
            {add.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add obligation
          </button>
        </div>
      )}>
      <form id="add-obligation" className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); if (ok) add.mutate(); }}>
        <Field label="What the circular requires">
          <textarea autoFocus rows={3} value={draft.summary} onChange={(e) => setDraft({ ...draft, summary: e.target.value })}
            placeholder="e.g. Report every major cyber incident to the State Bank within 24 hours" className={inputCls} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Clause"><input value={draft.ref} onChange={(e) => setDraft({ ...draft, ref: e.target.value })} placeholder="e.g. 4.2" className={inputCls} /></Field>
          <Field label="Type">
            <select value={draft.obligation_type} onChange={(e) => setDraft({ ...draft, obligation_type: e.target.value })} className={inputCls}>
              {OBLIGATION_TYPES.map((t) => <option key={t} value={t}>{words(t)}</option>)}
            </select>
          </Field>
          <Field label="Deadline"><input type="date" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} className={inputCls} /></Field>
        </div>
        <Field label="Priority"><Segmented value={draft.priority} options={PRIORITIES} onChange={(v) => setDraft({ ...draft, priority: v })} label="Priority" /></Field>
      </form>
    </AnimatedModal>
  );
}
