'use client';

// Edit the project itself, in a drawer that asks "Discard changes?" before it throws typed input away. The fields and what they send are the old modal's
// (editFormOf, editPayload in _model.ts: the same 17 values, the linked risks, controls and frameworks as one per line). The save is the page's (a reported mutation);
// a name is required, a completion is 0 to 100, and the server's refusal is said in its own words with the drawer left open.
import { useState } from 'react';
import { DollarSign } from 'lucide-react';
import { RightSlidePanel } from '@/components/ui';
import { Button, FormField, Select, Textarea, TextInput } from '@/components/ui/ds';
import { HEALTH_OPTIONS, PRIORITIES, STATUSES, editErrors, editFormOf, editPayload, sameForm, type EditProjectForm } from '../_model';
import type { ProjectDetail } from './_types';

export function EditProjectDrawer({ project, saving, onSubmit, onClose }: { project: ProjectDetail; saving: boolean; onSubmit: (payload: Record<string, unknown>) => void; onClose: () => void }) {
  const [initial] = useState<EditProjectForm>(() => editFormOf(project as unknown as Record<string, unknown>));
  const [form, setForm] = useState<EditProjectForm>(initial);
  const [tried, setTried] = useState(false);
  const errors = tried ? editErrors(form) : {};
  const set = (patch: Partial<EditProjectForm>) => setForm((f) => ({ ...f, ...patch }));
  const submit = () => {
    setTried(true);
    if (Object.keys(editErrors(form)).length > 0) return;
    onSubmit(editPayload(form));
  };
  // a stored word the list does not offer is kept as an option, so the box never shows a choice that was not made
  const opts = (list: string[], value: string) => (value && list.indexOf(value) < 0 ? [value, ...list] : list);

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title="Edit project"
      widthClassName="w-[680px] max-w-full"
      dirty={!sameForm(form, initial)}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={submit}>Save changes</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <FormField label="Name" required error={errors.name}><TextInput value={form.name} maxLength={255} onChange={(e) => set({ name: e.target.value })} /></FormField>
        <FormField label="Description"><Textarea rows={3} value={form.description} onChange={(e) => set({ description: e.target.value })} /></FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
          <FormField label="Status"><Select value={form.status} onChange={(e) => set({ status: e.target.value })}>{opts(STATUSES, form.status).map((s) => <option key={s} value={s}>{s}</option>)}</Select></FormField>
          <FormField label="Health"><Select value={form.health} onChange={(e) => set({ health: e.target.value })}>{opts(HEALTH_OPTIONS, form.health).map((s) => <option key={s} value={s}>{s}</option>)}</Select></FormField>
          <FormField label="Priority"><Select value={form.priority} onChange={(e) => set({ priority: e.target.value })}>{opts(PRIORITIES, form.priority).map((s) => <option key={s} value={s}>{s}</option>)}</Select></FormField>
        </div>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Owner"><TextInput value={form.project_owner_name} maxLength={255} onChange={(e) => set({ project_owner_name: e.target.value })} /></FormField>
          <FormField label="Sponsor"><TextInput value={form.sponsor} maxLength={255} onChange={(e) => set({ sponsor: e.target.value })} /></FormField>
        </div>
        <FormField label="Department"><TextInput value={form.department} maxLength={255} onChange={(e) => set({ department: e.target.value })} /></FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Start date"><TextInput type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} /></FormField>
          <FormField label="Target end date"><TextInput type="date" value={form.target_end_date} onChange={(e) => set({ target_end_date: e.target.value })} /></FormField>
        </div>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-3">
          <FormField label="Budget estimated"><TextInput type="number" inputMode="decimal" leftAdornment={<DollarSign aria-hidden />} value={form.budget_estimated} onChange={(e) => set({ budget_estimated: e.target.value })} /></FormField>
          <FormField label="Budget actual"><TextInput type="number" inputMode="decimal" leftAdornment={<DollarSign aria-hidden />} value={form.budget_actual} onChange={(e) => set({ budget_actual: e.target.value })} /></FormField>
          <FormField label="Completion" error={errors.completion_percentage}><TextInput type="number" inputMode="decimal" min={0} max={100} unit="%" value={form.completion_percentage} onChange={(e) => set({ completion_percentage: e.target.value })} /></FormField>
        </div>
        <FormField label="Business justification"><Textarea rows={3} value={form.business_justification} onChange={(e) => set({ business_justification: e.target.value })} /></FormField>
        <FormField label="Linked risks"><Textarea rows={2} placeholder="One risk per line" value={form.linked_risks_text} onChange={(e) => set({ linked_risks_text: e.target.value })} /></FormField>
        <FormField label="Linked controls"><Textarea rows={2} placeholder="One control per line" value={form.linked_controls_text} onChange={(e) => set({ linked_controls_text: e.target.value })} /></FormField>
        <FormField label="Linked frameworks"><Textarea rows={2} placeholder="One framework per line" value={form.linked_frameworks_text} onChange={(e) => set({ linked_frameworks_text: e.target.value })} /></FormField>
      </div>
    </RightSlidePanel>
  );
}
