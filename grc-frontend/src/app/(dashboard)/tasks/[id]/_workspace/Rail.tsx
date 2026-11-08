'use client';

// The properties of a task, edited where they are shown: Status (a menu of the steps the workflow allows from here), Priority, Owners, Reviewer, Due, Approval, Source, Linked to, and under
// "More details" the Category, Severity, SLA days and Repeats. A property with a short list (priority, category, severity) is a select that saves on change; the others have a Change button
// that opens their editor in the row (InlineEditor). Everything saves ONE property at a time (PUT with the field that changed), says what it did, and shows a failure where it happened.
// The tenant's own lists and labels (Settings) are used, and a field the organization removed from its forms is not offered (its value is still shown). Who may edit is `rights`, which
// is what the old Edit button checked; a document request's task keeps its owners, due date and status (they follow the request).
import { useMemo, type ReactNode } from 'react';
import { InfoTip } from '@/components/ui/InfoTip';
import { Button, Disclosure, Fact, Menu, ReadOnlyNote, Select, TextInput, type MenuItem } from '@/components/ui/ds';
import { builtinLabel, listOptions, showBuiltin, useModuleSettings } from '@/components/settings/CustomFields';
import { formatDate, formatDateTime } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { taskStatus } from '@/lib/statuses/tasks';
import { PriorityPill, TaskStatusPill } from '../../_ui';
import { approvalGate, dueWords } from '../../taskRecord';
import { CATEGORIES, PRIORITIES, SEVERITIES, allowedTransitions } from '../../tasksModel';
import { ApprovalPanel } from './ApprovalPanel';
import { InlineEditor } from './InlineEditor';
import { LinkedRow, SourceRow } from './RailLinks';
import { OwnersRow, ReviewerRow } from './RailPeople';
import { duePatch, recurrencePatch, repeatWords, REPEATS, slaDaysPatch, slaDaysProblem, type ApprovalView, type RailRights, type TaskPageData } from './taskPageModel';
import { useMoveTask, useUpdateTask } from './useTaskActions';

const unitOf = (pattern: string): string => REPEATS.find((r) => r.value === pattern)?.unit ?? 'period';
const asChoices = (values: readonly string[]) => values.map((v) => ({ value: v, label: v }));

function StatusRow({ task, rights }: { task: TaskPageData; rights: RailRights }) {
  const move = useMoveTask(task.id);
  const steps = rights.statusLocked ? [] : allowedTransitions(task);
  const items: MenuItem[] = steps.map((to, i) => {
    const held = approvalGate(task, to);
    return { key: `move-${to}`, label: statusPill(taskStatus, to).label, onSelect: () => move.mutate(to), section: i === 0 ? 'Move to' : undefined, disabled: held, reason: held ? 'Needs approval first' : undefined };
  });
  return (
    <Fact label="Status">
      {items.length > 0 ? <Menu label={statusPill(taskStatus, task.status).label} items={items} align="start" disabled={move.isPending} /> : <TaskStatusPill word={task.status} size="md" />}
      {rights.statusLocked && <span className="mt-[2px] block text-ds-label text-ds-fg-muted">Follows the document request</span>}
    </Fact>
  );
}

/** A property with a short list: a select that saves when the person chooses. Read-only text for a person who may not edit. */
function InstantSelect({ task, label, field, value, options, placeholder, canEdit, view }: {
  task: TaskPageData; label: string; field: string; value: string; options: Array<{ value: string; label: string }>; placeholder?: string; canEdit: boolean; view: ReactNode;
}) {
  const update = useUpdateTask(task.id);
  return (
    <Fact label={label} empty="Not set">
      {canEdit ? (
        <Select
          aria-label={label}
          value={value}
          placeholder={placeholder}
          disabled={update.isPending}
          onChange={(e) => {
            const next = e.target.value;
            update.mutate({ patch: { [field]: next || null }, said: next ? `${label} set to ${options.find((o) => o.value === next)?.label ?? next}` : `${label} cleared` });
          }}
        >
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </Select>
      ) : view}
    </Fact>
  );
}

function DueRow({ task, label, canEdit, locked, now }: { task: TaskPageData; label: string; canEdit: boolean; locked: boolean; now: Date }) {
  const start = task.due_date ? task.due_date.slice(0, 10) : '';
  const words = dueWords(task, now);
  return (
    <InlineEditor<string>
      taskId={task.id}
      label={label}
      view={task.due_date ? (
        <span className="flex flex-col items-start">
          <span className="text-ds-body text-ds-fg">{formatDate(task.due_date, { calendar: true })}</span>
          {words && <span className={`text-ds-label ${words.late ? 'font-[600] text-ds-danger' : 'text-ds-fg-muted'}`}>{words.text}</span>}
        </span>
      ) : <span className="text-ds-fg-muted">Not set</span>}
      canEdit={canEdit}
      lockedWhy={locked ? 'Follows the document request' : undefined}
      start={start}
      patchOf={(draft) => (draft === start ? null : duePatch(draft))}
      said="Due date updated"
    >
      {(draft, set, { submit }) => (
        <>
          <TextInput type="date" aria-label={label} value={draft} onChange={(e) => set(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />
          {draft && <Button variant="link" size="sm" className="self-start" onClick={() => set('')}>Remove the date</Button>}
        </>
      )}
    </InlineEditor>
  );
}

function SlaRow({ task, canEdit }: { task: TaskPageData; canEdit: boolean }) {
  const start = task.sla_days ? String(task.sla_days) : '';
  return (
    <InlineEditor<string>
      taskId={task.id}
      label="SLA days"
      view={task.sla_days ? `${task.sla_days} ${task.sla_days === 1 ? 'day' : 'days'}` : <span className="text-ds-fg-muted">Not set</span>}
      canEdit={canEdit}
      start={start}
      patchOf={(draft) => (draft === start ? null : slaDaysPatch(draft))}
      problemOf={slaDaysProblem}
      said="SLA days updated"
    >
      {(draft, set, { submit }) => <TextInput type="number" min={1} unit="days" aria-label="SLA days" value={draft} onChange={(e) => set(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }} />}
    </InlineEditor>
  );
}

function RepeatRow({ task, canEdit }: { task: TaskPageData; canEdit: boolean }) {
  const start = { pattern: task.recurrence_pattern ?? '', interval: String(task.recurrence_interval ?? 1) };
  const words = repeatWords(task.recurrence_pattern, task.recurrence_interval);
  return (
    <InlineEditor<{ pattern: string; interval: string }>
      taskId={task.id}
      label="Repeats"
      view={words ?? <span className="text-ds-fg-muted">Does not repeat</span>}
      canEdit={canEdit}
      start={start}
      patchOf={(d) => (d.pattern === start.pattern && (d.pattern === '' || d.interval === start.interval) ? null : recurrencePatch(d.pattern, d.interval))}
      said="Repeat updated"
    >
      {(d, set) => (
        <div className="flex flex-wrap items-center gap-[8px]">
          <Select aria-label="Repeats" placeholder="Does not repeat" value={d.pattern} onChange={(e) => set({ ...d, pattern: e.target.value })} className="min-w-[140px] flex-1">
            {REPEATS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </Select>
          {d.pattern && <TextInput type="number" min={1} aria-label={`Repeat every how many ${unitOf(d.pattern)}s`} unit={`${unitOf(d.pattern)}s`} value={d.interval} onChange={(e) => set({ ...d, interval: e.target.value })} className="w-[150px]" />}
        </div>
      )}
    </InlineEditor>
  );
}

export interface RailProps { task: TaskPageData; rights: RailRights; approval: ApprovalView; showApprovalNote: boolean; now: Date }

export function Rail({ task, rights, approval, showApprovalNote, now }: RailProps) {
  const { data: settings } = useModuleSettings('tasks');
  const opts = useMemo(() => ({
    priority: listOptions(settings, 'priority', task.priority, asChoices(PRIORITIES)),
    category: listOptions(settings, 'category', task.category, asChoices(CATEGORIES)),
    severity: listOptions(settings, 'severity', task.severity, asChoices(SEVERITIES)),
  }), [settings, task.priority, task.category, task.severity]);
  // a field the organization removed from its forms is not offered; one that still holds a value is still shown (read-only)
  const may = (key: string, has: boolean) => ({ show: showBuiltin(settings, key) || has, edit: rights.edit && showBuiltin(settings, key) });
  const priority = may('priority', true);
  const owners = may('owners', true);
  const reviewer = may('reviewer', !!task.reviewer_id);
  const due = may('due_date', !!task.due_date);
  const category = may('category', true);
  const severity = may('severity', !!task.severity);

  return (
    <div className="flex flex-col gap-[16px]">
      {!rights.edit && <ReadOnlyNote>View only <InfoTip text="Changing a task's details needs the edit right. You can still move the task, comment, tick sub-tasks and ask for or give an approval." label="Why the details are view only" /></ReadOnlyNote>}
      <dl className="m-0 flex flex-col gap-[16px]">
      <StatusRow task={task} rights={rights} />
      {priority.show && <InstantSelect task={task} label={builtinLabel(settings, 'priority', 'Priority')} field="priority" value={task.priority} options={opts.priority} canEdit={priority.edit} view={<PriorityPill word={task.priority} size="md" />} />}
      {owners.show && <OwnersRow task={task} label={builtinLabel(settings, 'owners', 'Owners')} canEdit={owners.edit && !rights.ownersLocked} locked={rights.ownersLocked} />}
      {reviewer.show && <ReviewerRow task={task} label={builtinLabel(settings, 'reviewer', 'Reviewer')} canEdit={reviewer.edit} />}
      {due.show && <DueRow task={task} label={builtinLabel(settings, 'due_date', 'Due date')} canEdit={due.edit && !rights.dueLocked} locked={rights.dueLocked} now={now} />}
      <ApprovalPanel task={task} view={approval} canEdit={rights.edit} showNote={showApprovalNote} />
      <SourceRow task={task} />
      <LinkedRow task={task} canEdit={rights.edit} />
    </dl>
      <Disclosure label="More details" level={3} region={false}>
        <dl className="m-0 mt-[12px] flex flex-col gap-[16px]">
          {category.show && <InstantSelect task={task} label={builtinLabel(settings, 'category', 'Category')} field="category" value={task.category} options={opts.category} canEdit={category.edit} view={task.category} />}
          {severity.show && <InstantSelect task={task} label={builtinLabel(settings, 'severity', 'Severity')} field="severity" value={task.severity ?? ''} options={opts.severity} placeholder="Not set" canEdit={severity.edit} view={task.severity} />}
          <SlaRow task={task} canEdit={rights.edit} />
          <RepeatRow task={task} canEdit={rights.edit} />
          {task.completed_at && <Fact label="Completed">{formatDateTime(task.completed_at)}</Fact>}
          {task.verified_at && <Fact label="Verified">{formatDateTime(task.verified_at)}</Fact>}
        </dl>
      </Disclosure>
    </div>
  );
}
