'use client';

// "Edit details" of a saved report: its name, a short description and who can open it. The report's columns and filters are changed in the builder, not here. Saving asks the server; the sheet stays
// open with the failure shown (and the typing kept) until it is saved. Only the owner gets here (the menu offers it to nobody else).
import { useEffect, useState } from 'react';
import { Button, Checkbox, FormField, Sheet, TextInput, Textarea } from '@/components/ui/ds';

export interface Details { name: string; description: string; shared: boolean }

export function DetailsSheet({ open, initial, saving, error, onClose, onSave }: {
  open: boolean;
  initial: Details;
  saving: boolean;
  /** what the server said when the last save failed (cleaned) */
  error: string | null;
  onClose: () => void;
  onSave: (next: Details) => void;
}) {
  const [draft, setDraft] = useState<Details>(initial);
  useEffect(() => { if (open) setDraft(initial); }, [open, initial]);       // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = draft.name !== initial.name || draft.description !== initial.description || draft.shared !== initial.shared;
  const blank = draft.name.trim() === '';

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Edit details"
      width="md"
      dirty={dirty && !saving}
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={blank || !dirty} onClick={() => onSave({ name: draft.name.trim(), description: draft.description.trim(), shared: draft.shared })}>Save</Button>
        </div>
      )}
    >
      <form className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); if (!blank && dirty && !saving) onSave({ name: draft.name.trim(), description: draft.description.trim(), shared: draft.shared }); }}>
        <FormField label="Name" required error={blank ? 'Give the report a name.' : undefined}>
          <TextInput value={draft.name} maxLength={120} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoComplete="off" />
        </FormField>
        <FormField label="Description" optional>
          <Textarea value={draft.description} maxLength={300} rows={3} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </FormField>
        <Checkbox label="Everyone in the organisation can open this report" checked={draft.shared} onChange={(e) => setDraft({ ...draft, shared: e.target.checked })} />
        {error && <p role="alert" className="m-0 break-words text-ds-body text-ds-danger">{error}</p>}
      </form>
    </Sheet>
  );
}
