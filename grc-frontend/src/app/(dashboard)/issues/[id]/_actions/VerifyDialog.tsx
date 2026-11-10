'use client';

// Verify that a corrective action worked: the kit's dialog (focus, Escape, a name). Both fields are optional — the date the effect will be looked at again, and what was checked — and are
// kept with the verification (the notes appear on the issue's timeline). It sends nothing itself: the caller's mutation does, and the dialog stays open with the words kept if the save fails.
import { useState } from 'react';
import { AnimatedModal } from '@/components/ui';
import { Button, FormField, Textarea, TextInput } from '@/components/ui/ds';

export function VerifyDialog({ actionName, saving, onSubmit, onClose }: {
  actionName: string;
  saving: boolean;
  onSubmit: (body: { effectiveness_review_at?: string; notes?: string }) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState('');
  const [notes, setNotes] = useState('');
  return (
    <AnimatedModal
      isOpen
      onClose={onClose}
      size="md"
      dirty={date !== '' || notes.trim() !== ''}
      title="Verify it worked"
      subtitle={actionName}
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => onSubmit({ ...(date ? { effectiveness_review_at: date } : {}), ...(notes.trim() ? { notes: notes.trim() } : {}) })}>Verify action</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px] px-[20px] py-[16px]">
        <FormField label="What was checked" optional hint="Kept with the verification, and on the issue's timeline.">
          <Textarea rows={3} value={notes} autoFocus onChange={(e) => setNotes(e.target.value)} />
        </FormField>
        <FormField label="Look at the effect again on" optional>
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
      </div>
    </AnimatedModal>
  );
}
