'use client';

/**
 * Edit an assessment's details (name, description, type, method, scope, period, lead assessor, notes) in a right-hand sheet. The old panel sent only the fields that were not empty, so a
 * description or a scope could never be emptied; this one sends what the form holds, so a cleared field is cleared. Typed text is kept if the sheet is closed by mistake (it asks first).
 */
import { useEffect, useState } from 'react';
import { Button, FormField, Select, Sheet, TextInput, Textarea, useReportedMutation } from '@/components/ui/ds';
import { ermApi } from '@/lib/api';
import { ASSESSMENT_REFRESH, useAssessmentPeople } from '../../_register/assessmentData';
import { assessmentKey, type AssessmentDetail } from './workspaceData';

const TYPES: Array<[string, string]> = [['periodic', 'Periodic'], ['annual', 'Annual'], ['ad_hoc', 'Ad hoc'], ['triggered', 'Triggered']];
const METHODS: Array<[string, string]> = [['qualitative', 'Qualitative'], ['quantitative', 'Quantitative'], ['semi_quantitative', 'Semi-quantitative']];

const formOf = (a: AssessmentDetail) => ({
  name: a.name,
  description: a.description ?? '',
  assessment_type: a.assessment_type ?? 'periodic',
  methodology: a.methodology ?? 'qualitative',
  scope: a.scope ?? '',
  start: a.assessment_period_start?.slice(0, 10) ?? '',
  end: a.assessment_period_end?.slice(0, 10) ?? '',
  notes: a.notes ?? '',
  lead: a.lead_assessor_id != null ? String(a.lead_assessor_id) : '',
});

/** What the form sends: every field, an emptied one as null. */
export function editBody(f: ReturnType<typeof formOf>): Record<string, unknown> {
  const text = (s: string) => (s.trim() ? s.trim() : null);
  return {
    name: f.name.trim(),
    description: text(f.description),
    assessment_type: f.assessment_type,
    methodology: f.methodology,
    scope: text(f.scope),
    assessment_period_start: f.start || null,
    assessment_period_end: f.end || null,
    notes: text(f.notes),
    lead_assessor_id: f.lead ? Number(f.lead) : null,
  };
}

export function EditSheet({ assessment, open, onClose }: { assessment: AssessmentDetail; open: boolean; onClose: () => void }) {
  const people = useAssessmentPeople();
  const [f, setF] = useState(formOf(assessment));
  useEffect(() => { if (open) setF(formOf(assessment)); }, [open, assessment]);
  const set = (k: keyof ReturnType<typeof formOf>) => (e: { target: { value: string } }) => setF((s) => ({ ...s, [k]: e.target.value }));
  const dirty = JSON.stringify(f) !== JSON.stringify(formOf(assessment));
  const save = useReportedMutation({
    mutationFn: () => ermApi.riskAssessments.update(assessment.id, editBody(f)),
    success: { title: 'Details saved', message: 'The changes show on the assessment and the list.' },
    failure: "Couldn't save the details",
    invalidate: [[...assessmentKey(assessment.id)], ...ASSESSMENT_REFRESH],
    onSuccess: onClose,
  });
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit the assessment"
      width="md"
      dirty={dirty}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!f.name.trim() || !dirty} onClick={() => save.mutate()}>Save changes</Button>
        </div>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); if (f.name.trim() && dirty) save.mutate(); }} className="flex flex-col gap-[16px]">
        <FormField label="Name" required><TextInput value={f.name} onChange={set('name')} maxLength={255} /></FormField>
        <FormField label="Description" optional><Textarea rows={2} value={f.description} onChange={set('description')} /></FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Type"><Select value={f.assessment_type} onChange={set('assessment_type')}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
          <FormField label="Method"><Select value={f.methodology} onChange={set('methodology')}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></FormField>
        </div>
        <FormField label="Lead assessor" optional>
          <Select placeholder="Nobody" value={f.lead} onChange={set('lead')}>{(people.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}</Select>
        </FormField>
        <FormField label="Scope" optional><Textarea rows={2} value={f.scope} onChange={set('scope')} /></FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Period starts" optional><TextInput type="date" value={f.start} onChange={set('start')} /></FormField>
          <FormField label="Period ends" optional><TextInput type="date" value={f.end} onChange={set('end')} /></FormField>
        </div>
        <FormField label="Notes" optional><Textarea rows={2} value={f.notes} onChange={set('notes')} /></FormField>
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden>Save</button>
      </form>
    </Sheet>
  );
}
