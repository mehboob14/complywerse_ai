'use client';

// The description of the task and, under it, its notes (what the old Evidence tab held). "Edit" turns the card into one editor for the three texts the old Edit form had here: the title, the
// description and the notes. Save sends only what changed; a failed save stays in the card with the server's words and a Retry, everything typed kept. Only the people who may edit see Edit.
import { useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button, ClampedText, FormError, FormField, SectionCard, Textarea, TextInput } from '@/components/ui/ds';
import { TITLE_MAX } from '../../tasksModel';
import { SECTION_IDS, detailsDirty, detailsOf, detailsPatch, detailsProblem, type TaskPageData } from './taskPageModel';
import { useUpdateTask } from './useTaskActions';

export function DescriptionCard({ task, description, canEdit }: { task: TaskPageData; description: string | null; canEdit: boolean }) {
  const start = detailsOf(task);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(start);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const last = useRef<Record<string, unknown> | null>(null);
  const titleBox = useRef<HTMLInputElement>(null);
  const close = () => { setEditing(false); setError(null); setTried(false); };
  const save = useUpdateTask(task.id, { inline: true, onDone: close, onFail: (e) => setError(e) });

  const problem = detailsProblem(draft);
  const shown = (tried && problem) || (draft.title.length > TITLE_MAX ? problem : null);
  const submit = () => {
    setTried(true);
    if (problem) { titleBox.current?.focus(); return; }
    const patch = detailsPatch(draft, start);
    if (Object.keys(patch).length === 0) { close(); return; }
    setError(null);
    last.current = patch;
    save.mutate({ patch, said: 'Changes saved' });
  };

  return (
    <SectionCard
      id={SECTION_IDS.details}
      title="Description"
      actions={canEdit && !editing ? <Button size="sm" leftIcon={<Pencil aria-hidden />} onClick={() => { setDraft(start); setEditing(true); }}>Edit</Button> : undefined}
    >
      {editing ? (
        <div className="flex flex-col gap-[12px]" onKeyDown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close(); } }}>
          <FormField label="Title" required error={shown} hint={shown ? undefined : `${draft.title.length} / ${TITLE_MAX}`}>
            <TextInput ref={titleBox} autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          </FormField>
          <FormField label="Description"><Textarea rows={6} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></FormField>
          <FormField label="Notes" hint="Evidence or anything else worth keeping with the task."><Textarea rows={3} value={draft.evidence_notes} onChange={(e) => setDraft({ ...draft, evidence_notes: e.target.value })} /></FormField>
          <FormError title="Couldn't save the changes" error={error} onRetry={last.current ? () => { setError(null); save.mutate({ patch: last.current as Record<string, unknown>, said: 'Changes saved' }); } : undefined} />
          <div className="flex flex-wrap items-center gap-[8px]">
            <Button variant="primary" loading={save.isPending} disabled={!detailsDirty(draft, start)} onClick={submit}>Save changes</Button>
            <Button disabled={save.isPending} onClick={close}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-[16px]">
          {description?.trim() ? <ClampedText text={description} lines={6} /> : <p className="m-0 text-ds-body text-ds-fg-muted">No description yet.</p>}
          {task.evidence_notes?.trim() && (
            <div>
              <h3 className="mb-[4px] !text-ds-label !font-[600] !text-ds-fg-muted">Notes</h3>
              <ClampedText text={task.evidence_notes} lines={4} />
            </div>
          )}
        </div>
      )}
    </SectionCard>
  );
}
