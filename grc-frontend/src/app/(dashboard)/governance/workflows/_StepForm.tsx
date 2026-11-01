'use client';

// Add or change a step of a workflow template, in a drawer that asks "Discard changes?" before it throws typed input away. Drawn fresh for each step (the
// page gives it a `key`), so editing starts with THAT step's own type, mode, timeout and required flag: the old panel was always mounted and read the step once,
// at the first render, so Edit opened blank and saving a corrected name reset the step's type and mode to the defaults. What each save sends is what it always
// sent (_model.ts: createStepPayload, updateStepPayload), except that a timeout taken out of the box is now sent as null: it used to be left out of the request,
// so the server kept the timeout the person had just removed. A new step goes last, as before; a failure is said at the top of the form, which stays open.
import { useState } from 'react';
import { governanceApi } from '@/lib/api';
import { RightSlidePanel } from '@/components/ui';
import { Button, Checkbox, FormField, Select, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { FormProblem } from './_parts';
import {
  APPROVAL_MODES, STEP_TYPES, createStepPayload, emptyStepForm, sameStepForm, stepErrors, stepFormFrom, updateStepPayload, withCurrent,
  type StepForm, type WorkflowStep,
} from './_model';

export function StepFormDrawer({ templateId, step, nextSequence, onClose }: {
  templateId: number;
  /** the step being changed; null adds a new one */
  step: WorkflowStep | null;
  /** where a new step goes: after the last */
  nextSequence: number;
  onClose: () => void;
}) {
  const editing = step !== null;
  const [initial] = useState<StepForm>(() => (step ? stepFormFrom(step) : emptyStepForm(nextSequence)));
  const [form, setForm] = useState<StepForm>(initial);
  const [tried, setTried] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const errors = tried ? stepErrors(form) : {};
  const set = (patch: Partial<StepForm>) => { setForm((f) => ({ ...f, ...patch })); setProblem(null); };

  // a step changes its template's steps (and the count the list shows)
  const invalidate = [['workflow-template', templateId], ['workflow-templates']];
  const create = useReportedMutation({
    mutationFn: (f: StepForm) => governanceApi.createWorkflowStep(templateId, createStepPayload(f)),
    success: 'Step added',
    failure: 'Not added',
    retryable: false,                                                    // a second try could add a second step
    toast: 'success',
    invalidate,
    onSuccess: onClose,
    onError: (error) => setProblem(`Not added. ${errorMessage(error)}`),
  });
  const update = useReportedMutation({
    mutationFn: (f: StepForm) => governanceApi.updateWorkflowStep(templateId, step!.id, updateStepPayload(f)),
    success: 'Changes saved',
    failure: 'Not saved',
    toast: 'success',
    invalidate,
    onSuccess: onClose,
    onError: (error) => setProblem(`Not saved. ${errorMessage(error)}`),
  });

  const busy = create.isPending || update.isPending;
  const submit = () => {
    setTried(true);
    if (Object.keys(stepErrors(form)).length > 0) return;
    setProblem(null);
    if (editing) update.mutate(form);
    else create.mutate(form);
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      title={editing ? 'Edit step' : 'Add workflow step'}
      width="w-full max-w-md"
      dirty={!sameStepForm(form, initial)}
      footer={(
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" form="workflow-step-form" variant="primary" loading={busy}>{editing ? 'Save changes' : 'Add step'}</Button>
        </div>
      )}
    >
      <form id="workflow-step-form" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-[16px]">
        <FormProblem message={problem} />
        <FormField label="Step name" required error={errors.name}>
          <TextInput value={form.name} maxLength={255} placeholder="e.g., Manager Review" onChange={(e) => set({ name: e.target.value })} />
        </FormField>
        <FormField label="Step type">
          <Select value={form.step_type} onChange={(e) => set({ step_type: e.target.value })}>
            {withCurrent(STEP_TYPES, form.step_type).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </FormField>
        <FormField label="Approval mode">
          <Select value={form.approval_mode} onChange={(e) => set({ approval_mode: e.target.value })}>
            {withCurrent(APPROVAL_MODES, form.approval_mode).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </FormField>
        <FormField label="Timeout" optional hint="Leave empty for no timeout." error={errors.timeout_days}>
          <TextInput type="number" inputMode="numeric" min={1} step={1} unit="days" value={form.timeout_days} onChange={(e) => set({ timeout_days: e.target.value })} />
        </FormField>
        <Checkbox label="This step is required" checked={form.is_required} onChange={(e) => set({ is_required: e.target.checked })} />
      </form>
    </RightSlidePanel>
  );
}
