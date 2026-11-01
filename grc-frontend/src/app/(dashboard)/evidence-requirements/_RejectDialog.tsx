'use client';

// Reject a requirement: the reason is required (the server asks for one), said on the field when it is missing, and kept when the request fails: the failure
// is shown here in the server's words and the button reads "Try again", so nothing typed is lost. A dialog of the kit: focus goes in and back, Escape
// closes it, and typed words are not thrown away by a stray click ("Discard changes?").
import { useState } from 'react';
import { AnimatedModal } from '@/components/ui';
import { Button, FormField, Textarea } from '@/components/ui/ds';

export function RejectDialog({ title, busy, error, onSubmit, onClose }: {
  /** the requirement's title: said under the dialog's heading so the person knows which one */
  title: string;
  busy: boolean;
  /** the server's words when the last attempt failed */
  error?: string | null;
  onSubmit: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const empty = reason.trim() === '';
  const submit = () => {
    setTried(true);
    if (!empty) onSubmit(reason);
  };
  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="md"
      dirty={!empty}
      title="Reject this requirement"
      subtitle={title}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} onClick={submit}>{error ? 'Try again' : 'Reject'}</Button>
        </div>
      )}
    >
      <form className="flex flex-col gap-[12px] p-[16px]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <FormField label="Reason" required error={tried && empty ? 'Enter why it is rejected.' : undefined} hint="The reason is kept with the requirement.">
          <Textarea rows={4} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: the population is not stated, so the sample cannot be traced to it." />
        </FormField>
        {error && <p role="alert" className="break-words text-ds-body text-ds-danger">{error}</p>}
      </form>
    </AnimatedModal>
  );
}
