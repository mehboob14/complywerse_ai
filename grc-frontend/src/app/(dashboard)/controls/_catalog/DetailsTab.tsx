'use client';

// The drawer's Details tab: the control's name, description, priority, progress and whether it is a key control. Saving says what it saved; a change not yet saved is reported to the drawer, which
// asks before closing over it.
import { useEffect, useState } from 'react';
import { Button, Checkbox, FormField, Select, TextInput, Textarea, useReportedMutation } from '@/components/ui/ds';
import apiClient from '@/lib/api';
import { statusPill } from '@/lib/status';
import { workProgress } from '@/lib/statuses/controls';
import { WB, type RefreshKeys } from './catalogData';
import { PROGRESS, type ControlDetail } from './catalogModel';

const PRIORITIES = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['critical', 'Critical']] as const;

export function DetailsTab({ d, keys, onDirty }: { d: ControlDetail; keys: RefreshKeys; onDirty: (dirty: boolean) => void }) {
  const initial = { name: d.name || '', description: d.description || '', priority: d.priority || 'medium', is_key_control: !!d.is_key_control, implementation_status: d.implementation_status || 'not_started' };
  const [f, setF] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const dirty = JSON.stringify(f) !== JSON.stringify(saved);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  const save = useReportedMutation({
    mutationFn: () => apiClient.patch(`${WB}/items/${d.work_item_id}`, f),
    success: { title: 'Control saved', message: 'The details are up to date.' },
    failure: "Couldn't save the control",
    invalidate: keys,
    onSuccess: () => setSaved(f),
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((cur) => ({ ...cur, [k]: v }));
  return (
    <form className="flex flex-col gap-[12px]" onSubmit={(e) => { e.preventDefault(); if (dirty && f.name.trim()) save.mutate(); }}>
      <FormField label="Name" required><TextInput value={f.name} onChange={(e) => set('name', e.target.value)} /></FormField>
      <FormField label="Description"><Textarea rows={5} value={f.description} onChange={(e) => set('description', e.target.value)} /></FormField>
      <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
        <FormField label="Priority">
          <Select value={f.priority} onChange={(e) => set('priority', e.target.value)}>{PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        </FormField>
        <FormField label="Progress">
          <Select value={f.implementation_status} onChange={(e) => set('implementation_status', e.target.value)}>{PROGRESS.map((w) => <option key={w} value={w}>{statusPill(workProgress, w).label}</option>)}</Select>
        </FormField>
      </div>
      <Checkbox label="Key control" checked={f.is_key_control} onChange={(e) => set('is_key_control', e.target.checked)} />
      <div className="flex items-center gap-[8px]">
        <Button type="submit" variant="primary" loading={save.isPending} disabled={!dirty || !f.name.trim()}>Save</Button>
        {dirty && <Button onClick={() => setF(saved)}>Discard changes</Button>}
      </div>
    </form>
  );
}
