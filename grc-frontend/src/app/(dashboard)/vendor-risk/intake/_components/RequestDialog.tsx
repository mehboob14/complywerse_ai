'use client';

// "Request vendor": the few facts that start a request (name, website, department, urgency, what it is for). The request is saved as a draft and opens next, where the rest of the
// questions are answered and it is submitted. A name or website already on record does not stop it: the sheet stays open, says what it may be, and says the request was kept all the same.
import { useEffect, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Button, FormError, FormField, Select, Sheet, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { intakeApi, requestsKey, type Duplicate, type Urgency } from '../../_lib/intakeApi';
import DuplicateBox from './DuplicateBox';

const URGENCIES: Array<{ value: Urgency; label: string }> = [
  { value: 'low', label: 'Low: no fixed date' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High: blocked without it' },
];

export default function RequestDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const form = useId();
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [department, setDepartment] = useState('');
  const [urgency, setUrgency] = useState<Urgency>('normal');
  const [use, setUse] = useState('');
  const [filed, setFiled] = useState<{ id: number; duplicates: Duplicate[] } | null>(null);
  const [problem, setProblem] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setName(''); setWebsite(''); setDepartment(''); setUrgency('normal'); setUse(''); setFiled(null); setProblem(null);
  }, [open]);

  const start = useReportedMutation({
    mutationFn: async () => (await intakeApi.create({
      name: name.trim(), website: website.trim() || undefined, department: department.trim() || undefined,
      urgency, intended_use: use.trim() || undefined,
    })).data,
    // a clean request opens at once; one that may be a duplicate stays here and says so
    success: (made) => ({ title: 'Request started', message: made.duplicates.length === 0 ? 'Answer the rest and submit it.' : 'It is saved as a draft. Check the matches first.' }),
    failure: 'The request could not be started',
    toast: 'success',
    onError: (e) => setProblem(e),
    invalidate: [requestsKey],
    onSuccess: (made) => {
      setProblem(null);
      if (made.duplicates.length === 0) {
        onClose();
        router.push(`/vendor-risk/intake/${made.id}`);
      } else {
        setFiled(made);
      }
    },
  });

  const locked = filed !== null;
  const typed = !locked && (name.trim() !== '' || website.trim() !== '' || department.trim() !== '' || use.trim() !== '');
  return (
    <Sheet
      open={open} onClose={onClose} title="Request vendor" width="md" dirty={typed && !start.isPending}
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          {filed ? (
            <>
              <Button onClick={onClose}>Done</Button>
              <Button variant="primary" onClick={() => { onClose(); router.push(`/vendor-risk/intake/${filed.id}`); }}>Continue request</Button>
            </>
          ) : (
            <>
              <Button onClick={onClose}>Cancel</Button>
              <Button type="submit" form={form} variant="primary" disabled={!name.trim()} loading={start.isPending}>Start request</Button>
            </>
          )}
        </div>
      )}
    >
      <form id={form} className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); if (name.trim() && !start.isPending) start.mutate(); }}>
        <FormError title="The request could not be started" error={problem} onRetry={() => start.mutate()} />
        <FormField label="Vendor name" required>
          <TextInput maxLength={255} value={name} disabled={locked} placeholder="Acme Analytics" onChange={(e) => setName(e.target.value)} />
        </FormField>
        <FormField label="Website" optional hint="Helps spot a vendor we already use.">
          <TextInput value={website} disabled={locked} placeholder="acme.com" onChange={(e) => setWebsite(e.target.value)} />
        </FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Your department" optional>
            <TextInput maxLength={120} value={department} disabled={locked} placeholder="Marketing" onChange={(e) => setDepartment(e.target.value)} />
          </FormField>
          <FormField label="Urgency">
            <Select value={urgency} disabled={locked} onChange={(e) => setUrgency(e.target.value as Urgency)}>
              {URGENCIES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </Select>
          </FormField>
        </div>
        <FormField label="Intended use" optional hint="Include any data they would see.">
          <Textarea rows={3} value={use} disabled={locked} placeholder="Campaign attribution using hashed email addresses." onChange={(e) => setUse(e.target.value)} />
        </FormField>
      </form>
      {filed && (
        <div className="mt-[12px] flex flex-col gap-[8px]">
          <DuplicateBox title="This may already be approved" matches={filed.duplicates} />
          <p className="text-ds-body text-ds-fg-body">Your request was still saved, as a draft. Check these first, then finish and submit it.</p>
        </div>
      )}
    </Sheet>
  );
}
