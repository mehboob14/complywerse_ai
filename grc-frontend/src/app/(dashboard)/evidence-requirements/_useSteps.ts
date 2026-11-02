'use client';

// The four steps of the requirement workflow (submit, start review, approve, reject), each through useReportedMutation: it is said only after the server
// has answered, in the server's words when it refuses, with Retry where repeating is safe. What the server answers is applied to the loaded framework
// (applyStep), so the row and the counts change at once and the whole framework is not read again after every click.
import { useQueryClient } from '@tanstack/react-query';
import apiClient from '@/lib/api';
import { truncate } from '@/lib/format';
import { useReportedMutation } from '@/components/ui/ds';
import { applyStep, type Catalogue, type StepAnswer, type StepKey } from './requirementsModel';
import { stepUrl } from './_queries';

export interface StepRequest { id: number; title: string; reason?: string }

const DONE: Record<StepKey, string> = { submit: 'submitted for review', review: 'is now being reviewed', approve: 'approved', reject: 'rejected' };
const FAILED: Record<StepKey, string> = {
  submit: "Couldn't submit the requirement", review: "Couldn't start the review", approve: "Couldn't approve the requirement", reject: "Couldn't reject the requirement",
};

function useStep(key: StepKey, framework: number, toast: 'always' | 'success', onDone?: (v: StepRequest) => void) {
  const qc = useQueryClient();
  return useReportedMutation<StepAnswer, StepRequest>({
    mutationFn: async ({ id, reason }) => (await apiClient.post(stepUrl(id, key), key === 'reject' ? { reason } : {})).data as StepAnswer,
    success: (_, v) => `“${truncate(v.title, 70).text}” ${DONE[key]}`,
    failure: FAILED[key],
    toast,
    onSuccess: (answer, v) => {
      qc.setQueryData<Catalogue>(['evidence-requirements', framework], (cat) => (cat ? applyStep(cat, v.id, key, answer) : cat));
      void qc.invalidateQueries({ queryKey: ['evidence-requirements'], refetchType: 'none' });          // the other cached frameworks are stale now, not worth reading again
      onDone?.(v);
    },
  });
}

/** The four mutations. A rejection says its failure inside its dialog (it has a reason to keep), so only its confirmation is a toast. */
export function useSteps(framework: number, onRejected: () => void) {
  const submit = useStep('submit', framework, 'always');
  const review = useStep('review', framework, 'always');
  const approve = useStep('approve', framework, 'always');
  const reject = useStep('reject', framework, 'success', onRejected);
  const run = (key: StepKey, v: StepRequest) => ({ submit, review, approve, reject })[key].mutate(v);
  return { submit, review, approve, reject, run, busy: submit.isPending || review.isPending || approve.isPending || reject.isPending };
}
