'use client';

// A supplier's action plan, shared by the supplier's tab and the Planned actions page: the form that plans an action, and one action with what can be done to it. Rebuilt on the kit
// (vendor-shell, 2026-11-08) with the same exports and props: the types, the words and the due-day arithmetic are actionsModel.ts (tested); every change reports (a confirmation, or a
// failure with Retry) and refreshes the Work queue and the Overview as well as the lists.
import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarCheck, CheckCircle2, CircleSlash, ClipboardCheck, ListTodo, RefreshCw, RotateCcw, Send, type LucideIcon } from 'lucide-react';
import { vendorActionsApi, vendorOnboardingApi, vendorRiskApi } from '@/lib/api';
import { Button, FormField, MultiSelect, SegmentedControl, Select, StatusPill, Textarea, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { statusPill } from '@/lib/status';
import { vendorAction } from '@/lib/statuses/vendor';
import { useEngagements } from '../engagementsApi';
import { utcDay } from '../vendorRules';
import { FOR_ENGAGEMENT, errText, whenLabel, type ActionItem, type ActionKind } from './actionsModel';

export type { ActionItem, ActionKind, ActionStatus } from './actionsModel';
export { errText, whenLabel };

export const KIND_META: Record<ActionKind, { icon: LucideIcon; label: string; help: string }> = {
  todo: { icon: ListTodo, label: 'To-do', help: 'Something for a person to do and mark done: it joins their Work queue on the day, and they are reminded weekly until it is done.' },
  questionnaire: { icon: Send, label: 'Send a questionnaire', help: 'Sent to the supplier\'s contact on the day, due two weeks later.' },
  checkin: { icon: CalendarCheck, label: 'Ask for the yearly check-in', help: 'The owner\'s yearly check-in falls due on the day instead of on its usual date.' },
  reassessment: { icon: RefreshCw, label: 'Open a reassessment', help: 'A new assessment of the supplier opens on the day.' },
};

// what a change refreshes: this supplier's plan, every plan, the Work queue (an action due or failed is an item of it) and the Overview's numbers
const REFRESH = [['tprm-actions'], ['tprm-actions-all'], ['tpra-attention'], ['tprm-attention'], ['tprm-dashboard']] as const;

export function usePeople() {
  return useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['tprm-intake-people'],
    queryFn: async () => (await vendorOnboardingApi.people()).data,
    staleTime: 5 * 60_000,
  }).data || [];
}

const SUGGESTIONS = ['Contact the supplier', 'Contact the stakeholder', 'Chase the missing evidence'];

/** Plan an action on one supplier. */
export function ActionForm({ vendorId, onDone }: { vendorId: number; onDone: () => void }) {
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
  const [due, setDue] = useState(utcDay());
  const [who, setWho] = useState<string[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [note, setNote] = useState('');
  const [engagementId, setEngagementId] = useState('');
  const { data: engaged } = useEngagements(vendorId);
  const uses = (engaged?.items || []).filter((e) => !e.is_general && e.id && e.status !== 'ended');
  const forEngagement = FOR_ENGAGEMENT.includes(kind) && uses.length > 0;
  const save = useReportedMutation({
    mutationFn: async () => (await vendorActionsApi.plan(vendorId, {
      kind, title: title || undefined, due_on: due, assignee_ids: who.map(Number), note: note || undefined,
      template_id: kind === 'questionnaire' ? Number(templateId) || undefined : undefined,
      engagement_id: forEngagement ? Number(engagementId) || undefined : undefined,
    })).data,
    success: 'Action planned',
    failure: "Couldn't plan the action",
    invalidate: REFRESH,
    onSuccess: onDone,
  });
  const ready = (kind !== 'todo' || title.trim() !== '') && (kind !== 'questionnaire' || templateId !== '') && due !== '';
  return (
    <form className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-surface-subtle p-[16px]" onSubmit={(e) => { e.preventDefault(); if (ready && !save.isPending) save.mutate(); }}>
      <SegmentedControl label="What should happen" name={`plan-kind-${vendorId}`} options={(Object.keys(KIND_META) as ActionKind[]).map((k) => ({ value: k, label: KIND_META[k].label }))} value={kind} onChange={setKind} />
      <p className="m-0 text-ds-label text-ds-fg-muted">{KIND_META[kind].help}</p>
      <div className="grid gap-[12px] sm:grid-cols-2">
        <FormField label={kind === 'todo' ? 'What is to be done' : 'Name'} required={kind === 'todo'} optional={kind !== 'todo'} className="sm:col-span-2">
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder={kind === 'todo' ? 'e.g. Contact the supplier about the SOC 2 renewal' : KIND_META[kind].label} />
        </FormField>
        {kind === 'todo' && (
          <div className="flex flex-wrap gap-[6px] sm:col-span-2">
            {SUGGESTIONS.map((s) => <Button key={s} size="sm" onClick={() => setTitle(s)}>{s}</Button>)}
          </div>
        )}
        {kind === 'questionnaire' && (
          <FormField label="Questionnaire to send" required className="sm:col-span-2">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="Choose a questionnaire">
              {(templates || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </FormField>
        )}
        {forEngagement && (
          <FormField label="Engagement" className="sm:col-span-2">
            <Select value={engagementId} onChange={(e) => setEngagementId(e.target.value)} placeholder="General">
              {uses.map((e) => <option key={e.id} value={e.id ?? ''}>{e.name}</option>)}
            </Select>
          </FormField>
        )}
        <FormField label="On" required>
          <TextInput type="date" min={utcDay()} value={due} onChange={(e) => setDue(e.target.value)} />
        </FormField>
        <FormField label="For" hint={who.length === 0 ? "Nobody chosen: it goes to the supplier's owner." : undefined}>
          <MultiSelect label="For" value={who} onChange={setWho} placeholder="The supplier's owner, or choose" options={people.map((p) => ({ value: String(p.id), label: p.name }))} display="chips" />
        </FormField>
        <FormField label="Note" optional className="sm:col-span-2">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} />
        </FormField>
      </div>
      <div className="flex flex-wrap justify-end gap-[8px]">
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="primary" loading={save.isPending} disabled={!ready} onClick={() => save.mutate()}>Plan it</Button>
      </div>
    </form>
  );
}

/** One planned action, and what can be done to it. */
export function ActionRow({ item, canEdit, showVendor = false }: { item: ActionItem; canEdit: boolean; showVendor?: boolean }) {
  const { confirm, confirmDialog } = useConfirm();
  const [replanning, setReplanning] = useState(false);
  const [date, setDate] = useState(utcDay());
  const change = useReportedMutation({
    mutationFn: async (data: Record<string, unknown>) => (await vendorActionsApi.change(item.id, data)).data,
    success: (_data, v) => (v.status === 'done' ? `Done: ${item.title}` : v.status === 'cancelled' ? `Cancelled: ${item.title}` : `Planned again: ${item.title}`),
    failure: "Couldn't change the action",
    invalidate: REFRESH,
    onSuccess: () => setReplanning(false),
  });
  const Icon = KIND_META[item.kind]?.icon || ClipboardCheck;
  const late = item.status === 'scheduled' && item.overdue_days > 0;
  const people = item.people.map((p) => p.name).filter(Boolean).join(', ') || 'the owner';
  const cancel = async () => {
    if (await confirm({ title: 'Cancel this planned action?', message: `"${item.title}" will not happen.`, confirmLabel: 'Cancel the action', cancelLabel: 'Keep it', tone: 'danger' })) change.mutate({ status: 'cancelled' });
  };
  return (
    <li className="flex flex-wrap items-start gap-x-[12px] gap-y-[8px] border-b border-ds-border px-[8px] py-[10px] last:border-b-0">
      <span aria-hidden className={`mt-[2px] grid h-[32px] w-[32px] shrink-0 place-items-center rounded-ds-control ${item.status === 'failed' ? 'bg-ds-danger-soft text-ds-danger' : item.status === 'done' ? 'bg-ds-success-soft text-ds-success' : 'bg-ds-primary-soft text-ds-primary-text'}`}>
        <Icon className="h-[16px] w-[16px]" />
      </span>
      <div className="min-w-0 flex-1 basis-[16rem]">
        <p className="m-0 text-ds-body font-[600] text-ds-fg">
          {item.title}
          {showVendor && item.vendor.name && (
            <> · <Link href={`/vendor-risk/vendors/${item.vendor.id}?tab=actions`} className="rounded-ds-control font-normal text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">{item.vendor.name}</Link></>
          )}
        </p>
        <p className={`m-0 text-ds-label ${late ? 'font-[600] text-ds-danger' : 'text-ds-fg-muted'}`}>
          {whenLabel(item)} · {item.kind_label}{item.engagement ? ` · ${item.engagement.name || 'an engagement'}` : ''} · for {people}
        </p>
        {item.note && <p className="m-0 mt-[4px] whitespace-pre-wrap text-ds-label text-ds-fg-muted">{item.note}</p>}
        {item.result && (
          <p className={`m-0 mt-[4px] text-ds-label ${item.status === 'failed' ? 'text-ds-danger' : 'text-ds-fg-muted'}`}>
            {item.result}{item.done_by ? ` (${item.done_by})` : ''}
            {item.result_link && <> · <Link href={item.result_link} className="rounded-ds-control text-ds-primary-text hover:underline focus-visible:outline-none focus-visible:shadow-ds-ring">Open</Link></>}
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-[8px]">
        <StatusPill size="sm" {...statusPill(vendorAction, item.status)} />
        {canEdit && item.status === 'scheduled' && (
          <>
            <Button size="sm" leftIcon={<CheckCircle2 aria-hidden />} loading={change.isPending} onClick={() => change.mutate({ status: 'done' })}>Done</Button>
            <Button size="sm" leftIcon={<CircleSlash aria-hidden />} disabled={change.isPending} onClick={() => { void cancel(); }}>Cancel</Button>
          </>
        )}
        {canEdit && item.status !== 'scheduled' && !replanning && (
          <Button size="sm" leftIcon={<RotateCcw aria-hidden />} onClick={() => setReplanning(true)}>Plan again</Button>
        )}
        {replanning && (
          <span className="flex flex-wrap items-center gap-[6px]">
            <TextInput type="date" min={utcDay()} value={date} onChange={(e) => setDate(e.target.value)} aria-label="New date" className="w-[10rem]" />
            <Button size="sm" variant="primary" loading={change.isPending} disabled={!date} onClick={() => change.mutate({ status: 'scheduled', due_on: date })}>Plan</Button>
            <Button size="sm" onClick={() => setReplanning(false)}>Keep it as it is</Button>
          </span>
        )}
      </div>
      {confirmDialog}
    </li>
  );
}
