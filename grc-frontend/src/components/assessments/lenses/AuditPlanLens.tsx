'use client';

/**
 * The NCA cybersecurity audit plan: the audits and reviews the organization plans, with who leads, when, and what each will look at. An entry is added and edited in a form (one
 * Save, a guard against losing typed input), removed after a confirmation, and can ask the AI for scope, methods and evidence to collect. The status levels and SLA days of the
 * plan are the module's settings behind the Settings view (the shared settings panel).
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button, DebouncedSearch, EmptyState, ErrorState, FormField, Menu, MultiSelect, Notice, RegisterTable, SegmentedControl, Select, SkeletonLines, StatusPill, Textarea, TextInput, useAddressState, useConfirm, useReportedMutation, type ListOption, type RegisterColumn } from '@/components/ui/ds';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import ModuleSettingsPanel, { SlaBadge, type SlaState } from '@/components/settings/ModuleSettingsPanel';
import { listOf, oneOf, text } from '@/lib/addressState';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { rowCountText } from '@/components/ui/ds/tableModel';
import apiClient from '@/lib/api';
import { EMPTY, formatCount, formatDate, formatDateTime } from '@/lib/format';
import { priority as priorityWords, statusPill } from '@/lib/status';
import { planStatus } from '@/lib/statuses/assessmentLenses';
import type { LensProps } from '../workspace/lens';
import { useTenantUsers } from '../workspace/lenses/useFacts';
import { adviceOf, AUDIT_TYPES, bodyOf, countPlan, ENTRY_TYPES, formOf, formProblem, PLAN_PRIORITIES, PLAN_STATUSES, TEAMS, type PlanEntry, type PlanForm } from './auditPlanModel';
import { LensFigures } from './LensFigures';
import { matchesText } from './lensData';

const SCHEMA = { q: text(), status: listOf([...PLAN_STATUSES]), view: oneOf(['plan', 'settings'] as const, 'plan') };
const key = (id: number) => ['assessment-lens-audit-plan', id] as const;
const STATUS_OPTIONS: ListOption[] = PLAN_STATUSES.map((s) => ({ value: s, label: planStatus.label(s) }));

function EntryForm({ entry, people, onClose, onSaved, assessmentId }: { entry: PlanEntry | null; people: Array<{ id: number; label: string }>; onClose: () => void; onSaved: () => void; assessmentId: number }) {
  const was = useMemo(() => formOf(entry), [entry]);
  const [f, setF] = useState<PlanForm>(was);
  const set = (k: keyof PlanForm, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const dirty = JSON.stringify(f) !== JSON.stringify(was);
  const problem = formProblem(f);
  const save = useReportedMutation({
    mutationFn: async () => (entry ? (await apiClient.put(`/compliance/assessments/${assessmentId}/audit-plan/${entry.id}`, bodyOf(f))).data : (await apiClient.post(`/compliance/assessments/${assessmentId}/audit-plan`, bodyOf(f))).data),
    success: entry ? 'Entry saved' : 'Entry added',
    failure: "Couldn't save the entry",
    retryable: false,
    onSuccess: () => { onSaved(); onClose(); },
  });
  const area = (k: keyof PlanForm, label: string, placeholder?: string) => <FormField label={label} optional><Textarea rows={2} value={f[k]} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} /></FormField>;
  const line = (k: keyof PlanForm, label: string, placeholder?: string) => <FormField label={label} optional><TextInput value={f[k]} placeholder={placeholder} onChange={(e) => set(k, e.target.value)} /></FormField>;
  return (
    <AnimatedModal isOpen onClose={onClose} title={entry ? `Edit ${entry.audit_id || 'the entry'}` : 'Add an audit or review'} size="lg" dirty={dirty}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          {problem && dirty && <span role="status" className="mr-auto text-ds-label text-ds-danger">{problem}</span>}
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!dirty || !!problem} onClick={() => save.mutate()}>{entry ? 'Save changes' : 'Add entry'}</Button>
        </div>
      )}>
      <div className="flex flex-col gap-[16px]">
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Type"><Select value={f.entry_type} onChange={(e) => set('entry_type', e.target.value)}>{ENTRY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></FormField>
          <FormField label="Name" required><TextInput value={f.audit_name} maxLength={300} placeholder="Annual ISMS audit" onChange={(e) => set('audit_name', e.target.value)} /></FormField>
          <FormField label="Team responsible" optional><Select value={f.team_responsible} placeholder="Not set" onChange={(e) => set('team_responsible', e.target.value)}>{TEAMS.map((t) => <option key={t} value={t}>{t}</option>)}</Select></FormField>
          <FormField label="Lead auditor" optional>
            <Select value={f.lead_auditor} placeholder="Not set" onChange={(e) => set('lead_auditor', e.target.value)}>
              {f.lead_auditor && !people.some((p) => p.label === f.lead_auditor) && <option value={f.lead_auditor}>{f.lead_auditor}</option>}
              {people.map((p) => <option key={p.id} value={p.label}>{p.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Audit type" optional><Select value={f.audit_type} placeholder="Not set" onChange={(e) => set('audit_type', e.target.value)}>{AUDIT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}</Select></FormField>
          <FormField label="Status"><Select value={f.status} onChange={(e) => set('status', e.target.value)}>{PLAN_STATUSES.map((s) => <option key={s} value={s}>{planStatus.label(s)}</option>)}</Select></FormField>
          <FormField label="Priority" optional><Select value={f.priority} placeholder="Not set" onChange={(e) => set('priority', e.target.value)}>{PLAN_PRIORITIES.map((p) => <option key={p} value={p}>{priorityWords.label(p)}</option>)}</Select></FormField>
        </div>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <div className="sm:col-span-2">{area('scope', 'Scope', 'What the audit covers')}</div>
          {area('methods', 'Methods', 'Interviews, document review, observation')}
          {area('criteria', 'Criteria', 'Standards and criteria')}
          {area('sampling', 'Sampling')}
          {area('evidence_needed', 'Evidence needed')}
        </div>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          {line('duration', 'Duration', '2 weeks')}
          {line('schedule', 'Schedule')}
          <FormField label="Start" optional><TextInput type="date" value={f.audit_start} onChange={(e) => set('audit_start', e.target.value)} /></FormField>
          <FormField label="End" optional><TextInput type="date" value={f.audit_end} onChange={(e) => set('audit_end', e.target.value)} /></FormField>
          {line('cost', 'Cost', 'SAR 50,000')}
          <div className="sm:col-span-2">{area('comment', 'Comment')}</div>
        </div>
      </div>
    </AnimatedModal>
  );
}

export default function AuditPlanLens({ assessmentId, readOnly }: LensProps) {
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const people = useTenantUsers();
  const [a, set] = useAddressState(SCHEMA);
  const [form, setForm] = useState<PlanEntry | null | 'new'>(null);
  const [open, setOpen] = useState<Array<string | number>>([]);
  const q = useQuery({ queryKey: key(assessmentId), staleTime: 15_000, queryFn: async () => (await apiClient.get(`/compliance/assessments/${assessmentId}/audit-plan`)).data as { entries: PlanEntry[] } });
  const refresh = () => { void qc.invalidateQueries({ queryKey: key(assessmentId) }); };
  const remove = useReportedMutation({
    mutationFn: async (id: number) => apiClient.delete(`/compliance/assessments/${assessmentId}/audit-plan/${id}`),
    success: 'Entry deleted',
    failure: "Couldn't delete the entry",
    retryable: false,
    onSuccess: refresh,
  });
  const advise = useReportedMutation({
    mutationFn: async (id: number) => (await apiClient.post(`/compliance/assessments/${assessmentId}/audit-plan/${id}/ai-recommendation`)).data,
    success: 'AI recommendation ready: open the entry to read it',
    failure: "Couldn't get a recommendation",
    onSuccess: refresh,
  });
  const entries = q.data?.entries ?? [];
  const rows = useMemo(() => entries.filter((e) => (a.status.length === 0 || a.status.includes(e.status || 'planned')) && matchesText(`${e.audit_id} ${e.audit_name} ${e.lead_auditor} ${e.team_responsible}`, a.q)), [entries, a.q, a.status]);
  const counts = countPlan(entries);

  const view = <SegmentedControl label="View" name="audit-plan-view" value={a.view} onChange={(v) => set({ view: v })} options={[{ value: 'plan', label: 'Audit plan' }, { value: 'settings', label: 'Settings' }]} />;
  if (a.view === 'settings') {
    return (
      <div className="flex flex-col gap-[16px]">
        <div className="flex flex-wrap items-center justify-between gap-[12px]">{view}<p className="text-ds-label text-ds-fg-muted">Status levels, SLA days and extra fields for audits and reviews in the plan.</p></div>
        <ModuleSettingsPanel moduleKey="internal_audit" />
      </div>
    );
  }
  if (q.isPending) return <SkeletonLines lines={5} label="Loading the audit plan" />;
  if (q.isError || !q.data) return <ErrorState title="Couldn't load the audit plan" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;

  const columns: Array<RegisterColumn<PlanEntry>> = [
    {
      key: 'entry', header: 'Entry', isRowHeader: true, width: 'w-[36%]',
      cell: (e) => (<span className="block min-w-0"><span className="block text-ds-label text-ds-fg-muted">{e.audit_id || EMPTY} · {e.entry_type || 'Audit'}</span><span className="line-clamp-2 break-words text-ds-body text-ds-fg" title={e.audit_name ?? ''}>{e.audit_name || EMPTY}</span></span>),
    },
    { key: 'team', header: 'Team', priority: 2, card: 'meta', cell: (e) => <span className="text-ds-body text-ds-fg-body">{e.team_responsible || EMPTY}</span> },
    { key: 'lead', header: 'Lead auditor', priority: 2, card: 'meta', cell: (e) => <span className="text-ds-body text-ds-fg-body">{e.lead_auditor || EMPTY}</span> },
    { key: 'when', header: 'When', priority: 3, card: 'meta', cell: (e) => <span className="text-ds-body text-ds-fg-body">{e.audit_start ? `${formatDate(e.audit_start, { calendar: true })}${e.audit_end ? ` to ${formatDate(e.audit_end, { calendar: true })}` : ''}` : EMPTY}</span> },
    { key: 'status', header: 'Status', card: 'meta', cell: (e) => <StatusPill {...statusPill(planStatus, e.status || 'planned')} size="sm" /> },
    { key: 'priority', header: 'Priority', priority: 3, card: 'meta', cell: (e) => (e.priority ? <StatusPill {...statusPill(priorityWords, e.priority)} size="sm" /> : <span className="text-ds-body text-ds-fg-muted">{EMPTY}</span>) },
    { key: 'sla', header: 'SLA', priority: 3, card: 'hide', cell: (e) => <SlaBadge sla={e.sla as SlaState | null | undefined} /> },
    {
      key: 'actions', header: 'Actions', align: 'right', card: 'hide', width: 'w-[56px]',
      cell: (e) => (
        <Menu label={`Actions for ${e.audit_id || e.audit_name || 'the entry'}`} iconOnly size="sm" align="end" items={[
          { key: 'edit', label: 'Edit', icon: Pencil, hidden: readOnly, onSelect: () => setForm(e) },
          { key: 'ai', label: 'Ask AI for a recommendation', icon: Sparkles, hidden: readOnly, disabled: advise.isPending, onSelect: () => advise.mutate(e.id) },
          {
            key: 'delete', label: 'Delete', icon: Trash2, danger: true, hidden: readOnly,
            onSelect: async () => { if (await confirm({ title: `Delete ${e.audit_id || 'this entry'}?`, message: 'The audit or review is removed from the plan. This cannot be undone.', confirmLabel: 'Delete entry', tone: 'danger' })) remove.mutate(e.id); },
          },
        ]} />
      ),
    },
  ];
  const more = (e: PlanEntry) => [['Scope', e.scope], ['Methods', e.methods], ['Criteria', e.criteria], ['Sampling', e.sampling], ['Evidence needed', e.evidence_needed], ['Duration', e.duration], ['Schedule', e.schedule], ['Cost', e.cost], ['Comment', e.comment]].filter(([, v]) => v);

  return (
    <div className="flex flex-col gap-[16px]">
      {view}
      <LensFigures figures={[
        { label: 'Entries', value: formatCount(counts.total) }, { label: 'Audits', value: formatCount(counts.audits), note: `${formatCount(counts.reviews)} reviews` },
        { label: 'In progress', value: formatCount(counts.inProgress), tone: counts.inProgress ? 'warning' : 'default', note: `${formatCount(counts.planned)} planned` }, { label: 'Completed', value: formatCount(counts.completed), tone: counts.completed ? 'success' : 'default' },
      ]} />
      <div className="flex flex-wrap items-center gap-[8px]">
        <DebouncedSearch className="w-full sm:w-[280px]" label="Search the audit plan" placeholder="Search the plan" value={a.q} onSearch={(v) => set({ q: v })} />
        <MultiSelect className="w-full sm:w-auto" label="Status" showLabel placeholder="All" options={STATUS_OPTIONS} value={a.status} onChange={(v) => set({ status: v })} />
        <span className="ml-auto text-ds-label text-ds-fg-muted" role="status">{rowCountText({ shown: rows.length, total: rows.length, noun: 'entry', plural: 'entries' })}{a.q.trim() || a.status.length ? ` of ${formatCount(entries.length)}` : ''}</span>
        {!readOnly && <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setForm('new')}>Add entry</Button>}
      </div>
      {entries.length === 0 ? (
        <EmptyState kind="firstUse" icon={ClipboardList} title="No audit planned yet" description={readOnly ? 'The plan has no entry.' : 'Add the first audit or review of the plan.'} action={readOnly ? undefined : <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setForm('new')}>Add entry</Button>} />
      ) : rows.length === 0 ? (
        <EmptyState kind="noMatches" title="No entry matches" description="Change or clear the filters." onClearFilters={() => set({ q: '', status: [] })} />
      ) : (
        <RegisterTable
          caption="Audit plan" columns={columns} rows={rows} getRowId={(e) => e.id}
          expand={{ open, onChange: setOpen, label: (e) => `Details of ${e.audit_id || 'the entry'}`, render: (e) => {
            const advice = adviceOf(e.ai_recommendation);
            return (
              <div className="flex flex-col gap-[12px]">
                {more(e).length === 0 && !advice && <p className="text-ds-body text-ds-fg-muted">Nothing more is recorded for this entry.</p>}
                <dl className="grid grid-cols-1 gap-x-[16px] gap-y-[8px] sm:grid-cols-2">
                  {more(e).map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-ds-label text-ds-fg-muted">{k}</dt><dd className="whitespace-pre-line break-words text-ds-body text-ds-fg">{v}</dd></div>)}
                </dl>
                {advice && (
                  <Notice tone="info" title={`AI recommendation${e.ai_recommendation_generated_at ? ` · ${formatDateTime(e.ai_recommendation_generated_at)}` : ''}`}>
                    {advice.summary && <span className="block break-words">{advice.summary}</span>}
                    {([['Scope advice', advice.scope], ['Methods', advice.methods], ['Evidence to collect', advice.evidence]] as const).filter(([, l]) => l.length > 0).map(([t, l]) => (
                      <span key={t} className="mt-[6px] block"><span className="block font-[600]">{t}</span><span className="block">{l.join(' · ')}</span></span>
                    ))}
                  </Notice>
                )}
              </div>
            );
          } }}
          cardTitle={(e) => <span className="block min-w-0"><span className="block text-ds-label text-ds-fg-muted">{e.audit_id || EMPTY}</span><span className="line-clamp-3 break-words text-ds-body font-[600] text-ds-fg">{e.audit_name || EMPTY}</span></span>}
          cardActions={(e) => !readOnly ? <Menu label={`Actions for ${e.audit_id || 'the entry'}`} iconOnly size="sm" align="end" items={[
            { key: 'edit', label: 'Edit', icon: Pencil, onSelect: () => setForm(e) },
            { key: 'ai', label: 'Ask AI for a recommendation', icon: Sparkles, onSelect: () => advise.mutate(e.id) },
            { key: 'delete', label: 'Delete', icon: Trash2, danger: true, onSelect: async () => { if (await confirm({ title: `Delete ${e.audit_id || 'this entry'}?`, message: 'The audit or review is removed from the plan. This cannot be undone.', confirmLabel: 'Delete entry', tone: 'danger' })) remove.mutate(e.id); } },
          ]} /> : null}
        />
      )}
      {form && <EntryForm assessmentId={assessmentId} entry={form === 'new' ? null : form} people={people} onClose={() => setForm(null)} onSaved={refresh} />}
      {confirmDialog}
    </div>
  );
}
