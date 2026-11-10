'use client';

// New / edit a corrective action: the kit's side panel (focus, Escape, "Discard changes?" when something was typed). A new action says which issue it is for (the issues that are still
// open; the list is the register's own read, so a failed read says so and offers Retry); an existing action's issue is shown and cannot change (the server does not move an action).
// The due date is a day (sent as YYYY-MM-DD, so it does not move with the viewer's time zone).
import { useMemo, useState } from 'react';
import { RightSlidePanel } from '@/components/ui';
import { Button, Combobox, ErrorState, FormField, Select, Textarea, TextInput } from '@/components/ui/ds';
import { personOptions, useTenantUsers } from '@/components/records/lookups';
import { codeOf } from '@/lib/issues/issueDef';
import { issueLine, type ActionRow } from '@/lib/issues/actionDef';
import { ACTION_TYPE_OPTIONS, isOpenIssue } from '@/lib/issues/words';
import { issueState } from '@/lib/statuses/issues';
import { useIssueRows } from '../../register/_register/issueData';

interface Draft { issue: string | null; title: string; type: string; due: string; assignee: string | null; notes: string }
const draftOf = (a: ActionRow | null): Draft => ({
  issue: a ? String(a.issue_id) : null, title: a?.title ?? '', type: a?.action_type ?? 'corrective', due: a?.due_date ? a.due_date.slice(0, 10) : '',
  assignee: a?.assignee_id ? String(a.assignee_id) : null, notes: a?.description ?? '',
});
const ROW2 = 'grid gap-[12px] sm:grid-cols-2';

export function ActionForm({ action, saving, onSubmit, onClose }: {
  action: ActionRow | null;
  saving: boolean;
  /** `issueId` is set for a new action only */
  onSubmit: (payload: Record<string, unknown>, issueId: number | null) => void;
  onClose: () => void;
}) {
  const isNew = action === null;
  const [opened] = useState(() => draftOf(action));
  const [draft, setDraft] = useState<Draft>(opened);
  const [tried, setTried] = useState(false);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const people = useTenantUsers();
  const issues = useIssueRows(null);
  const issueOptions = useMemo(
    () => (issues.data?.items ?? []).filter((i) => isOpenIssue(i.workflow_state)).map((i) => ({ value: String(i.id), label: `${codeOf(i)} ${i.title}`, description: issueState.label(i.workflow_state || 'new') })),
    [issues.data],
  );
  const dirty = (Object.keys(opened) as Array<keyof Draft>).some((k) => opened[k] !== draft[k]);
  const issueError = tried && isNew && !draft.issue ? 'Choose the issue this action is for.' : undefined;
  const titleError = tried && !draft.title.trim() ? 'Enter what has to be done.' : undefined;

  const submit = () => {
    setTried(true);
    if (!draft.title.trim() || (isNew && !draft.issue)) return;
    onSubmit({
      title: draft.title.trim(), action_type: draft.type, description: draft.notes,
      assignee_id: draft.assignee ? Number(draft.assignee) : (isNew ? undefined : null),
      due_date: draft.due || (isNew ? undefined : null),
    }, isNew ? Number(draft.issue) : null);
  };

  return (
    <RightSlidePanel
      isOpen
      onClose={onClose}
      dirty={dirty}
      title={isNew ? 'New corrective action' : 'Edit action'}
      subtitle={isNew ? undefined : issueLine(action!)}
      footer={(
        <div className="flex items-center justify-end gap-[8px]">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={isNew && issues.isError} onClick={submit}>{isNew ? 'Add action' : 'Save changes'}</Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-[16px]">
        {isNew && (
          <FormField label="Issue" required error={issueError} hint="Only issues that are still open are offered.">
            {issues.isError
              ? <ErrorState compact title="Couldn't load the issues" onRetry={() => { void issues.refetch(); }} />
              : <Combobox label="Issue" options={issueOptions} value={draft.issue} onChange={(v) => set('issue', v)} placeholder={issues.isLoading ? 'Loading the issues…' : 'Choose an issue'} />}
          </FormField>
        )}
        <FormField label="What has to be done" required error={titleError}>
          <TextInput value={draft.title} maxLength={255} onChange={(e) => set('title', e.target.value)} />
        </FormField>
        <div className={ROW2}>
          <FormField label="Type">
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
