'use client';

// Two small forms of the questionnaire workspace, each a kit Sheet: the name of a section (new or renamed) and the questionnaire's own details (name, description, category, version).
// The section's name is checked against the draft (no empty name, none that another section already has); the details are saved at once, apart from the questions.
import { useState } from 'react';
import { Button, FormError, FormField, Sheet, TextInput, Textarea, useReportedMutation } from '@/components/ui/ds';
import { rcsaApi } from '@/lib/api';
import { detailsPayload, detailsProblems, type TemplateDetails } from '@/lib/rcsa/templatesModel';
import { KEYS } from '../../../_parts/rcsaData';

export function SectionSheet({ open, title, initial, problemFor, onSave, onClose, nonce }: {
  open: boolean; title: string; initial: string; problemFor: (name: string) => string; onSave: (name: string) => void; onClose: () => void; nonce: number;
}) {
  return <SectionForm key={nonce} open={open} title={title} initial={initial} problemFor={problemFor} onSave={onSave} onClose={onClose} />;
}

function SectionForm({ open, title, initial, problemFor, onSave, onClose }: { open: boolean; title: string; initial: string; problemFor: (name: string) => string; onSave: (name: string) => void; onClose: () => void }) {
  const [name, setName] = useState(initial);
  const [touched, setTouched] = useState(false);
  const problem = problemFor(name);
  const submit = () => { setTouched(true); if (!problem) onSave(name); };
  return (
    <Sheet open={open} onClose={onClose} title={title} width="sm" dirty={name !== initial} footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={submit}>Save section</Button></div>}>
      <FormField label="Section name" required error={touched ? problem : undefined} hint="A section is kept once it has a question.">
        <TextInput value={name} maxLength={255} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
      </FormField>
    </Sheet>
  );
}

export function DetailsSheet({ open, templateId, initial, onClose, nonce }: { open: boolean; templateId: number; initial: TemplateDetails; onClose: () => void; nonce: number }) {
  return <DetailsForm key={nonce} open={open} templateId={templateId} initial={initial} onClose={onClose} />;
}

function DetailsForm({ open, templateId, initial, onClose }: { open: boolean; templateId: number; initial: TemplateDetails; onClose: () => void }) {
  const [d, setD] = useState<TemplateDetails>(initial);
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const bad = detailsProblems(d);
  const save = useReportedMutation({
    mutationFn: () => rcsaApi.updateTemplate(templateId, detailsPayload(d)),
    success: 'Details saved',
    failure: "The details weren't saved",
    toast: 'success',
    invalidate: [KEYS.template(templateId), KEYS.templates],
    onSuccess: onClose,
    onError: (e) => setProblem(e),
  });
  const submit = () => {
    setTouched(true);
    if (bad.name || bad.category || bad.version) return;
    setProblem(null);
    save.mutate();
  };
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);
  return (
    <Sheet open={open} onClose={onClose} title="Questionnaire details" width="md" dirty={dirty && !save.isPending} footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} onClick={submit}>Save details</Button></div>}>
      <div className="flex flex-col gap-[12px]">
        <FormError title="The details weren't saved" error={problem} onRetry={submit} />
        <FormField label="Name" required error={touched ? bad.name : undefined}><TextInput value={d.name} maxLength={255} onChange={(e) => setD({ ...d, name: e.target.value })} /></FormField>
        <FormField label="Description" optional><Textarea rows={3} maxLength={2000} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} /></FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Kind of risk" required error={touched ? bad.category : undefined}><TextInput value={d.category} maxLength={100} onChange={(e) => setD({ ...d, category: e.target.value })} /></FormField>
          <FormField label="Version" required error={touched ? bad.version : undefined}><TextInput value={d.version} maxLength={50} onChange={(e) => setD({ ...d, version: e.target.value })} /></FormField>
        </div>
      </div>
    </Sheet>
  );
}
