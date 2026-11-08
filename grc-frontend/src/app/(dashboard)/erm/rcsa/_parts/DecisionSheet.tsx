'use client';

// The reviewer's decision, asked in a sheet: Approve (a note is optional), Send back (the assessor must be told what to fix) or Reject (it closes the unit for good, said before it is done).
// The comment is required where the assessor has to read it, with its message in plain words; the server's answer (a failure) is shown HERE and the words stay, so nothing typed is lost.
// The sheet asks "Discard changes?" before Escape throws a typed comment away. The decision itself is the page's mutation: this only collects the words.
import { useState } from 'react';
import { Button, FormError, FormField, Sheet, Textarea } from '@/components/ui/ds';
import { decisionCopy, type Decision } from '@/lib/rcsa/rules';

export function DecisionSheet({ decision, unit, pending, error, onClose, onDecide }: {
  decision: Decision | null; unit: string; pending: boolean; error: unknown; onClose: () => void; onDecide: (comments: string) => void;
}) {
  const [comments, setComments] = useState('');
  const [touched, setTouched] = useState(false);
  if (!decision) return null;
  const copy = decisionCopy(decision);
  const missing = copy.required && !comments.trim();
  const submit = () => {
    setTouched(true);
    if (!missing) onDecide(comments.trim());
  };
  return (
    <Sheet
      open
      onClose={() => { setComments(''); setTouched(false); onClose(); }}
      title={copy.title}
      subtitle={unit}
      width="md"
      dirty={comments.trim().length > 0 && !pending}
      footer={(
        <div className="flex flex-wrap justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant={copy.tone === 'danger' ? 'danger' : 'primary'} loading={pending} onClick={submit}>{copy.confirm}</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[12px]">
        <FormField label="Your comment" required={copy.required} optional={!copy.required} hint={copy.hint} error={touched && missing ? 'Write a comment: the assessor reads it.' : undefined}>
          <Textarea rows={5} maxLength={2000} value={comments} onChange={(e) => setComments(e.target.value)} />
        </FormField>
        <FormError title="The decision wasn't recorded" error={error} onRetry={submit} />
      </div>
    </Sheet>
  );
}
