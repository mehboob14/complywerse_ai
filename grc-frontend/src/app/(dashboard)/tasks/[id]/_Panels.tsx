'use client';

// The five tabs of a task's page: Details (the description and the facts), Sub-tasks, Comments, Evidence and History. Everything on them is what the old page showed, in words and on the kit:
// dates are the platform's ("12 Nov 2026, 14:05" for a moment, the day as written for a due date), an empty value is "—" or "Not set" where the person can set it, a long description or history
// value is cut with a way to read all of it, and every write (add or tick a sub-task, delete one, post a comment) says what happened after the server answered. Deleting a sub-task asks first.
import { useState, type ReactNode } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { criticalTasksApi } from '@/lib/api';
import { NOT_SET, EMPTY, formatCount, formatDate, formatDateTime, truncate } from '@/lib/format';
import { Button, Checkbox, EmptyState, IconButton, PersonChip, SectionCard, Textarea, TextInput, useConfirm, useReportedMutation } from '@/components/ui/ds';
import { SubTaskPill } from '../_ui';
import { TITLE_MAX, personName, titleProblem, type TaskDetail } from '../tasksModel';

const CLAMP = 600;

/** Long text: the first part and a button for the rest. */
export function Clamp({ text, empty }: { text: string | null | undefined; empty: string }) {
  const [all, setAll] = useState(false);
  const value = (text ?? '').trim() ? (text as string) : '';
  if (!value) return <p className="text-ds-body text-ds-fg-muted">{empty}</p>;
  const cut = truncate(value, CLAMP);
  return (
    <div>
      <p className="whitespace-pre-wrap text-ds-body text-ds-fg [overflow-wrap:anywhere]">{all || !cut.truncated ? value : cut.text}</p>
      {cut.truncated && <Button variant="link" size="sm" className="mt-[4px]" onClick={() => setAll(!all)}>{all ? 'Show less' : 'Show all'}</Button>}
    </div>
  );
}

function Facts({ title, rows }: { title: string; rows: Array<[string, ReactNode]> }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-[8px] !text-ds-body !font-[600] !text-ds-fg">{title}</h3>
      <dl className="m-0 flex flex-col gap-[8px]">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-[16px]">
            <dt className="shrink-0 text-ds-body text-ds-fg-muted">{label}</dt>
            <dd className="m-0 min-w-0 text-right text-ds-body text-ds-fg [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const linked = (id: number | null) => (id ? `#${id}` : NOT_SET);

export function DetailsPanel({ task, description, docFacts }: { task: TaskDetail; description: string | null; docFacts: Array<[string, string]> | null }) {
  const docTask = docFacts !== null;
  return (
    <SectionCard id="task-details" title="Description">
      <div className="flex flex-col gap-[16px]">
        <Clamp text={description} empty="No description provided." />
        <div className="grid grid-cols-1 gap-[24px] md:grid-cols-2">
          {docFacts ? <Facts title="Document request" rows={docFacts} /> : (
            <Facts
              title="Task information"
              rows={[
                ['Source', task.source],
                ['Source module', task.source_module || EMPTY],
                ['Source entity', task.source_entity_type ? `${task.source_entity_type} #${task.source_entity_id}` : EMPTY],
                ['Category', task.category],
                ['Severity', task.severity || NOT_SET],
                ['SLA days', task.sla_days ? String(task.sla_days) : NOT_SET],
                ['Escalation level', String(task.escalation_level)],
              ]}
            />
          )}
          {!docTask && (
            <Facts title="Linked records" rows={[['Risk', linked(task.linked_risk_id)], ['Control', linked(task.linked_control_id)], ['Finding', linked(task.linked_finding_id)], ['Vulnerability', linked(task.linked_vulnerability_id)]]} />
          )}
        </div>
        {(task.completed_at || task.verified_at) && (
          <Facts title="Completion" rows={[...(task.completed_at ? [['Completed', formatDateTime(task.completed_at)] as [string, string]] : []), ...(task.verified_at ? [['Verified', formatDateTime(task.verified_at)] as [string, string]] : [])]} />
        )}
      </div>
    </SectionCard>
  );
}

export function SubTasksPanel({ task, canDelete }: { task: TaskDetail; canDelete: boolean }) {
  const [title, setTitle] = useState('');
  const [tried, setTried] = useState(false);
  const { confirm, confirmDialog } = useConfirm();
  const invalidate = [['critical-task', task.id]] as const;

  const add = useReportedMutation({
    mutationFn: (value: string) => criticalTasksApi.createSubTask(task.id, { title: value }),
    success: 'Sub-task added',
    failure: "Couldn't add the sub-task",
    invalidate,
    onSuccess: () => { setTitle(''); setTried(false); },
  });
  const toggle = useReportedMutation({
    mutationFn: ({ subId, done }: { subId: number; done: boolean }) => criticalTasksApi.updateSubTask(task.id, subId, { status: done ? 'Completed' : 'Open' }),
    success: 'Sub-task updated',
    failure: "Couldn't update the sub-task",
    invalidate,
    toast: 'errors',                                                    // the tick moving is the confirmation
  });
  const remove = useReportedMutation({
    mutationFn: (subId: number) => criticalTasksApi.deleteSubTask(task.id, subId),
    success: 'Sub-task deleted',
    failure: "Couldn't delete the sub-task",
    invalidate,
  });

  const submit = () => {
    setTried(true);
    if (titleProblem(title, 'sub-task title')) return;
    add.mutate(title.trim());                                          // what the page has always sent: the trimmed title
  };
  const error = titleProblem(title, 'sub-task title');
  const shownError = (tried && error) || (title.length > TITLE_MAX ? error : null);       // too long is said at once (the table holds 255); empty only after a try
  const subs = task.sub_tasks || [];
  const done = subs.filter((s) => s.status === 'Completed').length;

  const ask = async (id: number, name: string) => {
    const yes = await confirm({ title: 'Delete this sub-task?', message: `“${truncate(name, 100).text}” is removed from the task.`, confirmLabel: 'Delete sub-task', tone: 'danger' });
    if (yes) remove.mutate(id);
  };

  return (
    <SectionCard id="task-subtasks" title="Sub-tasks" meta={subs.length > 0 ? `${formatCount(done)} of ${formatCount(subs.length)} done` : undefined}>
      <div className="flex flex-col gap-[12px]">
        <form className="flex flex-col gap-[8px] sm:flex-row" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <div className="min-w-0 flex-1">
            <TextInput aria-label="New sub-task" placeholder="Add a sub-task" value={title} invalid={!!shownError} onChange={(e) => setTitle(e.target.value)} />
            {shownError && <p role="alert" className="mt-[4px] text-ds-label text-ds-danger">{shownError}</p>}
          </div>
          <Button type="submit" variant="primary" loading={add.isPending}>Add sub-task</Button>
        </form>
        {subs.length === 0 ? (
          <EmptyState bare kind="firstUse" title="No sub-tasks yet" info="Break the task into smaller steps and tick them off here." />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[8px] p-0">
            {subs.map((st) => (
              <li key={st.id} className="flex flex-wrap items-center gap-x-[12px] gap-y-[4px] rounded-ds-card border border-ds-border bg-ds-surface px-[12px]">
                <Checkbox
                  className="min-w-0 flex-1"
                  checked={st.status === 'Completed'}
                  disabled={toggle.isPending && toggle.variables?.subId === st.id}
                  onChange={(e) => toggle.mutate({ subId: st.id, done: e.target.checked })}
                  label={<span className={st.status === 'Completed' ? 'text-ds-fg-muted line-through' : 'text-ds-fg'}>{st.title}</span>}
                />
                <span className="flex flex-wrap items-center gap-[8px]">
                  {st.status !== 'Completed' && st.status !== 'Open' && <SubTaskPill word={st.status} />}
                  {st.assigned_owner && <PersonChip name={personName(st.assigned_owner)} size={20} />}
                  {st.due_date && <span className="text-ds-label text-ds-fg-muted">Due {formatDate(st.due_date, { calendar: true })}</span>}
                  {canDelete && <IconButton label={`Delete sub-task: ${truncate(st.title, 60).text}`} onClick={() => { void ask(st.id, st.title); }}><Trash2 aria-hidden /></IconButton>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirmDialog}
    </SectionCard>
  );
}

export function CommentsPanel({ task }: { task: TaskDetail }) {
  const [text, setText] = useState('');
  const post = useReportedMutation({
    mutationFn: (content: string) => criticalTasksApi.addComment(task.id, { content }),
    success: 'Comment added',
    failure: "Couldn't add the comment",
    invalidate: [['critical-task', task.id]],
    onSuccess: () => setText(''),
  });
  const comments = task.comments || [];
  const send = () => { if (text.trim()) post.mutate(text.trim()); };

  return (
    <SectionCard id="task-comments" title="Comments" meta={comments.length > 0 ? `${formatCount(comments.length)} ${comments.length === 1 ? 'comment' : 'comments'}` : undefined}>
      <div className="flex flex-col gap-[12px]">
        <div className="flex flex-col gap-[8px] sm:flex-row sm:items-start">
          <Textarea aria-label="New comment" rows={2} placeholder="Add a comment" value={text} onChange={(e) => setText(e.target.value)} className="sm:flex-1" />
          <Button variant="primary" leftIcon={<Send aria-hidden />} loading={post.isPending} disabled={!text.trim()} onClick={send}>Post comment</Button>
        </div>
        {comments.length === 0 ? (
          <EmptyState bare kind="firstUse" title="No comments yet" info="Comments stay with the task and are listed oldest first." />
        ) : (
          <ul className="m-0 flex list-none flex-col gap-[12px] p-0">
            {comments.map((c) => (
              <li key={c.id} className="rounded-ds-card border border-ds-border bg-ds-surface p-[12px]">
                <div className="mb-[6px] flex flex-wrap items-center justify-between gap-[8px]">
                  <PersonChip name={personName(c.user)} emptyLabel="Unknown" size={20} />
                  <span className="text-ds-label text-ds-fg-muted">{formatDateTime(c.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-ds-body text-ds-fg [overflow-wrap:anywhere]">{c.content}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

export function EvidencePanel({ task }: { task: TaskDetail }) {
  return (
    <SectionCard id="task-evidence" title="Evidence and notes">
      <Clamp text={task.evidence_notes} empty="No evidence or notes attached to this task." />
    </SectionCard>
  );
}

const PAGE = 50;

export function HistoryPanel({ task }: { task: TaskDetail }) {
  const [shown, setShown] = useState(PAGE);
  const history = task.history || [];
  return (
    <SectionCard id="task-history" title="History" meta={history.length > 0 ? `${formatCount(history.length)} ${history.length === 1 ? 'entry' : 'entries'}, newest first` : undefined}>
      {history.length === 0 ? (
        <EmptyState bare kind="firstUse" title="No history yet" info="Every change to the task is recorded here." />
      ) : (
        <>
          <ol className="m-0 flex list-none flex-col gap-[12px] p-0">
            {history.slice(0, shown).map((h) => (
              <li key={h.id} className="flex items-start gap-[12px]">
                <span aria-hidden className="mt-[6px] h-[8px] w-[8px] shrink-0 rounded-full bg-ds-primary" />
                <div className="min-w-0 flex-1">
                  <p className="text-ds-body text-ds-fg"><span className="font-[600]">{h.action}</span>{h.field_changed && <span className="text-ds-fg-muted"> ({h.field_changed})</span>}</p>
                  {(h.old_value || h.new_value) && (
                    <p className="mt-[2px] text-ds-body text-ds-fg-muted [overflow-wrap:anywhere]">
                      {h.old_value && <span className="text-ds-danger line-through">{truncate(h.old_value, 160).text}</span>}
                      {h.old_value && h.new_value && <span> to </span>}
                      {h.new_value && <span className="text-ds-success">{truncate(h.new_value, 160).text}</span>}
                    </p>
                  )}
                  <p className="mt-[2px] text-ds-label text-ds-fg-muted">{personName(h.user) || 'System'} · {formatDateTime(h.created_at)}</p>
                </div>
              </li>
            ))}
          </ol>
          {history.length > shown && <Button className="mt-[12px]" onClick={() => setShown(shown + PAGE)}>{`Show ${Math.min(PAGE, history.length - shown)} more`}</Button>}
        </>
      )}
    </SectionCard>
  );
}
