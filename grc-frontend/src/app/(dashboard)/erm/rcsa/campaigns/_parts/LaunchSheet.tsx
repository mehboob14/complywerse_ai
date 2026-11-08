'use client';

// New campaign, in a sheet: which questionnaire the units answer, what the campaign is called, the period, and the two days. The campaign is made as a draft; "Start" is a separate, deliberate step
// that says who is asked (every active department, its team lead as the assessor), because nothing is sent by email. Validation is said in words beside the field; a failed save is shown at the
// top with what was typed kept and a Retry; Escape asks before it throws typed input away. The days are sent as written, with no zone (the old form sent toISOString(), which moves a day).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { rcsaApi } from '@/lib/api';
import { Button, FormError, FormField, Notice, Select, Sheet, TextInput, Textarea, useReportedMutation } from '@/components/ui/ds';
import { PERIOD_TYPES, launchBody, launchProblems, suggestPeriodLabel, type LaunchForm } from '@/lib/rcsa/campaignsModel';
import { KEYS, fetchAll } from '../../_parts/rcsaData';

interface Tpl { id: number; name: string; category: string; question_count: number }
const BLANK: LaunchForm = { templateId: '', name: '', description: '', periodType: 'quarterly', periodLabel: '', start: '', due: '' };

export function LaunchSheet({ open, onClose, initialTemplateId }: { open: boolean; onClose: () => void; initialTemplateId?: string }) {
  const router = useRouter();
  const [form, setForm] = useState<LaunchForm>({ ...BLANK, templateId: initialTemplateId ?? '' });
  const [labelTouched, setLabelTouched] = useState(false);
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const templates = useQuery({ queryKey: KEYS.templates, queryFn: () => fetchAll<Tpl>('/erm/rcsa/templates'), enabled: open });
  const problems = useMemo(() => launchProblems(form), [form]);
  const dirty = !!(form.name.trim() || form.description.trim() || form.start || form.due || form.templateId);
  const set = (patch: Partial<LaunchForm>) => setForm((f) => {
    const next = { ...f, ...patch };
    // the label follows the type and the start day until the person writes their own
    if (!labelTouched && ('start' in patch || 'periodType' in patch)) next.periodLabel = suggestPeriodLabel(next.periodType, next.start);
    return next;
  });
  const reset = () => { setForm({ ...BLANK }); setLabelTouched(false); setTouched(false); setProblem(null); };

  const create = useReportedMutation({
    mutationFn: () => rcsaApi.createCampaign(launchBody(form)),
    success: () => ({ title: 'Campaign created as a draft', message: 'Start it when you are ready: nothing is asked of anyone until then.' }),
    failure: "The campaign wasn't created",
    retryable: false,
    toast: 'success',
    invalidate: [KEYS.campaigns, KEYS.work, KEYS.summary],
    onSuccess: (r) => { const id = (r.data as { id: number }).id; reset(); onClose(); router.push(`/erm/rcsa/campaigns/${id}`); },
    onError: (e) => setProblem(e),
  });
  const submit = () => {
    setTouched(true);
    if (Object.keys(problems).length > 0) return;
    setProblem(null);
    create.mutate();
  };
  const close = () => { reset(); onClose(); };
  const show = (k: keyof LaunchForm) => (touched ? problems[k] : undefined);

  return (
    <Sheet
      open={open}
      onClose={close}
      title="New campaign"
      subtitle="A round of self-assessment for your departments"
      width="md"
      dirty={dirty && !create.isPending}
      footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={close}>Cancel</Button><Button variant="primary" loading={create.isPending} onClick={submit}>Create campaign</Button></div>}
    >
      <div className="flex flex-col gap-[12px]">
        <FormError title="The campaign wasn't created" error={problem} onRetry={submit} />
        <FormField label="Questionnaire" required error={show('templateId')} hint={templates.isError ? 'The questionnaires could not be loaded. Close this and try again.' : 'The questions every unit answers.'}>
          <Select placeholder={templates.isLoading ? 'Loading questionnaires' : 'Choose a questionnaire'} value={form.templateId} disabled={templates.isLoading || templates.isError} onChange={(e) => set({ templateId: e.target.value })}>
            {(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{`${t.name} (${t.question_count} questions)`}</option>)}
          </Select>
        </FormField>
        <FormField label="Name" required error={show('name')}>
          <TextInput value={form.name} maxLength={255} placeholder="Operational RCSA" onChange={(e) => set({ name: e.target.value })} />
        </FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="How often"><Select value={form.periodType} onChange={(e) => set({ periodType: e.target.value })}>{PERIOD_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}</Select></FormField>
          <FormField label="Period name" optional><TextInput value={form.periodLabel} maxLength={100} placeholder="Q2 2026" onChange={(e) => { setLabelTouched(true); setForm((f) => ({ ...f, periodLabel: e.target.value })); }} /></FormField>
          <FormField label="Starts" required error={show('start')}><TextInput type="date" value={form.start} onChange={(e) => set({ start: e.target.value })} /></FormField>
          <FormField label="Due" required error={show('due')}><TextInput type="date" value={form.due} onChange={(e) => set({ due: e.target.value })} /></FormField>
        </div>
        <FormField label="Note for the team" optional><Textarea rows={3} maxLength={1000} value={form.description} onChange={(e) => set({ description: e.target.value })} /></FormField>
        <Notice tone="info" title="Who is asked">Starting the campaign makes every active department a unit and its team lead the assessor. You can add units and change assessors afterwards, on the campaign&apos;s page.</Notice>
      </div>
    </Sheet>
  );
}
