'use client';

// Approve or reject one open approval: a small dialog with the one box the decision needs (a reason is REQUIRED to reject, optional to approve), asking
// "Discard changes?" before it throws a typed reason away. The call is the one the page has always made (governanceApi.approveStep / rejectStep with the
// comments as typed) and its outcome is said by useReportedMutation: only after the server answered, and a refusal (someone else is the approver, the step
// was decided already) in the server's own words, in the dialog, which stays open with what was typed. What the approval does to the document is the server's.
import { useState } from 'react';
import { governanceApi } from '@/lib/api';
import { truncate } from '@/lib/format';
import { AnimatedModal } from '@/components/ui';
import { Button, FormField, Textarea, useReportedMutation } from '@/components/ui/ds';
import { errorMessage } from '@/components/ui/ds/reportOutcome';
import { FormProblem } from './_parts';
import type { PendingStep } from './_model';

export type DecisionKind = 'approve' | 'reject';

const WORDS: Record<DecisionKind, { title: string; field: string; required: boolean; placeholder?: string; button: string; variant: 'primary' | 'danger'; success: string; failure: string }> = {
  approve: { title: 'Approve document', field: 'Comments', required: false, button: 'Approve', variant: 'primary', success: 'Document approved', failure: 'Not approved' },
  reject: { title: 'Reject document', field: 'Reason', required: true, placeholder: 'Why is it rejected?', button: 'Reject', variant: 'danger', success: 'Document rejected', failure: 'Not rejected' },
};

export function DecisionDialog({ kind, step, onClose }: { kind: DecisionKind; step: PendingStep; onClose: () => void }) {
  const w = WORDS[kind];
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const decide = useReportedMutation({
    mutationFn: (comments: string) => (kind === 'approve' ? governanceApi.approveStep(step.step_id, comments) : governanceApi.rejectStep(step.step_id, comments)),
    success: { title: w.success, message: truncate(step.document_title, 80).text },
    failure: w.failure,
    toast: 'success',                                                     // a failure is said in the dialog, once
    invalidate: [['workflow-dashboard'], ['pending-approvals'], ['overdue-approvals']],
    onSuccess: onClose,
    onError: (error) => setProblem(`${w.failure}. ${errorMessage(error)}`),
  });
  const missing = w.required && !text.trim();

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="md"
      title={w.title}
      subtitle={<span title={step.document_title}>{truncate(step.document_title, 120).text}</span>}
      dirty={text.trim() !== ''}
      footer={(
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={w.variant} loading={decide.isPending} disabled={missing} onClick={() => { setProblem(null); decide.mutate(text); }}>{w.button}</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[12px] px-[20px] py-[16px]">
        <FormProblem message={problem} />
        <FormField label={w.field} required={w.required} optional={!w.required}>
          <Textarea rows={4} value={text} placeholder={w.placeholder} onChange={(e) => { setText(e.target.value); setProblem(null); }} />
        </FormField>
      </div>
    </AnimatedModal>
  );
}
