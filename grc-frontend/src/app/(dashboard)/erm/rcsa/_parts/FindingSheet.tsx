'use client';

// Raise a finding from a unit: what was found (a control gap, a weakness, a process issue or a risk), how serious, what to do and by when, and who owns putting it right. The unit is
// the finding's home, so it is not asked. Validation is said in words beside the field; a failed save is shown at the top with what was typed kept and a Retry; Escape asks before it
// throws typed input away. The server stores the finding as open; linking it to a risk or a control and making a mitigation action happen afterwards, in the Findings register.
import { useState } from 'react';
import { Button, Combobox, FormError, FormField, Select, Sheet, TextInput, Textarea, useReportedMutation } from '@/components/ui/ds';
import { rcsaApi } from '@/lib/api';
import { findingSeverity, findingType, optionsOf } from '@/lib/statuses/rcsa';
import { KEYS, peopleOptions, usePeople } from './rcsaData';

export function FindingSheet({ open, assessmentId, unit, suggestion, onClose, invalidate }: {
  open: boolean; assessmentId: number; unit: string; suggestion?: string; onClose: () => void; invalidate?: ReadonlyArray<readonly unknown[]>;
}) {
  const [type, setType] = useState('control_gap');
  const [severity, setSeverity] = useState('medium');
  const [title, setTitle] = useState(suggestion ?? '');
  const [description, setDescription] = useState('');
  const [due, setDue] = useState('');
  const [owner, setOwner] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const people = usePeople(open);
  const blank = !title.trim();
  const reset = () => { setTitle(suggestion ?? ''); setDescription(''); setDue(''); setOwner(null); setType('control_gap'); setSeverity('medium'); setTouched(false); setProblem(null); };

  const raise = useReportedMutation({
    mutationFn: () => rcsaApi.createFinding(assessmentId, {
      finding_type: type, severity, title: title.trim(), description: description.trim() || null,
      remediation_due_date: due ? `${due}T00:00:00` : null, remediation_owner_id: owner ? Number(owner) : null,
    }),
    success: () => ({ title: 'Finding raised', message: 'It is open in the Findings register.' }),
    failure: "The finding wasn't saved",
    toast: 'success',
    invalidate: [KEYS.findings, KEYS.work, KEYS.summary, ...(invalidate ?? [])],
    onSuccess: () => { reset(); onClose(); },
    onError: (e) => setProblem(e),
  });
  const submit = () => {
    setTouched(true);
    if (blank) return;
    setProblem(null);
    raise.mutate();
  };

  return (
    <Sheet
      open={open}
      onClose={() => { reset(); onClose(); }}
      title="Raise a finding"
      subtitle={unit}
      width="md"
      dirty={!!(title.trim() || description.trim() || due || owner) && !raise.isPending}
      footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={() => { reset(); onClose(); }}>Cancel</Button><Button variant="primary" loading={raise.isPending} onClick={submit}>Raise finding</Button></div>}
    >
      <div className="flex flex-col gap-[12px]">
        <FormError title="The finding wasn't saved" error={problem} onRetry={submit} />
        <FormField label="What was found" required error={touched && blank ? 'Name the finding in a few words.' : undefined}>
          <TextInput value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} />
        </FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Kind"><Select value={type} onChange={(e) => setType(e.target.value)}>{optionsOf(findingType).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
          <FormField label="How serious"><Select value={severity} onChange={(e) => setSeverity(e.target.value)}>{optionsOf(findingSeverity).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></FormField>
        </div>
        <FormField label="What to do about it" optional><Textarea rows={4} maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} /></FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Fix by" optional><TextInput type="date" value={due} onChange={(e) => setDue(e.target.value)} /></FormField>
          <FormField label="Owner" optional hint={people.isError ? 'People could not be loaded; you can set the owner later.' : undefined}>
            <Combobox label="Owner" options={peopleOptions(people.data)} value={owner} onChange={setOwner} placeholder={people.isLoading ? 'Loading people' : 'Not set'} clearable disabled={people.isError} />
          </FormField>
        </div>
      </div>
    </Sheet>
  );
}
