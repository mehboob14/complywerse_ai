'use client';

// Where the task came from and what it is about: the Source row (the server's own words and page: "Committee action", "Vendor finding", the regulatory change it came from) and the Linked
// rows (a risk, a control, a vulnerability, a framework, an issue, by TITLE, each a link to its page; a record that is gone says so). The people who may edit can change the three records
// the old Edit form linked (risk, internal control, vulnerability); the picker lists are read when the editor opens, and the server's lists hold their first 100, which the editor says.
import { Combobox, ErrorState, Fact, FormField, TitleLink } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { useRecordOptions } from '../../_queries';
import { KIND_LABEL, kindOf, type LinkedRecord } from '../../taskRecord';
import type { PickerKind } from '../../tasksModel';
import { InlineEditor } from './InlineEditor';
import { linkIdsOf, linksPatch, sourceOf, type LinkIds, type TaskPageData } from './taskPageModel';

const KIND_WORD: Record<LinkedRecord['kind'], string> = { risk: 'Risk', control: 'Control', vulnerability: 'Vulnerability', framework: 'Framework', requirement: 'Requirement', issue: 'Issue' };

/** The first part of the server's lists: risks and internal controls are cut at 100 by their own endpoints (the editor says so; searching narrows only what was loaded). */
const SERVER_CUT = 100;

export function SourceRow({ task }: { task: TaskPageData }) {
  const source = sourceOf(task);
  const kind = kindOf(task);
  const words = source?.label ?? (kind === 'task' ? task.source : KIND_LABEL[kind]);
  return (
    <Fact label="Source">
      {source?.href ? <TitleLink href={source.href} title={words} lines={2} tone="text" size="body" /> : words}
    </Fact>
  );
}

function LinkedList({ links }: { links: readonly LinkedRecord[] }) {
  if (links.length === 0) return <span className="text-ds-fg-muted">Nothing linked</span>;
  return (
    <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
      {links.map((l) => (
        <li key={`${l.kind}-${l.id}`} className="min-w-0">
          <span className="text-ds-label text-ds-fg-muted">{KIND_WORD[l.kind]}</span>
          {l.title && l.href ? <TitleLink href={l.href} title={l.title} lines={2} tone="text" size="body" /> : <span className="block text-ds-body text-ds-fg-muted">{l.title ?? 'No longer there'}</span>}
        </li>
      ))}
    </ul>
  );
}

function Pick({ kind, label, plural, value, onChange, capped = false }: { kind: PickerKind; label: string; plural: string; value: string; onChange: (v: string) => void; capped?: boolean }) {
  const list = useRecordOptions(kind, true);
  if (list.isError && !list.data) {
    return <ErrorState compact title={`Couldn't load the ${label.toLowerCase()} list`} message={errorMessage(list.error)} onRetry={canRetry(list.error) ? () => { void list.refetch(); } : undefined} />;
  }
  const cut = capped && (list.data?.length ?? 0) >= SERVER_CUT;
  return (
    <FormField label={label} hint={cut ? `Only the first ${SERVER_CUT} ${plural} are listed.` : undefined}>
      <Combobox
        label={label}
        clearable
        searchable
        searchPlaceholder={`Search ${plural}`}
        options={(list.data ?? []).map((o) => ({ value: String(o.id), label: o.label }))}
        value={value || null}
        onChange={(v) => onChange(v ?? '')}
        placeholder={list.isPending ? 'Loading…' : 'None'}
      />
    </FormField>
  );
}

export function LinkedRow({ task, canEdit }: { task: TaskPageData; canEdit: boolean }) {
  const start = linkIdsOf(task);
  // the editable three are the old Edit form's; the others (framework, requirement, issue) are set where they are made and only shown here
  return (
    <InlineEditor<LinkIds>
      taskId={task.id}
      label="Linked records"
      view={<LinkedList links={task.links ?? []} />}
      canEdit={canEdit}
      start={start}
      patchOf={(draft) => linksPatch(draft, start)}
      said="Links updated"
    >
      {(draft, set) => (
        <div className="flex flex-col gap-[12px]">
          <Pick kind="risk" label="Risk" plural="risks" capped value={draft.risk} onChange={(v) => set({ ...draft, risk: v })} />
          <Pick kind="control" label="Internal control" plural="internal controls" capped value={draft.control} onChange={(v) => set({ ...draft, control: v })} />
          <Pick kind="vulnerability" label="Vulnerability" plural="vulnerabilities" value={draft.vulnerability} onChange={(v) => set({ ...draft, vulnerability: v })} />
        </div>
      )}
    </InlineEditor>
  );
}
