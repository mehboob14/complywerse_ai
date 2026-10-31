'use client';

// New project, in a drawer that asks "Discard changes?" before it throws typed input away (RightSlidePanel `dirty`). The fields are the kit's; the two
// pickers that search (owner, sponsor) are still MultiSelectDropdown, which the kit has no replacement for yet. A save is reported by useReportedMutation: said
// only after the server answered, with the server's words when it refused, and the drawer stays open with everything typed. What is required and what is sent
// are in _model.ts (newProjectErrors, newProjectPayload). A second try of a create could make a second project, so a failure offers no Retry: the drawer is
// still open to press Create again.
import { useId, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { DollarSign } from 'lucide-react';
import { isProjectsApi, tenantApi } from '@/lib/api';
import { MultiSelectDropdown, RightSlidePanel } from '@/components/ui';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, FormField, Select, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { CATEGORIES, PRIORITIES, PROJECT_KEYS, blankProject, newProjectErrors, newProjectPayload, sameForm, type NewProjectForm } from './_model';
import { retryRead } from './_ui';

interface TenantUserRow { id: number; display_name: string; email: string }

/** A label for a picker that is not a kit control: names its group, with the (i) beside it. */
function PickerField({ label, info, children }: { label: string; info?: string; children: ReactNode }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={id} className="flex min-w-0 flex-col gap-[4px]">
      <div className="flex items-center gap-[4px]">
        <span id={id} className="text-ds-label text-ds-fg">{label}</span>
        {info && <InfoTip text={info} label={`About ${label.toLowerCase()}`} />}
      </div>
      {children}
    </div>
  );
}

export function ProjectFormDrawer({ onClose }: { onClose: () => void }) {
  const [initial] = useState(blankProject);
  const [form, setForm] = useState<NewProjectForm>(initial);
  const [tried, setTried] = useState(false);                          // errors are shown once a save was tried, not while the person is still typing
  const errors = tried ? newProjectErrors(form) : {};
  const set = (patch: Partial<NewProjectForm>) => setForm((f) => ({ ...f, ...patch }));

  const { data: tenantUsers = [] } = useQuery({
    queryKey: ['is-projects-tenant-users'],
    queryFn: async () => ((await tenantApi.getTenantUsers()).data || []) as TenantUserRow[],
    retry: retryRead,
  });
  const items = tenantUsers.map((u) => ({ value: String(u.id), label: u.display_name, subLabel: u.email }));
  const nameOf = (v: string | undefined) => (v ? tenantUsers.find((u) => u.id === Number(v))?.display_name || '' : '');

  const create = useReportedMutation({
    mutationFn: (payload: Record<string, unknown>) => isProjectsApi.create(payload),
    success: 'Project created',
    failure: 'Not created',
    retryable: false,
    invalidate: PROJECT_KEYS,
    onSuccess: onClose,
  });
  const submit = () => {
    setTried(true);
    if (Object.keys(newProjectErrors(form)).length > 0) return;
    create.mutate(newProjectPayload(form));
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title="New project"
      widthClassName="w-[780px] max-w-full"
      dirty={!sameForm(form, initial)}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>Create project</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <FormField label="Project name" required error={errors.name}>
          <TextInput value={form.name} maxLength={255} placeholder="e.g., SIEM Platform Upgrade" onChange={(e) => set({ name: e.target.value })} />
        </FormField>
        <FormField label="Description">
          <Textarea rows={3} value={form.description} placeholder="Describe the project objectives" onChange={(e) => set({ description: e.target.value })} />
        </FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Category">
            <Select value={form.category} onChange={(e) => set({ category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </FormField>
          <FormField label="Priority">
            <Select value={form.priority} onChange={(e) => set({ priority: e.target.value })}>
              {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
            </Select>
          </FormField>
        </div>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <PickerField label="Project owner" info="If you pick nobody, you become the owner.">
            <MultiSelectDropdown
              title="Owner"
              items={items}
              selectedValues={form.project_owner_id ? [String(form.project_owner_id)] : []}
              onApply={(values) => set({ project_owner_id: values[0] ? Number(values[0]) : null, project_owner_name: nameOf(values[0]) })}
              multiSelect={false}
              autoApply
              forceSearch
              triggerVariant="input"
              triggerClassName="w-full"
              size="sm"
              placeholder="Select owner"
              searchPlaceholder="Search users"
            />
          </PickerField>
          <PickerField label="Sponsor">
            <MultiSelectDropdown
              title="Sponsor"
              items={items}
              selectedValues={form.sponsor_id ? [String(form.sponsor_id)] : []}
              onApply={(values) => set({ sponsor_id: values[0] ? Number(values[0]) : null, sponsor: nameOf(values[0]) })}
              multiSelect={false}
              autoApply
              forceSearch
              triggerVariant="input"
              triggerClassName="w-full"
              size="sm"
              placeholder="Select sponsor"
              searchPlaceholder="Search users"
            />
          </PickerField>
        </div>
        <FormField label="Department">
          <TextInput value={form.department} maxLength={255} placeholder="e.g., Information Security" onChange={(e) => set({ department: e.target.value })} />
        </FormField>
        <div className="grid grid-cols-1 gap-[12px] sm:grid-cols-2">
          <FormField label="Start date">
            <TextInput type="date" value={form.start_date} onChange={(e) => set({ start_date: e.target.value })} />
          </FormField>
          <FormField label="Target end date">
            <TextInput type="date" value={form.target_end_date} onChange={(e) => set({ target_end_date: e.target.value })} />
          </FormField>
        </div>
        <FormField label="Estimated budget">
          <TextInput type="number" inputMode="decimal" value={form.budget_estimated} placeholder="0.00" leftAdornment={<DollarSign aria-hidden />} onChange={(e) => set({ budget_estimated: e.target.value })} />
        </FormField>
        <FormField label="Business justification">
          <Textarea rows={3} value={form.business_justification} placeholder="Why is this project needed?" onChange={(e) => set({ business_justification: e.target.value })} />
        </FormField>
      </div>
    </RightSlidePanel>
  );
}
