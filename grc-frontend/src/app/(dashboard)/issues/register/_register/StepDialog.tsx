'use client';

// The two steps that need words: approving a closure (the notes are kept with the approval) and reopening a closed issue (the reason). The kit's dialog: focus, Escape, a name, and
// "Discard changes?" when something was typed. It sends nothing: the page's mutation does, and the dialog stays open (with the words kept) when the save fails.
import { useState } from 'react';
import { AnimatedModal } from '@/components/ui';
import { Button, FormField, Textarea } from '@/components/ui/ds';
import type { IssueStep } from '@/lib/issues/words';

const COPY = {
  close: { title: 'Approve the closure', field: 'Closure notes', hint: 'What was done, and why the issue can be closed. This is kept with the approval.', confirm: 'Approve closure', empty: 'Write the closure notes.' },
  reopen: { title: 'Reopen the issue', field: 'Reason', hint: 'Why the issue is being reopened. This is kept in its history.', confirm: 'Reopen issue', empty: 'Write the reason.' },
} as const;

export function StepDialog({ step, issueName, saving, onSubmit, onClose }: {
  step: IssueStep;
  issueName: string;
  saving: boolean;
  onSubmit: (text: string) => void;
  onClose: () => void;
}) {
  const copy = COPY[step.kind === 'reopen' ? 'reopen' : 'close'];
  const [text, setText] = useState('');
  const [tried, setTried] = useState(false);
  const submit = () => {
    setTried(true);
    if (text.trim()) onSubmit(text.trim());
  };
  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="md"
      dirty={text.trim() !== ''}
      title={copy.title}
      subtitle={issueName}
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={submit}>{copy.confirm}</Button>
        </div>
      )}
    >
      <div className="px-[20px] py-[16px]">
        <FormField label={copy.field} required hint={copy.hint} error={tried && !text.trim() ? copy.empty : undefined}>
          <Textarea rows={4} value={text} autoFocus onChange={(e) => setText(e.target.value)} />
        </FormField>
      </div>
    </AnimatedModal>
  );
}
