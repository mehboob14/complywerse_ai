'use client';

// "Tune SLA": how long a gap may stay open at each priority and how much each state of a gap counts towards the SLA score. ONE Save (the old panel sent every keystroke, and an emptied field
// wrote 1 day); a field is checked before it is sent; the dialog says what saving does ("every assessment's score is worked out again") and what failed, in the server's words, with Retry. It is
// shown to people who hold `compliance:assessments:edit` (the server lets any signed-in person change the policy: a gap the user decides).
import { useState } from 'react';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Button, FormField, Notice, TextInput, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { api, KEYS } from '../_data/assessmentData';
import type { Policy } from '../_data/types';
import { POLICY_DAYS, POLICY_WEIGHTS, policyChanged, policyDraft, policyOf, policyProblem, type PolicyKey } from './overviewModel';

export function SlaDialog({ policy, onClose }: { policy: Policy; onClose: () => void }) {
  const [draft, setDraft] = useState<Record<PolicyKey, string>>(() => policyDraft(policy));
  const [tried, setTried] = useState(false);
  const problem = policyProblem(draft);
  const dirty = policyChanged(draft, policy);
  const save = useReportedMutation({
    mutationFn: () => api.savePolicy(policyOf(draft)),
    success: { title: 'SLA saved', message: 'Every assessment is scored again with the new days and weights.' },
    failure: "Couldn't save the SLA",
    toast: 'success',
    invalidate: [[...KEYS.policy], [...KEYS.board], [...KEYS.points], ['assessment-workspace-score'], ['assessment-workspace-sla-policy'], [...KEYS.register]],
    onSuccess: onClose,
  });
  const set = (key: PolicyKey) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft((d) => ({ ...d, [key]: e.target.value }));
  const field = (f: { key: PolicyKey; label: string }, unit: string) => (
    <FormField key={f.key} label={f.label}>
      <TextInput type="number" inputMode="numeric" min={0} value={draft[f.key]} onChange={set(f.key)} unit={unit} />
    </FormField>
  );
  const submit = () => { setTried(true); if (!problem && dirty) save.mutate(); };

  return (
    <AnimatedModal
      isOpen onClose={onClose} title="Tune SLA" size="lg" dirty={dirty}
      subtitle="How long a gap may stay open, and how much each state of a gap counts towards the SLA score."
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} disabled={!dirty} onClick={submit}>Save</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px] px-[20px] py-[16px]">
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-[8px] p-0 text-ds-body font-[600] text-ds-fg">Days to close a gap</legend>
          <div className="grid gap-[12px] sm:grid-cols-2">{POLICY_DAYS.map((f) => field(f, 'days'))}</div>
        </fieldset>
        <fieldset className="m-0 min-w-0 border-0 p-0">
          <legend className="mb-[8px] p-0 text-ds-body font-[600] text-ds-fg">What a gap counts for (0 to 100)</legend>
          <div className="grid gap-[12px] sm:grid-cols-2">{POLICY_WEIGHTS.map((f) => field(f, 'points'))}</div>
        </fieldset>
        {tried && problem && <Notice tone="danger" title="Check the values">{problem}</Notice>}
        {save.isError && <Notice tone="danger" title="Couldn't save the SLA">{errorMessage(save.error)}</Notice>}
      </div>
    </AnimatedModal>
  );
}
