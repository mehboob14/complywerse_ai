'use client';

// New / edit a corrective action of THIS issue: the kit's side panel (focus, Escape, "Discard changes?" when something was typed). The issue is the page's own, so there is nothing to choose;
// the due date is a day (sent as YYYY-MM-DD, so it does not move with the viewer's time zone). A failed save is toasted by the caller's mutation and the panel stays open with what was typed.
import { useState } from 'react';
import { RightSlidePanel } from '@/components/ui';
import { Button, Combobox, FormField, Select, Textarea, TextInput } from '@/components/ui/ds';
import { personOptions, useTenantUsers } from '@/components/records/lookups';
import { ACTION_TYPE_OPTIONS } from '@/lib/issues/words';
import { TITLE_MAX, actionBody, actionErrors, draftOf, isDirty, type ActionDraft, type IssueActionRow } from './actionsModel';

const ROW2 = 'grid gap-[12px] sm:grid-cols-2';

export function ActionPanel({ action, issueName, saving, onSubmit, onClose }: {
  /** null: a new action */
  action: IssueActionRow | null;
  issueName: string;
  saving: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const isNew = action === null;
  const [opened] = useState(() => draftOf(action));
  const [draft, setDraft] = useState<ActionDraft>(opened);
  const [tried, setTried] = useState(false);
  const set = <K extends keyof ActionDraft>(key: K, value: ActionDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const people = useTenantUsers();
  const errors = actionErrors(draft);
  const submit = () => {
    setTried(true);
    if (Object.keys(errors).length > 0) return;
    onSubmit(actionBody(draft, isNew));
  };
  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={isDirty(opened, draft)}
      title={isNew ? 'New corrective action' : 'Edit action'}
      subtitle={issueName}
      footer={(
        <div className="flex items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={submit}>{isNew ? 'Add action' : 'Save changes'}</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        <FormField label="What has to be done" required error={tried ? errors.title : undefined}>
          <TextInput value={draft.title} maxLength={TITLE_MAX} onChange={(e) => set('title', e.target.value)} />
        </FormField>
        <div className={ROW2}>
          <FormField label="Type" info="Corrective fixes the defect, preventive stops it coming back, containment limits the harm while a fix is made, verification confirms the fix worked.">
            <Select value={draft.type} onChange={(e) => set('type', e.target.value)}>
              {ACTION_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </FormField>
          <FormField label="Due date" optional>
            <TextInput type="date" value={draft.due} onChange={(e) => set('due', e.target.value)} />
          </FormField>
        </div>
        <FormField label="Assigned to" optional>
          <Combobox label="Assigned to" options={personOptions(people.data)} value={draft.assignee} onChange={(v) => set('assignee', v)} clearable placeholder={people.isError ? 'The people could not be loaded' : 'Unassigned'} disabled={people.isError} />
        </FormField>
        <FormField label="Notes" optional>
          <Textarea rows={4} value={draft.notes} onChange={(e) => set('notes', e.target.value)} />
        </FormField>
      </div>
    </RightSlidePanel>
  );
}
