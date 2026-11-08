'use client';

// The drill's result (the "Result" tab): whether the recovery time and point objectives were met, the hours it really took, what happened, and the evidence the report was filed as. One result per
// drill (the server upserts it), and a drill cannot be closed without one. A person who may edit the drill (`bcm:drills:edit`, as before) fills a form that saves as a whole: the kit's sticky bar
// (at the end of the page, so it stays in view whatever the person is reading) says "Unsaved changes", "Fix the fields in red to save" or "Saved", the hours must be whole numbers (the server
// answers a fraction with a 422 list), a failed save says what the server said in a toast that stays and carries Retry (saving the same result again is safe), and leaving the page with unsaved
// changes asks. Anyone else reads the recorded result as plain facts, not as greyed inputs. `useResultForm` holds the form, `ResultCard` draws it and `ResultBar` is the save bar.
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { bcmApi } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { FormField, SaveBar, SectionCard, Select, Textarea, useReportedMutation } from '@/components/ui/ds';
import { ClampedText, Fact, HoursInput, HoursText, LABEL_LINK } from '../../_bcm-ui';
import { EvidencePicker } from '../../_record/EvidencePicker';
import { REFRESH_ALL } from '../../bcmData';
import { TRI_OPTIONS, resultDirty, resultErrors, resultFormFrom, resultPayload, triLabel, type Drill, type ResultForm } from '../../bcmModel';

const MUTED = 'text-ds-fg-muted';

export function useResultForm(drill: Drill, canEdit: boolean) {
  const r = drill.result ?? null;
  const saved = useMemo(() => resultFormFrom(r), [r]);
  const [form, setForm] = useState<ResultForm>(saved);
  const [evidenceTitle, setEvidenceTitle] = useState<string | null>(r?.evidence_ref_title ?? null);
  const [justSaved, setJustSaved] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const errors = resultErrors(form);
  const dirty = resultDirty(saved, form);

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => { setEvidenceTitle(r?.evidence_ref_title ?? null); }, [r]);          // after a save the name is the server's
  // leaving the page with a result half written asks first (the address bar, a reload, the tab)
  useEffect(() => {
    if (!dirty || !canEdit) return undefined;
    const ask = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', ask);
    return () => window.removeEventListener('beforeunload', ask);
  }, [dirty, canEdit]);

  const save = useReportedMutation({
    mutationFn: async (payload: ReturnType<typeof resultPayload>) => (await bcmApi.drills.saveResult(drill.id, payload)).data,
    success: 'Result saved', failure: "Couldn't save the result", toast: 'errors',          // the bar says "Saved"; a failure is the toast, with Retry
    invalidate: [['bcm-drill', drill.id], ...REFRESH_ALL],
    onSuccess: () => {
      setJustSaved(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setJustSaved(false), 4000);
    },
  });
  return {
    result: r, form, errors, dirty, saving: save.isPending, justSaved, evidenceTitle,
    set: <K extends keyof ResultForm>(key: K, value: ResultForm[K]) => setForm((f) => ({ ...f, [key]: value })),
    attach: (id: number | null, title: string | null) => { setForm((f) => ({ ...f, evidence_ref_id: id })); setEvidenceTitle(title); },
    save: () => save.mutate(resultPayload(form)),
    discard: () => { setForm(saved); setEvidenceTitle(r?.evidence_ref_title ?? null); },
  };
}
export type ResultState = ReturnType<typeof useResultForm>;

export function ResultCard({ state, canEdit }: { state: ResultState; canEdit: boolean }) {
  const { result: r, form, errors, set } = state;
  const recorded = r ? `Recorded by ${r.recorded_by_name || '—'} · ${formatDateTime(r.recorded_at)}` : 'Not recorded yet';
  return (
    <SectionCard
      id="result" title="Drill result" meta={!r ? 'Required before closing' : undefined}
      info="Whether the plan's recovery time (RTO) and recovery point (RPO) objectives were met in this drill, the hours it really took, what happened, and the file that proves it. A drill cannot be closed without a recorded result."
    >
      {canEdit ? (
        <div className="flex flex-col gap-[16px]">
          <div className="grid gap-[12px] sm:grid-cols-2">
            <FormField label="RTO met?">
              <Select value={form.rto_met} onChange={(e) => set('rto_met', e.target.value as ResultForm['rto_met'])}>
                {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </FormField>
            <FormField label="RPO met?">
              <Select value={form.rpo_met} onChange={(e) => set('rpo_met', e.target.value as ResultForm['rpo_met'])}>
                {TRI_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            </FormField>
          </div>
          <div className="grid gap-[12px] sm:grid-cols-2">
            <HoursInput label="Actual recovery" info="How many hours recovery really took." value={form.actual_rto_hours} onChange={(v) => set('actual_rto_hours', v)} error={errors.actual_rto_hours} />
            <HoursInput label="Actual data loss" info="How many hours of work were really lost." value={form.actual_rpo_hours} onChange={(v) => set('actual_rpo_hours', v)} error={errors.actual_rpo_hours} />
          </div>
          <FormField label="Narrative summary" optional>
            <Textarea rows={4} value={form.summary} onChange={(e) => set('summary', e.target.value)} placeholder="What happened, what worked, what didn't…" />
          </FormField>
          <FormField label="Evidence" optional hint="The report of the test, a log or a screenshot, from Evidence Management.">
            <EvidencePicker value={form.evidence_ref_id} title={state.evidenceTitle} onChange={state.attach} />
          </FormField>
          <p className={`m-0 text-ds-label font-normal ${MUTED}`}>{recorded}</p>
        </div>
      ) : r ? (
        <div className="flex flex-col gap-[12px]">
          <dl className="grid grid-cols-2 gap-[12px] xl:grid-cols-4">
            <Fact label="RTO met?">{triLabel(r.rto_met)}</Fact>
            <Fact label="RPO met?">{triLabel(r.rpo_met)}</Fact>
            <Fact label="Actual recovery"><HoursText h={r.actual_rto_hours} /></Fact>
            <Fact label="Actual data loss"><HoursText h={r.actual_rpo_hours} /></Fact>
          </dl>
          {r.summary ? <ClampedText text={r.summary} /> : <p className={`m-0 text-ds-body ${MUTED}`}>No summary was written.</p>}
          {r.evidence_ref_id ? <Link href={`/evidence/${r.evidence_ref_id}`} className={`text-ds-body ${LABEL_LINK}`}>{`Evidence: ${r.evidence_ref_title || 'open the file'}`}</Link> : <p className={`m-0 text-ds-label ${MUTED}`}>No evidence attached.</p>}
          <p className={`m-0 text-ds-label font-normal ${MUTED}`}>{recorded}</p>
        </div>
      ) : (
        <p className={`m-0 text-ds-body ${MUTED}`}>No result has been recorded for this drill yet.</p>
      )}
    </SectionCard>
  );
}

export function ResultBar({ state, canEdit }: { state: ResultState; canEdit: boolean }) {
  return (
    <SaveBar
      label="Save the drill result" canEdit={canEdit} dirty={state.dirty} invalid={Object.keys(state.errors).length > 0} saving={state.saving} justSaved={state.justSaved}
      saveLabel={state.result ? 'Update result' : 'Save result'} onSave={state.save} onDiscard={state.discard}
    />
  );
}
