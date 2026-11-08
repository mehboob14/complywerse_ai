'use client';

/** The assessment's own details: its name, the person who assesses, the due date and the notes (`PUT /compliance/assessments/<id>`, only what changed). A dialog with a discard guard; a refused save keeps what was typed. */
import { useState } from 'react';
import { Button, FormField, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import type { AssessmentDetail } from './types';
import { workspaceApi, type DetailsPatch } from './workspaceApi';

const day = (v: string | null | undefined): string => (v ? v.slice(0, 10) : '');

export function DetailsDialog({ detail, onClose, onSaved }: { detail: Pick<AssessmentDetail, 'id' | 'name' | 'assessor' | 'due_date' | 'notes'>; onClose: () => void; onSaved: () => void }) {
  const was = { name: detail.name ?? '', assessor: detail.assessor ?? '', due: day(detail.due_date), notes: detail.notes ?? '' };
  const [f, setF] = useState(was);
  const set = (k: keyof typeof was, v: string) => setF((cur) => ({ ...cur, [k]: v }));
  const patch: DetailsPatch = {};
  if (f.name.trim() !== was.name.trim()) patch.name = f.name.trim();
  if (f.assessor.trim() !== was.assessor.trim()) patch.assessor = f.assessor.trim();
  if (f.due !== was.due) patch.due_date = f.due === '' ? null : f.due;
  if (f.notes.trim() !== was.notes.trim()) patch.notes = f.notes.trim();
  const dirty = Object.keys(patch).length > 0;
  const save = useReportedMutation({
    mutationFn: () => workspaceApi.updateDetails(detail.id, patch),
    success: 'Details saved',
    failure: "Couldn't save the details",
    retryable: false,
    onSuccess: () => { onSaved(); onClose(); },
  });
  return (
    <AnimatedModal isOpen onClose={onClose} title="Assessment details" size="md" dirty={dirty}
      footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!dirty || !f.name.trim()} onClick={() => save.mutate()}>Save details</Button></div>}>
      <div className="flex flex-col gap-[16px]">
        <FormField label="Name" required><TextInput value={f.name} maxLength={300} onChange={(e) => set('name', e.target.value)} /></FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Assessor" optional><TextInput value={f.assessor} maxLength={255} onChange={(e) => set('assessor', e.target.value)} /></FormField>
          <FormField label="Due date" optional><TextInput type="date" value={f.due} onChange={(e) => set('due', e.target.value)} /></FormField>
        </div>
        <FormField label="Notes" optional><Textarea rows={4} value={f.notes} onChange={(e) => set('notes', e.target.value)} /></FormField>
      </div>
    </AnimatedModal>
  );
}
