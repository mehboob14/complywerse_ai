'use client';

// The reviewer's decision, under the timeline while the file waits and for a person who may decide (recordModel.offeredTo): a note, then Approve or Send back. The note is optional for an
// approval and is what the owner reads when the file comes back as a draft. It is kept if the request fails, and cleared once it has gone through.
import { useState } from 'react';
import { ThumbsUp, Undo2 } from 'lucide-react';
import { Button, FormField, Textarea } from '@/components/ui/ds';

export function DecisionBar({ pending, onApprove, onSendBack }: {
  pending: { approve: boolean; sendBack: boolean };
  onApprove: (note: string, done: () => void) => void;
  onSendBack: (note: string, done: () => void) => void;
}) {
  const [note, setNote] = useState('');
  const busy = pending.approve || pending.sendBack;
  const done = () => setNote('');
  return (
    <section aria-label="Your decision" className="flex flex-col gap-[12px] rounded-ds-card border border-ds-border bg-ds-warning-soft p-[16px]">
      <div>
        <h2 className="!text-ds-section !text-ds-fg">Waiting for your decision</h2>
        <p className="text-ds-body text-ds-fg-body">Approve it, or send it back with a note on what should change. The note goes to its owner.</p>
      </div>
      <FormField label="Note" optional>
        <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: the signed page is missing" disabled={busy} />
      </FormField>
      <div className="flex flex-wrap items-center gap-[8px]">
        <Button variant="primary" leftIcon={<ThumbsUp aria-hidden />} loading={pending.approve} disabled={busy && !pending.approve} onClick={() => onApprove(note, done)}>Approve</Button>
        <Button leftIcon={<Undo2 aria-hidden />} loading={pending.sendBack} disabled={busy && !pending.sendBack} onClick={() => onSendBack(note, done)}>Send back</Button>
      </div>
    </section>
  );
}
