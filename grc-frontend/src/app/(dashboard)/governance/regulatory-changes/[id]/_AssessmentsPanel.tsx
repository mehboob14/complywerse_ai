'use client';

// Impact assessments: which policies, controls and processes the circular
// touches, and whether each has a gap. A short list; open one for the full
// reasoning, and raise a task from it in one click.

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ClipboardList, Loader2, Plus, Sparkles, Target } from 'lucide-react';
import { AnimatedModal, MultiSelectDropdown, RightSlidePanel, useToast } from '@/components/ui';
import { governanceApi, regulatoryApi } from '@/lib/api';
import type { TaskDraft } from './_TasksPanel';
import {
  Field, IMPACT_LEVELS, Pill, Segmented, apiError, fmtDate, inputCls, labelOf, toneOf, useAssessments, words,
  type Assessment, type Option, type TabFilter,
} from '../_ui';

const KINDS: Option[] = ['policy', 'control', 'process', 'technology'].map((k) => ({ value: k, label: words(k), tone: 'bg-primary-50 text-primary-700' }));
const YES_NO: Option[] = [
  { value: 'yes', label: 'Yes, something must change', tone: 'bg-rose-50 text-rose-700' },
  { value: 'no', label: 'No, we already cover it', tone: 'bg-emerald-50 text-emerald-700' },
];
const GRID = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(0,1fr)_5.5rem_5.5rem_7rem_1rem]';

const kindOf = (a: Assessment) => (a.impacted_item_type || a.assessment_type || 'process').toLowerCase();
const hasGap = (a: Assessment) => Boolean(a.gap_identified || a.gap_description || a.compliance_gaps);
const narrativeOf = (a: Assessment) => a.impact_description || a.affected_areas || '';

/** The AI writes a label on the narrative's first line ("Policy 'X' — update"); use it when no record is named. */
function titleOf(a: Assessment) {
  const first = narrativeOf(a).split('\n')[0].trim();
  return a.impacted_item_name || (first && !first.toLowerCase().startsWith('control ') ? first : null) || `${words(kindOf(a))} #${a.id}`;
}

function taskFrom(a: Assessment): TaskDraft {
  const kind = kindOf(a);
  const title = titleOf(a);
  const gap = [a.gap_description, a.compliance_gaps].find((t) => t && !/^action needed:/i.test(t));
  return {
    title: `Remediate: ${title}`.slice(0, 200),
    description: gap || narrativeOf(a) || `Review and update ${title}`,
    task_type: kind === 'control' ? 'control_update' : kind === 'policy' ? 'policy_update' : 'process_change',
    priority: ['critical', 'high', 'medium', 'low'].includes(a.impact_level) ? a.impact_level : 'low',
    impact_assessment_id: a.id,
    linked_policy_id: kind === 'policy' ? a.impacted_item_id ?? null : null,
    linked_control_id: kind === 'control' ? a.impacted_item_id ?? null : null,
  };
}

export default function AssessmentsPanel({ changeId, onTask, onRerun, rerunning, initial = {} }: {
  changeId: number; onTask: (draft: TaskDraft) => void; onRerun: () => void; rerunning: boolean; initial?: TabFilter;
}) {
  const { data: assessments = [], isLoading } = useAssessments(changeId);
  const [gapsOnly, setGapsOnly] = useState(!!initial.gapsOnly);
  const [viewing, setViewing] = useState<Assessment | null>(null);
  const [adding, setAdding] = useState(false);
  const gaps = assessments.filter(hasGap).length;
  const shown = gapsOnly ? assessments.filter(hasGap) : assessments;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-slate-600">
          <b className="font-semibold text-slate-900">{assessments.length}</b> assessment{assessments.length === 1 ? '' : 's'}
          {assessments.length > 0 && <> · <span className="text-rose-700">{gaps} with a gap</span> · <span className="text-emerald-700">{assessments.length - gaps} covered</span></>}
        </p>
        {gaps > 0 && (
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" checked={gapsOnly} onChange={(e) => setGapsOnly(e.target.checked)} className="rounded border-slate-300" /> Gaps only
          </label>
        )}
        <div className="ml-auto flex gap-2">
          <button type="button" onClick={onRerun} disabled={rerunning}
            title="Read the circular again and redo the AI assessments. Ones you added stay."
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            {rerunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Re-run AI
          </button>
          <button type="button" onClick={() => setAdding(true)} className="btn-primary flex h-8 items-center gap-1.5 px-3 text-xs">
            <Plus className="h-4 w-4" /> Add assessment
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className={`${GRID} hidden border-b border-slate-200 bg-slate-50 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-slate-500 sm:grid`}>
          <span>What it affects</span><span>Impact</span><span>Gap</span><span /><span />
        </div>
        {isLoading ? (
          <p className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading assessments…</p>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center px-4 py-10 text-center text-sm text-slate-500">
            <Target className="mb-2 h-8 w-8 text-slate-300" />
            {assessments.length === 0 ? 'No impact assessments yet. Re-run the AI, or add one yourself.' : 'None with a gap.'}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {shown.map((a) => (
              <li key={a.id} onClick={() => setViewing(a)} className={`${GRID} cursor-pointer px-4 py-2.5 hover:bg-slate-50`}>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{titleOf(a)}</p>
                  <p className="text-[11px] text-slate-500">{words(kindOf(a))}{a.assessment_date && ` · ${fmtDate(a.assessment_date)}`}</p>
                </div>
                <span className="hidden sm:block"><Pill tone={toneOf(IMPACT_LEVELS, a.impact_level)}>{labelOf(IMPACT_LEVELS, a.impact_level)}</Pill></span>
                <Pill tone={hasGap(a) ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}>{hasGap(a) ? 'Gap' : 'Covered'}</Pill>
                <button type="button" onClick={(e) => { e.stopPropagation(); onTask(taskFrom(a)); }}
                  className="hidden items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-50 sm:inline-flex">
                  <ClipboardList className="h-3.5 w-3.5" /> Create task
                </button>
                <ChevronRight className="hidden h-4 w-4 text-slate-300 sm:block" />
              </li>
            ))}
          </ul>
        )}
      </div>

      {viewing && (
        <RightSlidePanel isOpen onClose={() => setViewing(null)} width="w-full max-w-2xl" title={titleOf(viewing)}
          subtitle={[words(kindOf(viewing)), viewing.assessor_name && `assessed by ${viewing.assessor_name}`,
            viewing.assessment_date && fmtDate(viewing.assessment_date)].filter(Boolean).join(' · ')}
          footer={(
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setViewing(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Close</button>
              <button type="button" onClick={() => { const a = viewing; setViewing(null); onTask(taskFrom(a)); }}
                className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm">
                <ClipboardList className="h-4 w-4" /> Create task
              </button>
            </div>
          )}>
          <div className="space-y-4">
            <div className="flex flex-wrap gap-1.5">
              <Pill tone={toneOf(IMPACT_LEVELS, viewing.impact_level)}>{labelOf(IMPACT_LEVELS, viewing.impact_level)} impact</Pill>
              <Pill tone={hasGap(viewing) ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}>{hasGap(viewing) ? 'Gap found' : 'Covered'}</Pill>
            </div>
            <Section title="What changes">{narrativeOf(viewing) || '—'}</Section>
            {(viewing.gap_description || viewing.compliance_gaps) && (
              <Section title="Gap: what must change" tone="border-rose-200 bg-rose-50/50">{viewing.gap_description || viewing.compliance_gaps}</Section>
            )}
            {viewing.recommendations && <Section title="Recommendations">{viewing.recommendations}</Section>}
          </div>
        </RightSlidePanel>
      )}

      <AddAssessment changeId={changeId} open={adding} onClose={() => setAdding(false)} />
    </div>
  );
}

function Section({ title, children, tone = 'border-slate-200 bg-white' }: { title: string; children: React.ReactNode; tone?: string }) {
  return (
    <section className={`rounded-lg border px-3 py-2.5 ${tone}`}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-800">{children}</p>
    </section>
  );
}

function AddAssessment({ changeId, open, onClose }: { changeId: number; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const empty = { kind: 'policy', policyId: '', headline: '', level: 'medium', details: '', gap: 'yes', gapText: '', recs: '' };
  const [f, setF] = useState(empty);
  const { data: policies = [] } = useQuery({
    queryKey: ['regulatory-policy-choices'],
    enabled: open && f.kind === 'policy',
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const data = (await governanceApi.getDocuments({ doc_type: 'policy', limit: 200 })).data as unknown;
      const rows = (Array.isArray(data) ? data : (data as { items?: unknown[] } | null)?.items || []) as Array<{ id: number; title: string; status?: string }>;
      return rows.map((d) => ({ value: String(d.id), label: d.title, subLabel: d.status ? words(d.status) : undefined }));
    },
  });
  const create = useMutation({
    mutationFn: () => regulatoryApi.createAssessment(changeId, {
      assessment_type: f.kind,
      impacted_item_type: f.kind === 'technology' ? null : f.kind,
      impacted_item_id: f.kind === 'policy' && f.policyId ? Number(f.policyId) : null,
      impact_level: f.level,
      impact_description: [f.headline.trim(), f.details.trim()].filter(Boolean).join('\n') || null,
      gap_identified: f.gap === 'yes',
      gap_description: f.gap === 'yes' ? f.gapText.trim() || null : null,
      recommendations: f.recs.trim() || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['regulatory-assessments', changeId] });
      qc.invalidateQueries({ queryKey: ['regulatory-change', changeId] });
      setF(empty); onClose();
      toast({ title: 'Assessment added', type: 'success' });
    },
    onError: (e) => toast({ title: 'Not added', message: apiError(e), type: 'error' }),
  });
  const named = useMemo(() => !!f.headline.trim() || (f.kind === 'policy' && !!f.policyId), [f]);

  return (
    <AnimatedModal isOpen={open} onClose={onClose} size="lg" title="Add an impact assessment"
      footer={(
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
          <button type="submit" form="add-assessment" disabled={!named || create.isPending} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-sm disabled:opacity-50">
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Add assessment
          </button>
        </div>
      )}>
      <form id="add-assessment" className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); if (named) create.mutate(); }}>
        <Field label="What does it affect?">
          <Segmented value={f.kind} options={KINDS} onChange={(v) => setF({ ...f, kind: v, policyId: '' })} label="Affects" />
        </Field>
        {f.kind === 'policy' && (
          <Field label="Policy" hint="Or describe it below if it isn't in the list.">
            <MultiSelectDropdown title="Pick a policy" triggerVariant="input" size="md" multiSelect={false} autoApply forceSearch
              showAvatars={false} items={policies} selectedValues={f.policyId ? [f.policyId] : []}
              onApply={(v) => setF({ ...f, policyId: v[0] || '' })} />
          </Field>
        )}
        <Field label={f.kind === 'policy' && f.policyId ? 'Headline (optional)' : 'What is affected'}>
          <input value={f.headline} onChange={(e) => setF({ ...f, headline: e.target.value })} className={inputCls}
            placeholder={f.kind === 'process' ? 'e.g. Customer onboarding' : f.kind === 'technology' ? 'e.g. Core banking system' : 'e.g. Update the retention section'} />
        </Field>
        <Field label="Impact"><Segmented value={f.level} options={IMPACT_LEVELS} onChange={(v) => setF({ ...f, level: v })} label="Impact" /></Field>
        <Field label="What changes for us">
          <textarea rows={3} value={f.details} onChange={(e) => setF({ ...f, details: e.target.value })} className={inputCls}
            placeholder="Which clause drives it, and what it means in practice" />
        </Field>
        <Field label="Is there a gap?"><Segmented value={f.gap} options={YES_NO} onChange={(v) => setF({ ...f, gap: v })} label="Gap" /></Field>
        {f.gap === 'yes' && (
          <Field label="What must change">
            <textarea rows={2} value={f.gapText} onChange={(e) => setF({ ...f, gapText: e.target.value })} className={inputCls}
              placeholder="The gap between what we do today and what the circular requires" />
          </Field>
        )}
        <Field label="Recommendations (optional)">
          <textarea rows={2} value={f.recs} onChange={(e) => setF({ ...f, recs: e.target.value })} className={inputCls} />
        </Field>
      </form>
    </AnimatedModal>
  );
}
