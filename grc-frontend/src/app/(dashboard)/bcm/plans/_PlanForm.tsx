'use client';

// The Add plan / Edit plan drawer (both were modals with a hand-made look, no focus handling, no guard on typed input, and a failure that only showed as a raw line under the
// fields). On the kit: RightSlidePanel, which takes focus, wraps Tab, names itself and, because it is given `dirty`, asks "Discard changes?" before Escape, the X or a press
// outside throws typed input away; FormField with TextInput / Textarea / Select; the pickers of _parts. It sends exactly what the modals sent (bcmModel.planCreatePayload,
// planUpdatePayload), says what is wrong before it sends (a blank title, a title the column cannot hold, hours that are not whole numbers), and shows what the server said
// when it refuses, at the top of the form, with what was typed kept. The request is reported once (the drawer shows a failure itself, the toast only confirms).
import { useRef, useState } from 'react';
import { bcmApi } from '@/lib/api';
import { truncate } from '@/lib/format';
import { frequency, optionsOf } from '@/lib/statuses/bcm';
import { RightSlidePanel } from '@/components/ui';
import { Button, FormField, Select, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { EntityCombobox, FormProblem, HoursInput } from '../_parts';
import {
  NAME_MAX, blankPlanForm, planCreatePayload, planDirty, planErrors, planFormFrom, planUpdatePayload, type Plan, type PlanForm as Form,
} from '../bcmModel';

const ROW2 = 'grid gap-[12px] sm:grid-cols-2';

export function PlanForm({ plan, onClose }: {
  /** the plan being edited; null: a new one */
  plan: Plan | null;
  onClose: () => void;
}) {
  const [opened] = useState<Form>(() => (plan ? planFormFrom(plan) : blankPlanForm()));
  const [form, setForm] = useState<Form>(opened);
  const [showErrors, setShowErrors] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const titleField = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const errors = planErrors(form);
  const dirty = planDirty(opened, form);

  // a create that lost its answer could be a second plan if repeated: no Retry. The failure is shown in the drawer, so the toast only confirms.
  const create = useReportedMutation({
    mutationFn: async (payload: ReturnType<typeof planCreatePayload>) => (await bcmApi.plans.create(payload)).data,
    success: 'Plan created', failure: "Couldn't create the plan", retryable: false, toast: 'success',
    invalidate: [['bcm-plans']],
    onSuccess: () => onClose(),
    onError: (error) => setProblem(errorMessage(error)),
  });
  const update = useReportedMutation({
    mutationFn: async (payload: ReturnType<typeof planUpdatePayload>) => (await bcmApi.plans.update(plan?.id ?? 0, payload)).data,
    success: 'Plan updated', failure: "Couldn't save the plan", toast: 'success',
    invalidate: [['bcm-plan', plan?.id ?? 0], ['bcm-plans']],
    onSuccess: () => onClose(),
    onError: (error) => setProblem(errorMessage(error)),
  });
  const saving = create.isPending || update.isPending;

  const submit = () => {
    setProblem(null);
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      if (errors.title) titleField.current?.focus();
      return;
    }
    if (plan) update.mutate(planUpdatePayload(form));
    else create.mutate(planCreatePayload(form));
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={dirty}
      title={plan ? 'Edit plan' : 'New continuity plan'}
      subtitle={plan ? truncate(plan.title, 80).text : undefined}
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={submit}>{plan ? 'Save changes' : 'Create plan'}</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <FormProblem message={problem} />

        <FormField label="Title" required error={showErrors ? errors.title : undefined}>
          <TextInput ref={titleField} value={form.title} maxLength={NAME_MAX} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Core Banking Continuity Plan" />
        </FormField>
        <div className={ROW2}>
          <FormField label="Business unit / scope" optional>
            <TextInput value={form.business_unit} maxLength={NAME_MAX} onChange={(e) => set('business_unit', e.target.value)} placeholder="e.g. Retail Banking" />
          </FormField>
          <FormField label="Testing cadence" info="How often the plan must be tested at the least.">
            <Select value={form.testing_frequency} onChange={(e) => set('testing_frequency', e.target.value)}>
              {optionsOf(frequency).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </FormField>
        </div>
        <FormField label="Description" optional>
          <Textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </FormField>
        <div className={ROW2}>
          <HoursInput label="RTO" info="Recovery time objective: the longest the plan's services may stay down. A plan needs it, and the RPO, before it can be Approved." value={form.rto_hours} onChange={(v) => set('rto_hours', v)} error={showErrors ? errors.rto_hours : undefined} />
          <HoursInput label="RPO" info="Recovery point objective: the most recent data, in hours of work, that may be lost." value={form.rpo_hours} onChange={(v) => set('rpo_hours', v)} error={showErrors ? errors.rpo_hours : undefined} />
        </div>
        <div className={ROW2}>
          <FormField label="Owner" optional>
            <EntityCombobox
              kind="users" label="Owner" placeholder="Assign owner…" clearable value={form.owner_id} onChange={(id) => set('owner_id', id)}
              extra={opened.owner_id ? [{ value: opened.owner_id, label: opened.owner_name || `User #${opened.owner_id}` }] : undefined}
            />
          </FormField>
          <FormField label="Review due" optional info="The day the plan is next due to be reviewed.">
            <TextInput type="date" value={form.next_review_due} onChange={(e) => set('next_review_due', e.target.value)} />
          </FormField>
        </div>
        <FormField label="Plan document" optional hint="References an existing document — no duplicate upload.">
          <EntityCombobox
            kind="documents" label="Plan document" placeholder="Link a governance document…" clearable value={form.document_ref_id} onChange={(id) => set('document_ref_id', id)}
            extra={opened.document_ref_id ? [{ value: opened.document_ref_id, label: opened.document_title || `Doc #${opened.document_ref_id}` }] : undefined}
          />
        </FormField>
      </div>
    </RightSlidePanel>
  );
}
