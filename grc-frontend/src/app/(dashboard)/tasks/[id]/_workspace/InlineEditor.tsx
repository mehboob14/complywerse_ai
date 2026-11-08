'use client';

// One property of the task, edited where it is shown (the rail's rows, the description). The value is text with a "Change" button; "Change" turns the value into its editor with Save and
// Cancel, Escape cancels, focus goes into the editor and comes back to the button. Save sends ONLY what changed (PUT with the fields of `patchOf`); a problem with what was typed is said
// under the editor; a failed save stays inside the editor in the server's words with a Retry, what was typed kept. When the person may not edit, or the field is one a document request
// owns, the row is read-only text (a locked field says why). No row decides who may edit: `canEdit` comes from the page (the rights it has always checked).
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Fact, FormError } from '@/components/ui/ds';
import { useUpdateTask } from './useTaskActions';

export interface InlineEditorProps<T> {
  taskId: number;
  /** "Due date": the row's label, the editor's name and the words of its failure */
  label: string;
  /** the value as text; `empty` says what a missing value reads ("Not set") */
  view: ReactNode;
  empty?: string;
  canEdit: boolean;
  /** a field the person cannot change here: the row is read-only and says why */
  lockedWhy?: string;
  /** what the editor starts from (the task's own value now) */
  start: T;
  /** the fields to send, or null / {} when nothing changed */
  patchOf: (draft: T) => Record<string, unknown> | null;
  /** why the draft cannot be saved, or null; said after a try, and at once when `now` */
  problemOf?: (draft: T) => string | null;
  /** what the toast says when it worked */
  said: string;
  /** the editor: the controls for the draft; `submit` saves (Enter in a text field) */
  children: (draft: T, set: (next: T) => void, ctx: { submit: () => void; problem: string | null }) => ReactNode;
  /** layout only */
  className?: string;
}

/** The first thing the person can type into or press in an editor. */
const FIRST = 'input:not([type="hidden"]), select, textarea, [role="combobox"], button[aria-haspopup]';

export function InlineEditor<T>({ taskId, label, view, empty = 'Not set', canEdit, lockedWhy, start, patchOf, problemOf, said, children, className }: InlineEditorProps<T>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<T>(start);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const trigger = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const wasEditing = useRef(false);
  const last = useRef<Record<string, unknown> | null>(null);

  const close = () => { setEditing(false); setError(null); setTried(false); };
  const save = useUpdateTask(taskId, { inline: true, onDone: close, onFail: (e) => setError(e) });

  useEffect(() => {
    if (editing && !wasEditing.current) box.current?.querySelector<HTMLElement>(FIRST)?.focus();
    if (!editing && wasEditing.current) trigger.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  const problem = problemOf ? problemOf(draft) : null;
  const shown = tried ? problem : null;
  const submit = () => {
    setTried(true);
    if (problem) return;
    const patch = patchOf(draft);
    if (!patch || Object.keys(patch).length === 0) { close(); return; }
    setError(null);
    last.current = patch;
    save.mutate({ patch, said });
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close(); } };

  return (
    <Fact label={label} empty={empty}>
      {editing ? (
        <div ref={box} className={`flex flex-col gap-[8px] ${className ?? ''}`} onKeyDown={onKeyDown}>
          {children(draft, setDraft, { submit, problem: shown })}
          {shown && <p role="alert" className="text-ds-label text-ds-danger">{shown}</p>}
          <FormError title={`Couldn't save the ${label.toLowerCase()}`} error={error} onRetry={last.current ? () => { setError(null); save.mutate({ patch: last.current as Record<string, unknown>, said }); } : undefined} />
          <div className="flex flex-wrap items-center gap-[8px]">
            <Button variant="primary" size="sm" loading={save.isPending} onClick={submit}>Save</Button>
            <Button size="sm" disabled={save.isPending} onClick={close}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-x-[8px]">
          <span className="min-w-0 flex-1">{view}</span>
          {canEdit && !lockedWhy && (
            <Button ref={trigger} variant="link" size="sm" aria-label={`Change the ${label.toLowerCase()}`} onClick={() => { setDraft(start); setTried(false); setError(null); setEditing(true); }}>Change</Button>
          )}
        </div>
      )}
      {!editing && lockedWhy && <span className="mt-[2px] block text-ds-label text-ds-fg-muted">{lockedWhy}</span>}
    </Fact>
  );
}
