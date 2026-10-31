'use client';

// Approve, reject or revoke one exception: a small dialog with the one box the decision needs (a reason is REQUIRED to reject, optional to approve or
// revoke), and the decision reported by useReportedMutation: said only after the server answered, and a refusal (the requester cannot decide their own,
// someone else decided it first) shown in the server's own words with the dialog still open. What the server is sent is exactly what it was.
import { useState } from 'react';
import { policyExceptionApi } from '@/lib/api';
import { truncate } from '@/lib/format';
import { AnimatedModal } from '@/components/ui';
import { Button, FormField, Textarea, useReportedMutation } from '@/components/ui/ds';
import { LIST_KEYS, type ExceptionItem } from './_types';

export type DecisionKind = 'approve' | 'reject' | 'revoke';

const DECISIONS: Record<DecisionKind, {
  title: string; field: string; required: boolean; placeholder?: string; button: string; variant: 'primary' | 'danger';
  success: string; failure: string; send: (id: number, text: string) => Promise<unknown>;
}> = {
  approve: {
    title: 'Approve exception', field: 'Comments', required: false, button: 'Approve', variant: 'primary', success: 'Exception approved', failure: 'Not approved',
    send: (id, text) => policyExceptionApi.approve(id, text ? { comments: text } : undefined),
  },
  reject: {
    title: 'Reject exception', field: 'Reason', required: true, placeholder: 'Why is it rejected?', button: 'Reject', variant: 'danger', success: 'Exception rejected', failure: 'Not rejected',
    send: (id, text) => policyExceptionApi.reject(id, { rejection_reason: text }),
  },
  revoke: {
    title: 'Revoke exception', field: 'Reason', required: false, button: 'Revoke', variant: 'danger', success: 'Exception revoked', failure: 'Not revoked',
    send: (id, text) => policyExceptionApi.revoke(id, text ? { reason: text } : undefined),
  },
};

export function DecisionDialog({ kind, exception, onClose }: { kind: DecisionKind; exception: ExceptionItem; onClose: () => void }) {
  const d = DECISIONS[kind];
  const [text, setText] = useState('');
  const decide = useReportedMutation({
    mutationFn: (reason: string) => d.send(exception.id, reason),
    success: d.success,
    failure: d.failure,
    invalidate: LIST_KEYS,
    onSuccess: onClose,
  });
  const missing = d.required && !text.trim();

  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="md"
      title={d.title}
      subtitle={<span title={exception.title}>{truncate(exception.title, 120).text}</span>}
      dirty={text.trim() !== ''}
      footer={(
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={d.variant} loading={decide.isPending} disabled={missing} onClick={() => decide.mutate(text)}>{d.button}</Button>
        </div>
      )}
    >
      <div className="px-[20px] py-[16px]">
        <FormField label={d.field} required={d.required} optional={!d.required}>
          <Textarea rows={4} value={text} placeholder={d.placeholder} onChange={(e) => setText(e.target.value)} />
        </FormField>
      </div>
    </AnimatedModal>
  );
}
