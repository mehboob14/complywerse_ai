'use client';

// Impact assessments: which policies, controls and processes the circular touches, and whether each has a gap. A table; open one for the full reasoning and raise a task from it in one click. The AI
// can read the circular again (the ones you added stay). "Gaps only" is in the address (the Overview's "assessments with a gap" lands here that way).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, Plus, Sparkles, Target } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';
import {
  Button, Checkbox, EmptyState, ErrorState, FormField, IconButton, RegisterTable, SegmentedControl, Select, StatusPill, Textarea, TextInput, useReportedMutation, type RegisterColumn,
} from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { governanceApi, regulatoryApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { priority, statusPill } from '@/lib/status';
import { assessmentKind as kinds, gapState, optionsOf } from '@/lib/statuses/regulatory';
import { useAssessments } from '../_lib/data';
import { assessmentKind, assessmentTitle, hasGap, narrativeOf, taskForAssessment } from '../_lib/drafts';
import { PRIORITIES } from '../_lib/regulatoryModel';
import type { Assessment, TaskDraft } from '../_lib/types';

const IMPACT = PRIORITIES.map((p) => ({ value: p, label: priority.label(p) }));
const GAP_OPTIONS = [{ value: 'yes', label: 'Yes, something must change' }, { value: 'no', label: 'No, we already cover it' }];
const refresh = (changeId: number) => [['regulatory-assessments', changeId], ['regulatory-change', changeId], ['regulatory-changes']];

function Section({ title, children, gap = false }: { title: string; children: React.ReactNode; gap?: boolean }) {
  return (
    <section className={`rounded-ds-control border px-[12px] py-[8px] ${gap ? 'border-ds-danger-border bg-ds-danger-soft' : 'border-ds-border bg-ds-surface'}`}>
      <h3 className="!text-ds-label !font-[600] !text-ds-fg-muted">{title}</h3>
      <p className="m-0 mt-[4px] whitespace-pre-wrap text-ds-body text-ds-fg-body">{children}</p>
    </section>
  );
}

export default function AssessmentsTab({ changeId, gapsOnly, setGapsOnly, onTask, onRerun, rerunning }: {
  changeId: number; gapsOnly: boolean; setGapsOnly: (on: boolean) => void; onTask: (draft: TaskDraft) => void; onRerun: () => void; rerunning: boolean;
}) {
  const q = useAssessments(changeId);
  const all = useMemo(() => q.data ?? [], [q.data]);
  const [viewing, setViewing] = useState<Assessment | null>(null);
  const [adding, setAdding] = useState(false);
  const gaps = all.filter(hasGap).length;
  const shown = gapsOnly ? all.filter(hasGap) : all;

  const columns: RegisterColumn<Assessment>[] = [
    {
      key: 'what', header: 'What it affects', isRowHeader: true,
      cell: (a) => (
        <div className="min-w-0">
          <p className="m-0 line-clamp-2 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]" title={assessmentTitle(a)}>{assessmentTitle(a)}</p>
          <p className="m-0 text-ds-label text-ds-fg-muted">{kinds.label(assessmentKind(a))}{a.assessment_date ? ` · ${formatDate(a.assessment_date)}` : ''}</p>
        </div>
      ),
    },
    { key: 'impact', header: 'Impact', priority: 2, card: 'meta', cell: (a) => <StatusPill size="sm" {...statusPill(priority, a.impact_level)} /> },
    { key: 'gap', header: 'Gap', card: 'meta', cell: (a) => <StatusPill size="sm" {...statusPill(gapState, hasGap(a) ? 'gap' : 'covered')} /> },
    { key: 'task', header: '', width: 'w-[48px]', card: 'hide', cell: (a) => <IconButton label={`Create a task for ${assessmentTitle(a).slice(0, 60)}`} onClick={() => onTask(taskForAssessment(a))}><ClipboardList aria-hidden /></IconButton> },
  ];

  if (q.isError && !q.data) return <ErrorState title="Couldn't load the impact assessments" message={errorMessage(q.error)} onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined} />;

  return (
    <div className="flex flex-col gap-[12px]">
      <div className="flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
        <p className="m-0 text-ds-body text-ds-fg-body">
          <b className="font-[600] text-ds-fg">{all.length}</b>{` ${all.length === 1 ? 'assessment' : 'assessments'}`}
          {all.length > 0 && <> · <span className="text-ds-danger">{`${gaps} with a gap`}</span> · <span className="text-ds-success">{`${all.length - gaps} covered`}</span></>}
        </p>
        {gaps > 0 && <Checkbox label="Gaps only" checked={gapsOnly} onChange={(e) => setGapsOnly(e.target.checked)} />}
        <div className="ml-auto flex flex-wrap gap-[8px]">
          <Button leftIcon={<Sparkles aria-hidden />} loading={rerunning} title="Read the circular again and redo the AI assessments. The ones you added stay." onClick={onRerun}>Re-run AI</Button>
          <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setAdding(true)}>Add assessment</Button>
        </div>
      </div>

      <RegisterTable<Assessment>
        caption="Impact assessments of this change"
        columns={columns}
        rows={shown}
        getRowId={(a) => a.id}
        onRowActivate={setViewing}
        loading={q.isPending}
        cardTitle={(a) => <span className="line-clamp-3 text-ds-body font-[600] text-ds-fg [overflow-wrap:anywhere]">{assessmentTitle(a)}</span>}
        empty={(
          <EmptyState
            kind={all.length === 0 ? 'firstUse' : 'noMatches'} bare icon={Target} title={all.length === 0 ? 'No impact assessments yet' : 'None with a gap'}
            description={all.length === 0 ? 'Re-run the AI, or add one yourself.' : undefined} onClearFilters={all.length > 0 ? () => setGapsOnly(false) : undefined}
          />
        )}
      />

      <RightSlidePanel
        isOpen={!!viewing} onClose={() => setViewing(null)} width="w-full max-w-2xl" title={viewing ? assessmentTitle(viewing) : ''}
        subtitle={viewing ? [kinds.label(assessmentKind(viewing)), viewing.assessor_name && `assessed by ${viewing.assessor_name}`, viewing.assessment_date && formatDate(viewing.assessment_date)].filter(Boolean).join(' · ') : undefined}
        footer={viewing && (
          <div className="flex justify-end gap-[8px]">
            <Button onClick={() => setViewing(null)}>Close</Button>
            <Button variant="primary" leftIcon={<ClipboardList aria-hidden />} onClick={() => { const a = viewing; setViewing(null); onTask(taskForAssessment(a)); }}>Create task</Button>
          </div>
        )}
      >
        {viewing && (
          <div className="flex flex-col gap-[12px]">
            <div className="flex flex-wrap gap-[6px]">
              <StatusPill {...statusPill(priority, viewing.impact_level)} label={`${priority.label(viewing.impact_level)} impact`} />
              <StatusPill {...statusPill(gapState, hasGap(viewing) ? 'gap' : 'covered')} />
            </div>
            <Section title="What changes">{narrativeOf(viewing) || '—'}</Section>
            {(viewing.gap_description || viewing.compliance_gaps) && <Section title="Gap: what must change" gap>{viewing.gap_description || viewing.compliance_gaps}</Section>}
            {viewing.recommendations && <Section title="Recommendations">{viewing.recommendations}</Section>}
          </div>
        )}
      </RightSlidePanel>

      <AddAssessment changeId={changeId} open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function AddAssessment({ changeId, open, onClose }: { changeId: number; open: boolean; onClose: () => void }) {
  const empty = { kind: 'policy', policyId: '', headline: '', level: 'medium', details: '', gap: 'yes', gapText: '', recs: '' };
  const [f, setF] = useState(empty);
  const [problem, setProblem] = useState('');
  const policies = useQuery({
    queryKey: ['regulatory-policy-choices'], enabled: open && f.kind === 'policy', staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const data = (await governanceApi.getDocuments({ doc_type: 'policy', limit: 200 })).data as unknown;
      const rows = (Array.isArray(data) ? data : (data as { items?: unknown[] } | null)?.items || []) as Array<{ id: number; title: string; status?: string }>;
      return rows.map((d) => ({ value: String(d.id), label: d.title }));
    },
  });
  const named = !!f.headline.trim() || (f.kind === 'policy' && !!f.policyId);
  const close = () => { setF(empty); setProblem(''); onClose(); };
  const create = useReportedMutation({
    mutationFn: () => regulatoryApi.createAssessment(changeId, {
      assessment_type: f.kind, impacted_item_type: f.kind === 'technology' ? null : f.kind, impacted_item_id: f.kind === 'policy' && f.policyId ? Number(f.policyId) : null,
      impact_level: f.level, impact_description: [f.headline.trim(), f.details.trim()].filter(Boolean).join('\n') || null,
      gap_identified: f.gap === 'yes', gap_description: f.gap === 'yes' ? f.gapText.trim() || null : null, recommendations: f.recs.trim() || null,
    }),
    success: 'Assessment added', failure: "Couldn't add the assessment", retryable: false, toast: 'success', invalidate: refresh(changeId),
    onSuccess: close, onError: (e) => setProblem(errorMessage(e)),
  });
  return (
    <RightSlidePanel
      isOpen={open} onClose={close} dirty={JSON.stringify(f) !== JSON.stringify(empty)} title="Add an impact assessment" width="w-full max-w-xl"
      footer={<div className="flex justify-end gap-[8px]"><Button onClick={close}>Cancel</Button><Button variant="primary" disabled={!named} loading={create.isPending} onClick={() => { setProblem(''); create.mutate(); }}>Add assessment</Button></div>}
    >
      <form className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); if (named && !create.isPending) { setProblem(''); create.mutate(); } }}>
        <FormField label="What does it affect?">
          <SegmentedControl label="Affects" name="assessment-kind" options={optionsOf(kinds)} value={f.kind} onChange={(v) => setF({ ...f, kind: v, policyId: '' })} />
        </FormField>
        {f.kind === 'policy' && (
          <FormField label="Policy" optional hint="Or describe it below if it isn't in the list.">
            <Select value={f.policyId} onChange={(e) => setF({ ...f, policyId: e.target.value })} placeholder={policies.isPending ? 'Loading policies…' : 'Pick a policy'}>
              {(policies.data ?? []).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
            {policies.isError && <span role="alert" className="text-ds-label text-ds-danger">The policies could not be loaded. Describe it below instead.</span>}
          </FormField>
        )}
        <FormField label={f.kind === 'policy' && f.policyId ? 'Headline' : 'What is affected'} required={!(f.kind === 'policy' && f.policyId)} optional={f.kind === 'policy' && !!f.policyId}>
          <TextInput value={f.headline} maxLength={300} onChange={(e) => setF({ ...f, headline: e.target.value })} placeholder={f.kind === 'process' ? 'e.g. Customer onboarding' : f.kind === 'technology' ? 'e.g. Core banking system' : 'e.g. Update the retention section'} />
        </FormField>
        <FormField label="Impact"><SegmentedControl label="Impact" name="assessment-impact" options={IMPACT} value={f.level} onChange={(v) => setF({ ...f, level: v })} /></FormField>
        <FormField label="What changes for us" optional><Textarea rows={3} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} placeholder="Which clause drives it, and what it means in practice" /></FormField>
        <FormField label="Is there a gap?"><SegmentedControl label="Gap" name="assessment-gap" options={GAP_OPTIONS} value={f.gap} onChange={(v) => setF({ ...f, gap: v })} /></FormField>
        {f.gap === 'yes' && <FormField label="What must change" optional><Textarea rows={2} value={f.gapText} onChange={(e) => setF({ ...f, gapText: e.target.value })} placeholder="The gap between what we do today and what the circular requires" /></FormField>}
        <FormField label="Recommendations" optional><Textarea rows={2} value={f.recs} onChange={(e) => setF({ ...f, recs: e.target.value })} /></FormField>
        {problem && <p role="alert" className="m-0 text-ds-body text-ds-danger">{problem}</p>}
      </form>
    </RightSlidePanel>
  );
}

