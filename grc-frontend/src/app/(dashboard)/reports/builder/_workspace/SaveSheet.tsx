'use client';

// "Save" and "Save as a copy": the name, a short description and who can open the report. The columns, filters and summary are what is on screen; this asks only for the words. A save the server does not
// take is shown here with the typing kept (the workspace says why and offers Retry), never stored out of sight. Names stop at 120 characters (the server takes 255 and answers a longer one with a
// fault: found by the library group).
import { useEffect, useState } from 'react';
import { Button, Checkbox, FormField, Sheet, TextInput, Textarea } from '@/components/ui/ds';

export interface SaveDetails { name: string; description: string; shared: boolean }

export function SaveSheet({ open, mode, initial, saving, error, onClose, onSave }: {
  open: boolean;
  mode: 'save' | 'save-as';
  initial: SaveDetails;
  saving: boolean;
  /** what the last save said when it failed, in plain words */
  error: string | null;
  onClose: () => void;
  onSave: (next: SaveDetails) => void;
}) {
  const [draft, setDraft] = useState<SaveDetails>(initial);
  useEffect(() => { if (open) setDraft(initial); }, [open]);                  // eslint-disable-line react-hooks/exhaustive-deps
  const blank = draft.name.trim() === '';
  const submit = () => { if (!blank && !saving) onSave({ name: draft.name.trim(), description: draft.description.trim(), shared: draft.shared }); };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={mode === 'save-as' ? 'Save a copy' : 'Save the report'}
      subtitle="Keeps the module, columns, filters, sort and summary so you can open it again"
      width="md"
      dirty={!saving && (draft.name !== initial.name || draft.description !== initial.description || draft.shared !== initial.shared)}
      footer={(
        <div className="flex justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={blank} onClick={submit}>{mode === 'save-as' ? 'Save a copy' : 'Save'}</Button>
        </div>
      )}
    >
      <form className="flex flex-col gap-[16px]" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <FormField label="Name" required error={blank ? 'Give the report a name.' : undefined}>
          <TextInput value={draft.name} maxLength={120} placeholder="For example Risks with no control" onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoComplete="off" />
        </FormField>
        <FormField label="Description" optional>
          <Textarea value={draft.description} maxLength={300} rows={3} placeholder="What does this report show?" onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </FormField>
        <Checkbox label="Everyone in the organisation can open this report" checked={draft.shared} onChange={(e) => setDraft({ ...draft, shared: e.target.checked })} />
        {error && <p role="alert" className="m-0 break-words text-ds-body text-ds-danger">{error}</p>}
      </form>
    </Sheet>
  );
}
