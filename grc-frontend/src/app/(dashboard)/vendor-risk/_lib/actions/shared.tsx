'use client';

// A supplier's action plan, shared by the supplier's tab and the Planned actions
// page: the form that plans an action, and one action with what can be done to it.

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clsx } from 'clsx';
import {
  CalendarCheck, CheckCircle2, CircleSlash, ClipboardCheck, ListTodo, Loader2, RefreshCw, RotateCcw, Send, XCircle, type LucideIcon,
} from 'lucide-react';
import { vendorActionsApi, vendorOnboardingApi, vendorRiskApi } from '@/lib/api';
import { useToast } from '@/components/ui/ToastProvider';

export type ActionKind = 'todo' | 'questionnaire' | 'checkin' | 'reassessment';
export type ActionStatus = 'scheduled' | 'done' | 'failed' | 'cancelled';
export interface ActionItem {
  id: number; vendor: { id: number; name: string | null }; kind: ActionKind; kind_label: string; title: string;
  note: string | null; due_on: string; status: ActionStatus; overdue_days: number; assignee_ids: number[];
  people: Array<{ id: number; name: string | null }>; template_id: number | null; result: string | null;
  result_link: string | null; done_at: string | null; done_by: string | null; created_by: string | null;
  created_at: string; automatic: boolean;
}

export const KIND_META: Record<ActionKind, { icon: LucideIcon; label: string; help: string }> = {
  todo: { icon: ListTodo, label: 'To-do', help: 'Something for a person to do and mark done: it joins their attention queue on the day, and they are reminded weekly until it is done.' },
  questionnaire: { icon: Send, label: 'Send a questionnaire', help: 'Sent to the supplier’s contact on the day, due two weeks later.' },
  checkin: { icon: CalendarCheck, label: 'Ask for the yearly check-in', help: 'The owner’s yearly check-in falls due on the day instead of on its usual date.' },
  reassessment: { icon: RefreshCw, label: 'Open a reassessment', help: 'A new assessment of the supplier opens on the day.' },
};
const STATUS_META: Record<ActionStatus, { label: string; cls: string }> = {
  scheduled: { label: 'Planned', cls: 'border-slate-200 bg-slate-50 text-slate-700' },
  done: { label: 'Done', cls: 'border-emerald-200 bg-emerald-50 text-emerald-800' },
  failed: { label: 'Could not happen', cls: 'border-rose-200 bg-rose-50 text-rose-800' },
  cancelled: { label: 'Cancelled', cls: 'border-slate-200 bg-white text-slate-500' },
};
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:bg-slate-50';
const todayIso = () => new Date().toISOString().slice(0, 10);
export const errText = (e: unknown, fallback: string) =>
  (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail || fallback;

export function whenLabel(item: ActionItem): string {
  const due = new Date(`${item.due_on}T00:00:00`);
  const days = Math.round((due.getTime() - new Date(`${todayIso()}T00:00:00`).getTime()) / 86_400_000);
  const date = due.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (item.status !== 'scheduled') return date;
  if (days > 1) return `${date} · in ${days} days`;
  if (days === 1) return `${date} · tomorrow`;
  if (days === 0) return `${date} · today`;
  return `${date} · ${-days} day${days === -1 ? '' : 's'} overdue`;
}

export function usePeople() {
  return useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['tprm-intake-people'],
    queryFn: async () => (await vendorOnboardingApi.people()).data,
    staleTime: 5 * 60_000,
  }).data || [];
}

/** Plan an action on one supplier. */
export function ActionForm({ vendorId, onDone }: { vendorId: number; onDone: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const people = usePeople();
  const { data: templates } = useQuery({
    queryKey: ['questionnaire-templates-for-actions'],
    queryFn: async () => {
      const res = await vendorRiskApi.getTemplates({ limit: 200 });
      return ((Array.isArray(res.data) ? res.data : res.data?.items) || []) as Array<{ id: number; name: string }>;
    },
    staleTime: 5 * 60_000,
  });
  const [kind, setKind] = useState<ActionKind>('todo');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState(todayIso());
  const [who, setWho] = useState<number[]>([]);
  const [templateId, setTemplateId] = useState<number | ''>('');
  const [note, setNote] = useState('');
  const save = useMutation({
    mutationFn: () => vendorActionsApi.plan(vendorId, {
      kind, title: title || undefined, due_on: due, assignee_ids: who, note: note || undefined,
      template_id: kind === 'questionnaire' ? templateId || undefined : undefined,
    }),
    onSuccess: () => {
      ['tprm-actions', 'tprm-actions-all'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      toast({ type: 'success', title: 'Action planned' });
      onDone();
    },
    onError: (e) => toast({ type: 'error', title: 'Could not plan it', message: errText(e, 'Try again.') }),
  });
  const Meta = KIND_META[kind];
  return (
    <form className="space-y-3 rounded-xl border border-primary-100 bg-primary-50/40 p-4"
      onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="grid gap-2 sm:grid-cols-4" role="radiogroup" aria-label="What should happen">
        {(Object.keys(KIND_META) as ActionKind[]).map((k) => {
          const Icon = KIND_META[k].icon;
          return (
            <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => setKind(k)}
              className={clsx('flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
                kind === k ? 'border-primary-500 bg-white text-primary-800 shadow-sm' : 'border-slate-200 bg-white/60 text-slate-600 hover:bg-white')}>
              <Icon className="h-4 w-4 shrink-0" aria-hidden /> {KIND_META[k].label}
            </button>
          );
        })}
      </div>
      <p className="text-xs text-slate-500">{Meta.help}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
          {kind === 'todo' ? 'What is to be done' : 'Name (optional)'}
          <input className={clsx(input, 'mt-1')} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200}
            required={kind === 'todo'} placeholder={kind === 'todo' ? 'e.g. Contact the supplier about the SOC 2 renewal' : KIND_META[kind].label} />
          {kind === 'todo' && (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {['Contact the supplier', 'Contact the stakeholder', 'Chase the missing evidence'].map((s) => (
                <button key={s} type="button" onClick={() => setTitle(s)}
                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-normal text-slate-600 hover:bg-slate-50">{s}</button>
              ))}
            </span>
          )}
        </label>
        {kind === 'questionnaire' && (
          <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
            Questionnaire to send
            <select className={clsx(input, 'mt-1')} value={templateId} required
              onChange={(e) => setTemplateId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Choose a questionnaire</option>
              {(templates || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
        <label className="block text-xs font-medium text-slate-600">
          On
          <input type="date" className={clsx(input, 'mt-1')} value={due} min={todayIso()} required onChange={(e) => setDue(e.target.value)} />
        </label>
        <div className="text-xs font-medium text-slate-600">
          For
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {who.map((id) => (
              <button key={id} type="button" onClick={() => setWho(who.filter((x) => x !== id))}
                className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-normal text-slate-700 hover:bg-slate-50"
                aria-label={`Remove ${people.find((p) => p.id === id)?.name}`}>
                {people.find((p) => p.id === id)?.name || `User ${id}`} ×
              </button>
            ))}
            <select value="" onChange={(e) => e.target.value && setWho([...who, Number(e.target.value)])}
              className="rounded-lg border border-dashed border-slate-300 bg-white px-2 py-1 text-xs font-normal text-slate-600" aria-label="Add a person">
              <option value="">{who.length ? '+ Add a person' : 'The supplier’s owner, or choose…'}</option>
              {people.filter((p) => !who.includes(p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
        </div>
        <label className="block text-xs font-medium text-slate-600 sm:col-span-2">
          Note (optional)
          <textarea className={clsx(input, 'mt-1')} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
        <button type="submit" disabled={save.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50">
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Plan it
        </button>
      </div>
    </form>
  );
}

/** One planned action, and what can be done to it. */
export function ActionRow({ item, canEdit, showVendor = false }: { item: ActionItem; canEdit: boolean; showVendor?: boolean }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [replanning, setReplanning] = useState(false);
  const [date, setDate] = useState(todayIso());
  const change = useMutation({
    mutationFn: (data: Record<string, unknown>) => vendorActionsApi.change(item.id, data),
    onSuccess: () => {
      ['tprm-actions', 'tprm-actions-all', 'tpra-attention'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      setReplanning(false);
    },
    onError: (e) => toast({ type: 'error', title: 'Could not change it', message: errText(e, 'Try again.') }),
  });
  const Icon = KIND_META[item.kind]?.icon || ClipboardCheck;
  const late = item.status === 'scheduled' && item.overdue_days > 0;
  return (
    <li className="flex flex-wrap items-start gap-3 px-4 py-3">
      <span className={clsx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
        item.status === 'failed' ? 'bg-rose-50 text-rose-600' : item.status === 'done' ? 'bg-emerald-50 text-emerald-600' : 'bg-primary-50 text-primary-600')}>
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-slate-900">
          {item.title}
          {showVendor && item.vendor.name && (
            <> · <Link href={`/vendor-risk/vendors/${item.vendor.id}?tab=actions`} className="font-normal text-primary-700 hover:underline">{item.vendor.name}</Link></>
          )}
        </p>
        <p className={clsx('text-xs', late ? 'font-medium text-rose-700' : 'text-slate-500')}>
          {whenLabel(item)} · {item.kind_label} · for {item.people.map((p) => p.name || `User ${p.id}`).join(', ') || 'the owner'}
        </p>
        {item.note && <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{item.note}</p>}
        {item.result && (
          <p className={clsx('mt-1 text-xs', item.status === 'failed' ? 'text-rose-700' : 'text-slate-600')}>
            {item.result}{item.done_by ? ` (${item.done_by})` : ''}
            {item.result_link && <> · <Link href={item.result_link} className="text-primary-700 hover:underline">Open</Link></>}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <span className={clsx('rounded-full border px-2 py-0.5 text-[11px] font-medium', STATUS_META[item.status].cls)}>{STATUS_META[item.status].label}</span>
        {canEdit && item.status === 'scheduled' && (
          <>
            <button type="button" disabled={change.isPending} onClick={() => change.mutate({ status: 'done' })}
              className="inline-flex items-center gap-1 rounded-md border border-emerald-200 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-50">
              <CheckCircle2 className="h-3.5 w-3.5" /> Done
            </button>
            <button type="button" disabled={change.isPending} onClick={() => change.mutate({ status: 'cancelled' })}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
              <CircleSlash className="h-3.5 w-3.5" /> Cancel
            </button>
          </>
        )}
        {canEdit && item.status !== 'scheduled' && !replanning && (
          <button type="button" onClick={() => setReplanning(true)}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50">
            <RotateCcw className="h-3.5 w-3.5" /> Plan again
          </button>
        )}
        {replanning && (
          <span className="flex items-center gap-1">
            <input type="date" value={date} min={todayIso()} onChange={(e) => setDate(e.target.value)} aria-label="New date"
              className="rounded-md border border-slate-300 px-2 py-1 text-xs" />
            <button type="button" disabled={change.isPending} onClick={() => change.mutate({ status: 'scheduled', due_on: date })}
              className="rounded-md bg-primary-600 px-2 py-1 text-xs font-medium text-white">Plan</button>
            <button type="button" onClick={() => setReplanning(false)} aria-label="Keep it as it is" className="rounded p-1 text-slate-400 hover:bg-slate-100">
              <XCircle className="h-3.5 w-3.5" />
            </button>
          </span>
        )}
      </div>
    </li>
  );
}
