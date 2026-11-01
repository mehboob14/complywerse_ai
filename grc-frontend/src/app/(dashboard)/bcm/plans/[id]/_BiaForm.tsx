'use client';

// The Add process drawer of a plan's business impact analysis (it was a modal with no `onError`: a refusal showed only as a raw line). On the kit: RightSlidePanel with `dirty`,
// FormField with whole-hours fields, the asset picker of _bcm-ui. It sends exactly what the modal sent (bcmModel.biaCreatePayload), says what is wrong before it sends (a blank
// name, hours that are not whole numbers, an RTO that is not shorter than the MTPD: the rule the server enforces), and shows what the server said when it refuses.
import { useRef, useState } from 'react';
import { bcmApi } from '@/lib/api';
import { optionsOf, severity } from '@/lib/statuses/bcm';
import { RightSlidePanel } from '@/components/ui';
import { Button, FormField, Select, Textarea, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { AssetMultiSelect, FormProblem, HoursInput } from '../../_bcm-ui';
import { NAME_MAX, biaCreatePayload, biaDirty, biaErrors, blankBiaForm, type BiaForm as Form } from '../../bcmModel';

export function BiaForm({ planId, onClose }: { planId: number; onClose: () => void }) {
  const [form, setForm] = useState<Form>(blankBiaForm);
  const [showErrors, setShowErrors] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const nameField = useRef<HTMLInputElement>(null);
  const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm((f) => ({ ...f, [key]: value }));
  const errors = biaErrors(form);

  const create = useReportedMutation({
    mutationFn: async (payload: ReturnType<typeof biaCreatePayload>) => (await bcmApi.bia.create(planId, payload)).data,
    success: 'BIA process added', failure: "Couldn't add the process", retryable: false, toast: 'success',
    invalidate: [['bcm-plan', planId]],
    onSuccess: () => onClose(),
    onError: (error) => setProblem(errorMessage(error)),
  });

  const submit = () => {
    setProblem(null);
    if (Object.keys(errors).length > 0) {
      setShowErrors(true);
      if (errors.process_name) nameField.current?.focus();
      return;
    }
    create.mutate(biaCreatePayload(form));
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={biaDirty(form)}
      title="Add BIA process"
      subtitle="Business impact analysis"
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={create.isPending} onClick={submit}>Add process</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <FormProblem message={problem} />
        <FormField label="Process name" required error={showErrors ? errors.process_name : undefined}>
          <TextInput ref={nameField} value={form.process_name} maxLength={NAME_MAX} onChange={(e) => set('process_name', e.target.value)} placeholder="e.g. Payment authorisation" />
        </FormField>
        <FormField label="Criticality" info="How much the business suffers while this process is down.">
          <Select value={form.criticality_rating} onChange={(e) => set('criticality_rating', e.target.value)}>
            {optionsOf(severity).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </FormField>
        <div className="grid gap-[12px] sm:grid-cols-3">
          <HoursInput label="RTO" info="Recovery time objective: the longest this process may stay down. It must be shorter than the MTPD." value={form.rto_hours} onChange={(v) => set('rto_hours', v)} error={showErrors ? errors.rto_hours : undefined} />
          <HoursInput label="RPO" info="Recovery point objective: the most recent work, in hours, that may be lost." value={form.rpo_hours} onChange={(v) => set('rpo_hours', v)} error={showErrors ? errors.rpo_hours : undefined} />
          <HoursInput label="MTPD" info="Maximum tolerable period of disruption: the point after which the business cannot recover. The RTO must be shorter." value={form.mtpd_hours} onChange={(v) => set('mtpd_hours', v)} error={showErrors ? errors.mtpd_hours : undefined} />
        </div>
        <p className="-mt-[8px] text-ds-label font-normal text-ds-fg-muted">RTO must be shorter than MTPD.</p>
        <FormField label="Linked assets" optional hint="IT inventory assets this process depends on.">
          <AssetMultiSelect value={form.linked_asset_ids} onChange={(ids) => set('linked_asset_ids', ids)} />
        </FormField>
        <FormField label="Description" optional>
          <Textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </FormField>
      </div>
    </RightSlidePanel>
  );
}
