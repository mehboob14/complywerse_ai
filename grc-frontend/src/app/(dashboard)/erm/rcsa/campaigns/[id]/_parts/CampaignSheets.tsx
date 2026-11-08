'use client';

// The two things the risk team does to a campaign besides running it: change its details (name, note, the two days) and add units (a business unit that was not part of it, with an assessor
// if one is known). The server cannot change the assessor of a unit that already exists, nor remove a unit, so neither is offered: the sheet for units lists only the business units that are
// not in the campaign yet. Both sheets say a failure at the top with what was typed kept, ask before Escape throws input away, and give the days as written (no zone).
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient, { rcsaApi } from '@/lib/api';
import { Button, Combobox, ErrorState, FormError, FormField, MultiSelect, Notice, Sheet, TextInput, Textarea, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { KEYS, peopleOptions, usePeople } from '../../../_parts/rcsaData';

export interface Details { id: number; name: string; description: string | null; start_date: string | null; end_date: string | null }

export function EditCampaignSheet({ open, details, onClose }: { open: boolean; details: Details; onClose: () => void }) {
  const [name, setName] = useState(details.name);
  const [note, setNote] = useState(details.description ?? '');
  const [start, setStart] = useState((details.start_date ?? '').slice(0, 10));
  const [due, setDue] = useState((details.end_date ?? '').slice(0, 10));
  const [touched, setTouched] = useState(false);
  const [problem, setProblem] = useState<unknown>(null);
  const bad = {
    name: name.trim() ? undefined : 'Give the campaign a name.',
    due: !due ? 'Choose the day it is due.' : start && due < start ? 'The due day cannot be before the start day.' : undefined,
  };
  const dirty = name !== details.name || note !== (details.description ?? '') || start !== (details.start_date ?? '').slice(0, 10) || due !== (details.end_date ?? '').slice(0, 10);
  const save = useReportedMutation({
    mutationFn: () => rcsaApi.updateCampaign(details.id, { name: name.trim(), description: note.trim() || null, ...(start ? { start_date: `${start}T00:00:00` } : {}), due_date: `${due}T00:00:00` }),
    success: 'Campaign details saved',
    failure: "The details weren't saved",
    toast: 'success',
    invalidate: [KEYS.campaigns, ['rcsa', 'campaign'], KEYS.work],
    onSuccess: () => onClose(),
    onError: (e) => setProblem(e),
  });
  const submit = () => { setTouched(true); if (bad.name || bad.due) return; setProblem(null); save.mutate(); };
  return (
    <Sheet
      open={open} onClose={onClose} title="Campaign details" subtitle={details.name} width="md" dirty={dirty && !save.isPending}
      footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={submit}>Save details</Button></div>}
    >
      <div className="flex flex-col gap-[12px]">
        <FormError title="The details weren't saved" error={problem} onRetry={submit} />
        <FormField label="Name" required error={touched ? bad.name : undefined}><TextInput value={name} maxLength={255} onChange={(e) => setName(e.target.value)} /></FormField>
        <div className="grid gap-[12px] sm:grid-cols-2">
          <FormField label="Starts"><TextInput type="date" value={start} onChange={(e) => setStart(e.target.value)} /></FormField>
          <FormField label="Due" required error={touched ? bad.due : undefined}><TextInput type="date" value={due} onChange={(e) => setDue(e.target.value)} /></FormField>
        </div>
        <FormField label="Note for the team" optional><Textarea rows={4} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /></FormField>
      </div>
    </Sheet>
  );
}

interface Unit { id: number; name: string }

export function AddUnitsSheet({ open, campaignId, tenantId, taken, onClose }: { open: boolean; campaignId: number; tenantId: number; taken: number[]; onClose: () => void }) {
  const [chosen, setChosen] = useState<string[]>([]);
  const [assessors, setAssessors] = useState<Record<string, string | null>>({});
  const [problem, setProblem] = useState<unknown>(null);
  const units = useQuery({ queryKey: ['rcsa', 'business-units', tenantId], queryFn: async () => (await apiClient.get(`/tenants/${tenantId}/business-units`)).data as Unit[], enabled: open });
  const people = usePeople(open);
  const options = useMemo(() => (units.data ?? []).filter((u) => !taken.includes(u.id)).map((u) => ({ value: String(u.id), label: u.name })).sort((a, b) => a.label.localeCompare(b.label)), [units.data, taken]);
  const nameOf = (id: string) => options.find((o) => o.value === id)?.label ?? id;
  const reset = () => { setChosen([]); setAssessors({}); setProblem(null); };
  const add = useReportedMutation({
    mutationFn: () => rcsaApi.assignBusinessUnits(campaignId, {
      business_unit_ids: chosen.map(Number),
      assessor_ids: Object.fromEntries(chosen.filter((id) => assessors[id]).map((id) => [Number(id), Number(assessors[id])])),
    }),
    success: () => `Added ${chosen.length} ${chosen.length === 1 ? 'unit' : 'units'}`,
    failure: "The units weren't added",
    toast: 'success',
    retryable: false,
    invalidate: [KEYS.campaigns, ['rcsa', 'campaign'], KEYS.work, KEYS.summary],
    onSuccess: () => { reset(); onClose(); },
    onError: (e) => setProblem(e),
  });
  const close = () => { reset(); onClose(); };
  return (
    <Sheet
      open={open} onClose={close} title="Add units" subtitle="Business units that are not in this campaign yet" width="md" dirty={chosen.length > 0 && !add.isPending}
      footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={close}>Cancel</Button><Button variant="primary" loading={add.isPending} disabled={chosen.length === 0} onClick={() => { setProblem(null); add.mutate(); }}>{chosen.length > 0 ? `Add ${chosen.length} ${chosen.length === 1 ? 'unit' : 'units'}` : 'Add units'}</Button></div>}
    >
      <div className="flex flex-col gap-[12px]">
        <FormError title="The units weren't added" error={problem} onRetry={() => add.mutate()} />
        {units.isError && <ErrorState compact title="Couldn't load the business units" message={errorMessage(units.error)} onRetry={() => { void units.refetch(); }} />}
        {units.data && options.length === 0 && <Notice tone="info" title="Every business unit is already in this campaign" />}
        {options.length > 0 && (
          <FormField label="Business units" required>
            <MultiSelect label="Business units" options={options} value={chosen} onChange={setChosen} placeholder="Choose units" />
          </FormField>
        )}
        {chosen.map((id) => (
          <FormField key={id} label={`Assessor for ${nameOf(id)}`} optional hint={people.isError ? 'People could not be loaded; the first person to open the unit becomes its assessor.' : undefined}>
            <Combobox label={`Assessor for ${nameOf(id)}`} options={peopleOptions(people.data)} value={assessors[id] ?? null} onChange={(v) => setAssessors((a) => ({ ...a, [id]: v }))} placeholder="Not set" clearable disabled={people.isError} />
          </FormField>
        ))}
        {chosen.length > 0 && <Notice tone="info">The assessor of a unit cannot be changed once it is added.</Notice>}
      </div>
    </Sheet>
  );
}
