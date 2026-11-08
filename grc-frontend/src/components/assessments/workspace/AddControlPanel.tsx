'use client';

/** Add a control to the assessment: its words, its answer and its priority; the number follows the list when left empty. A drawer with a discard guard; a refused save keeps what was typed. */
import { useState } from 'react';
import { Button, FormField, Select, SidePanel, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { CONTROL_STATUS_ORDER, controlStatus } from '@/lib/statuses/assessments';
import { PRIORITIES, PRIORITY_LABEL, UNCATEGORIZED } from './itemModel';
import { workspaceApi, type NewControl } from './workspaceApi';

const EMPTY = { number: '', domain: '', description: '', status: 'in_progress', priority: 'medium', gap: '', fix: '' };

export function AddControlPanel({ assessmentId, domains, onClose, onAdded }: { assessmentId: number; domains: readonly string[]; onClose: () => void; onAdded: () => void }) {
  const [f, setF] = useState(EMPTY);
  const set = (field: keyof typeof EMPTY, value: string) => setF((cur) => ({ ...cur, [field]: value }));
  const dirty = JSON.stringify(f) !== JSON.stringify(EMPTY);
  const create = useReportedMutation({
    mutationFn: () => {
      const body: NewControl = { control_description: f.description.trim(), compliance_status: f.status, priority: f.priority };
      if (f.number.trim()) body.item_number = f.number.trim();
      if (f.domain.trim()) body.area_domain = f.domain.trim();
      if (f.gap.trim()) body.gaps_identified = f.gap.trim();
      if (f.fix.trim()) body.proposed_solution = f.fix.trim();
      return workspaceApi.addItem(assessmentId, body);
    },
    success: 'Control added',
    failure: "Couldn't add the control",
    retryable: false,
    onSuccess: () => { onAdded(); onClose(); },
  });
  return (
    <SidePanel open onClose={onClose} title="Add a control" width="md" dockFrom={Infinity} dirty={dirty}
      footer={<div className="flex flex-wrap justify-end gap-[8px]"><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={create.isPending} disabled={!f.description.trim()} onClick={() => create.mutate()}>Add control</Button></div>}>
      <div className="flex flex-col gap-[16px]">
        <FormField label="Control" required><Textarea rows={3} value={f.description} onChange={(e) => set('description', e.target.value)} /></FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Number" hint="Left empty, it follows the list."><TextInput value={f.number} maxLength={50} onChange={(e) => set('number', e.target.value)} /></FormField>
          <FormField label="Domain">
            <>
              <TextInput list="add-control-domains" value={f.domain} placeholder={UNCATEGORIZED} onChange={(e) => set('domain', e.target.value)} />
              <datalist id="add-control-domains">{domains.filter((d) => d !== UNCATEGORIZED).map((d) => <option key={d} value={d} />)}</datalist>
            </>
          </FormField>
          <FormField label="Answer"><Select value={f.status} onChange={(e) => set('status', e.target.value)}>{CONTROL_STATUS_ORDER.map((s) => <option key={s} value={s}>{controlStatus.label(s)}</option>)}</Select></FormField>
          <FormField label="Priority"><Select value={f.priority} onChange={(e) => set('priority', e.target.value)}>{PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}</Select></FormField>
        </div>
        <FormField label="Gap" optional><Textarea rows={2} value={f.gap} onChange={(e) => set('gap', e.target.value)} /></FormField>
        <FormField label="Proposed fix" optional><Textarea rows={2} value={f.fix} onChange={(e) => set('fix', e.target.value)} /></FormField>
      </div>
    </SidePanel>
  );
}
