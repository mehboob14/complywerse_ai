'use client';

// The people rows of the rail: Owners (everyone who is on the task: a multi-select; the server keeps the legacy single owner equal to the first) and Reviewer. The list of people is read when
// the editor opens (not for every viewer on every visit); a list that cannot be read says so with a Retry instead of being an empty list. A document request's task keeps its person: its
// Owners row is read-only and says so.
import { ErrorState, MultiSelect, Combobox, PersonChip } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { peopleOf } from '../../taskRecord';
import { useTenantUsers } from '../../_queries';
import { Owners } from '../../_ui';
import { personName, userOptions } from '../../tasksModel';
import { InlineEditor } from './InlineEditor';
import { ownersPatch, reviewerPatch, type TaskPageData } from './taskPageModel';

/** the people the editor offers, or the way to say that they could not be read */
function usePeople() {
  const users = useTenantUsers();
  const failed = users.isError && !users.data;
  return {
    options: userOptions(users.data),
    loading: users.isPending,
    failed,
    problem: failed ? (
      <ErrorState compact title="Couldn't load the people" message={errorMessage(users.error)} onRetry={canRetry(users.error) ? () => { void users.refetch(); } : undefined} />
    ) : null,
  };
}

function OwnersEditor({ draft, set, label }: { draft: string[]; set: (next: string[]) => void; label: string }) {
  const people = usePeople();
  if (people.problem) return people.problem;
  return <MultiSelect label={label} options={people.options} value={draft} onChange={set} display="chips" placeholder={people.loading ? 'Loading…' : 'Unassigned'} searchPlaceholder="Search people" />;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

export function OwnersRow({ task, label, canEdit, locked }: { task: TaskPageData; label: string; canEdit: boolean; locked: boolean }) {
  const start = peopleOf(task).map(String);
  return (
    <InlineEditor<string[]>
      taskId={task.id}
      label={label}
      view={<Owners task={task} size={24} />}
      canEdit={canEdit}
      lockedWhy={locked ? 'Follows the document request' : undefined}
      start={start}
      patchOf={(draft) => (same(draft, start) ? null : ownersPatch(draft))}
      said="Owners updated"
    >
      {(draft, set) => <OwnersEditor draft={draft} set={set} label={label} />}
    </InlineEditor>
  );
}

function ReviewerEditor({ draft, set, label }: { draft: string; set: (next: string) => void; label: string }) {
  const people = usePeople();
  if (people.problem) return people.problem;
  return <Combobox label={label} clearable searchable options={people.options} value={draft || null} onChange={(v) => set(v ?? '')} placeholder={people.loading ? 'Loading…' : 'Not set'} searchPlaceholder="Search people" />;
}

export function ReviewerRow({ task, label, canEdit }: { task: TaskPageData; label: string; canEdit: boolean }) {
  const start = task.reviewer_id ? String(task.reviewer_id) : '';
  const name = personName(task.reviewer);
  return (
    <InlineEditor<string>
      taskId={task.id}
      label={label}
      view={name ? <PersonChip name={name} size={24} /> : <span className="text-ds-fg-muted">Not set</span>}
      canEdit={canEdit}
      start={start}
      patchOf={(draft) => (draft === start ? null : reviewerPatch(draft || null))}
      said="Reviewer updated"
    >
      {(draft, set) => <ReviewerEditor draft={draft} set={set} label={label} />}
    </InlineEditor>
  );
}
