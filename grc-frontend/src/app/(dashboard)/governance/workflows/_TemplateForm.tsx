'use client';

// Create or change a workflow template, in a drawer that asks "Discard changes?" before it throws typed input away (RightSlidePanel `dirty`). The drawer is
// drawn fresh for each record (the page gives it a `key`), so editing starts with THAT template's values: the old panels were always mounted and read their
// record once, at the first render, so Edit opened blank. What each save sends is exactly what it always sent (_model.ts: createTemplatePayload, updateTemplatePayload).
// A save is reported by useReportedMutation: the confirmation after the server answered, and a refusal in the server's own words at the top of the form, which
// stays open with everything typed. A create is never offered a Retry (a second try could make a second template): the drawer is still open to press Create again.
import { useId, useState } from 'react';
import { governanceApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui';
import { Button, Checkbox, FormField, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { FormProblem } from './_parts';
import {
  DOC_TYPE_OPTIONS, createTemplatePayload, emptyTemplateForm, sameTemplateForm, templateErrors, templateFormFrom, toggleDocType, updateTemplatePayload,
  type TemplateForm, type WorkflowTemplate,
} from './_model';

export function TemplateFormDrawer({ template, onClose }: { /** the template being changed; null makes a new one */ template: WorkflowTemplate | null; onClose: () => void }) {
  const editing = template !== null;
  const [initial] = useState<TemplateForm>(() => (template ? templateFormFrom(template) : emptyTemplateForm()));
  const [form, setForm] = useState<TemplateForm>(initial);
  const [tried, setTried] = useState(false);                              // what is missing is said once a save was tried, not while the person is still typing
  const [problem, setProblem] = useState<string | null>(null);
  const typesLabel = useId();
  const settingsLabel = useId();
  const errors = tried ? templateErrors(form) : {};
  const set = (patch: Partial<TemplateForm>) => { setForm((f) => ({ ...f, ...patch })); setProblem(null); };

  const create = useReportedMutation({
    mutationFn: (f: TemplateForm) => governanceApi.createWorkflowTemplate(createTemplatePayload(f)),
    success: 'Template created',
    failure: 'Not created',
    retryable: false,
    toast: 'success',
    invalidate: [['workflow-templates']],
    onSuccess: onClose,
    onError: (error) => setProblem(`Not created. ${errorMessage(error)}`),
  });
  const update = useReportedMutation({
    mutationFn: (f: TemplateForm) => governanceApi.updateWorkflowTemplate(template!.id, updateTemplatePayload(f)),
    success: 'Changes saved',
    failure: 'Not saved',
    toast: 'success',
    invalidate: [['workflow-templates'], ['workflow-template', template?.id]],
    onSuccess: onClose,
    onError: (error) => setProblem(`Not saved. ${errorMessage(error)}`),
  });

  const busy = create.isPending || update.isPending;
  const submit = () => {
    setTried(true);
    if (Object.keys(templateErrors(form)).length > 0) return;
    setProblem(null);
    if (editing) update.mutate(form);
    else create.mutate(form);
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title={editing ? 'Edit template' : 'New workflow template'}
      width="w-full max-w-lg"
      dirty={!sameTemplateForm(form, initial)}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="workflow-template-form" variant="primary" loading={busy}>{editing ? 'Save changes' : 'Create template'}</Button>
        </div>
      )}
    >
      <form id="workflow-template-form" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-[16px]">
        <FormProblem message={problem} />
        <FormField label="Name" required error={errors.name}>
          <TextInput value={form.name} maxLength={255} placeholder="e.g., Policy Approval Workflow" onChange={(e) => set({ name: e.target.value })} />
        </FormField>
        <FormField label="Description" optional>
          <Textarea rows={3} value={form.description} placeholder="Describe the workflow template" onChange={(e) => set({ description: e.target.value })} />
        </FormField>

        <div role="group" aria-labelledby={typesLabel} className="flex flex-col gap-[4px]">
          <span id={typesLabel} className="text-ds-label text-ds-fg">Document types</span>
          <div className="flex flex-wrap gap-x-[16px]">
            {DOC_TYPE_OPTIONS.map((o) => (
              <Checkbox key={o.value} label={o.label} checked={form.doc_types.includes(o.value)} onChange={() => set({ doc_types: toggleDocType(form.doc_types, o.value) })} />
            ))}
          </div>
        </div>

        <div role="group" aria-labelledby={settingsLabel} className="flex flex-col gap-[4px] rounded-ds-card border border-ds-border p-[12px]">
          <span id={settingsLabel} className="text-ds-label text-ds-fg">Settings</span>
          <Checkbox label="Allow steps to be skipped" checked={form.allow_skip} onChange={(e) => set({ allow_skip: e.target.checked })} />
          <Checkbox label="Require all approvers" checked={form.require_all_approvers} onChange={(e) => set({ require_all_approvers: e.target.checked })} />
          <Checkbox label="Auto-publish on workflow completion" checked={form.auto_publish_on_complete} onChange={(e) => set({ auto_publish_on_complete: e.target.checked })} />
        </div>
      </form>
    </RightSlidePanel>
  );
}
