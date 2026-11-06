'use client';

// The delivery tabs of a project: Milestones (cards, each with its evidence), Tasks and Team (registers: a table from 768px, cards below). What a person changes
// in place (a milestone's status and completion, a task's status and progress) is saved when the choice is made or the percent box is left, said by the page's
// useReportedMutation, and put back if the server refuses; every Delete is a menu item that asks first. Dates: a target or due date is a day (never shifted),
// a join date is a moment in the viewer's own zone. Nothing here sends a request itself: the page does (`Handlers`).
import { CheckCircle2, Milestone as MilestoneIcon, Plus, Users } from 'lucide-react';
import { Button, EmptyState, FormField, PersonChip, RegisterTable, SectionCard, StatusPill, type RegisterColumn } from '@/components/ui/ds';
import { NOT_SET, EMPTY, formatCount, formatDate } from '@/lib/format';
import { priority as priorityStatus, statusPill } from '@/lib/status';
import { milestoneStatus } from '@/lib/projectStatus';
import { MILESTONE_STATUSES, TASK_STATUSES } from '../_model';
import { ProgressBar } from '../_ui';
import { MilestoneEvidencePanel } from './_Evidence';
import { AiButton, CARD, CHIP, InlineSelect, PercentBox, RowMenu, type Handlers } from './_parts';
import type { Milestone, ProjectDetail, Task, TeamMember } from './_types';

const count = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`;

export function MilestonesTab({ project, h }: { project: ProjectDetail; h: Handlers }) {
  const rows = project.milestones ?? [];
  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => h.add('milestone')}>Add milestone</Button>;
  return (
    <SectionCard id="milestones" title="Milestones" meta={rows.length > 0 ? count(rows.length, 'milestone', 'milestones') : undefined} actions={<><AiButton h={h} ai="generate-plan">AI generate</AiButton>{add}</>}>
      {rows.length === 0 ? (
        <EmptyState kind="firstUse" bare icon={MilestoneIcon} title="No milestones yet" action={add} />
      ) : (
        <ul className="flex flex-col gap-[12px]">
          {rows.map((m: Milestone) => (
            <li key={m.id} className={CARD}>
              <div className="flex items-start justify-between gap-[12px]">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[4px]">
                    <p className="min-w-0 break-words text-ds-body font-[600] text-ds-fg">{m.name || 'Untitled milestone'}</p>
                    <StatusPill size="sm" {...statusPill(milestoneStatus, m.status)} />
                  </div>
                  {m.description && <p className="mt-[4px] text-ds-body text-ds-fg-muted [overflow-wrap:anywhere]">{m.description}</p>}
                  <p className="mt-[4px] flex flex-wrap gap-x-[12px] text-ds-label text-ds-fg-muted">
                    <span>Target: {formatDate(m.target_date, { calendar: true, empty: NOT_SET })}</span>
                    {m.actual_completion_date && <span>Completed: {formatDate(m.actual_completion_date, { calendar: true })}</span>}
                  </p>
                </div>
                <RowMenu label={m.name || 'milestone'} onDelete={() => h.remove('milestone', m.id, m.name || 'this milestone')} />
              </div>
              <div className="mt-[8px]"><ProgressBar value={m.completion_percentage} label={`${m.name} completion`} width="w-[160px]" /></div>
              {m.deliverables && m.deliverables.length > 0 && (
                <ul aria-label="Deliverables" className="mt-[8px] flex flex-wrap gap-[6px]">{m.deliverables.map((d, i) => <li key={`${d}-${i}`} className={CHIP}><span className="truncate" title={d}>{d}</span></li>)}</ul>
              )}
              <div className="mt-[12px] flex flex-wrap items-end gap-[12px]">
                <FormField label="Status" className="w-[168px] max-w-full">
                  <InlineSelect value={m.status} options={MILESTONE_STATUSES} label={`Status of ${m.name}`} onSave={(status) => h.change.milestone(m.id, { status })} />
                </FormField>
                <FormField label="Completion" className="w-[120px]">
                  <PercentBox value={m.completion_percentage} onCommit={(n) => h.change.milestone(m.id, { completion_percentage: n })} />
                </FormField>
              </div>
              <MilestoneEvidencePanel projectId={project.id} milestoneId={m.id} milestoneName={m.name} />
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}

function TaskTitle({ t }: { t: Task }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="line-clamp-2 break-words text-ds-body font-[600] text-ds-fg" title={t.title}>{t.title || 'Untitled task'}</p>
      {t.dependencies && t.dependencies.length > 0 && (
        <ul aria-label="Depends on" className="mt-[4px] flex flex-wrap gap-[4px]">{t.dependencies.map((d, i) => <li key={`${d}-${i}`} className={CHIP}><span className="truncate" title={d}>Depends on {d}</span></li>)}</ul>
      )}
    </div>
  );
}

export function TasksTab({ project, h }: { project: ProjectDetail; h: Handlers }) {
  const rows = project.tasks ?? [];
  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => h.add('task')}>Add task</Button>;
  const menu = (t: Task) => <RowMenu label={t.title || 'task'} onDelete={() => h.remove('task', t.id, t.title || 'this task')} />;
  const columns: Array<RegisterColumn<Task>> = [
    { key: 'title', header: 'Task', isRowHeader: true, cell: (t) => <TaskTitle t={t} /> },
    { key: 'assignee', header: 'Assignee', priority: 3, width: 'w-[152px]', card: 'meta', cell: (t) => <PersonChip name={t.assignee_name} /> },
    { key: 'status', header: 'Status', width: 'w-[152px]', card: 'meta', cell: (t) => <InlineSelect value={t.status} options={TASK_STATUSES} label={`Status of ${t.title}`} onSave={(status) => h.change.task(t.id, { status })} /> },
    { key: 'priority', header: 'Priority', priority: 2, width: 'w-[96px]', card: 'meta', cell: (t) => <StatusPill size="sm" {...statusPill(priorityStatus, t.priority)} /> },
    { key: 'due', header: 'Due date', priority: 2, width: 'w-[112px]', card: 'meta', cell: (t) => <span className={`whitespace-nowrap tabular-nums ${t.due_date ? '' : 'text-ds-fg-muted'}`}>{formatDate(t.due_date, { calendar: true, empty: NOT_SET })}</span> },
    { key: 'progress', header: 'Progress', width: 'w-[124px]', card: 'meta', cell: (t) => <PercentBox value={t.progress} label={`Progress of ${t.title}`} onCommit={(n) => h.change.task(t.id, { progress: n })} /> },
    { key: 'actions', header: 'Actions', align: 'right', width: 'w-[56px]', cell: menu },
  ];
  return (
    <SectionCard id="tasks" title="Tasks" meta={rows.length > 0 ? count(rows.length, 'task', 'tasks') : undefined} actions={<><AiButton h={h} ai="generate-plan">AI generate</AiButton>{add}</>}>
      <RegisterTable<Task>
        caption="Tasks"
        columns={columns}
        rows={rows}
        getRowId={(t) => t.id}
        cardTitle={(t) => <div className="flex items-start justify-between gap-[8px]"><TaskTitle t={t} />{menu(t)}</div>}
        empty={<EmptyState kind="firstUse" bare icon={CheckCircle2} title="No tasks yet" action={add} />}
      />
    </SectionCard>
  );
}

export function TeamTab({ project, h }: { project: ProjectDetail; h: Handlers }) {
  const rows = project.team_members ?? [];
  const add = <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => h.add('team')}>Add member</Button>;
  const menu = (m: TeamMember) => <RowMenu label={m.user_name || 'member'} deleteLabel="Remove from project" onDelete={() => h.remove('team', m.id, m.user_name || 'this member')} />;
  const columns: Array<RegisterColumn<TeamMember>> = [
    {
      key: 'member', header: 'Member', isRowHeader: true,
      cell: (m) => (
        <div className="min-w-0">
          <PersonChip name={m.user_name} />
          <p className="mt-[2px] truncate text-ds-label text-ds-fg-muted" title={m.email || undefined}>{m.email || EMPTY}</p>
        </div>
      ),
    },
    { key: 'role', header: 'Role', width: 'w-[152px]', card: 'meta', cell: (m) => <span className="text-ds-fg-body">{m.role || EMPTY}</span> },
    { key: 'resp', header: 'Responsibilities', priority: 2, card: 'meta', cell: (m) => (m.responsibilities ? <span className="line-clamp-2 text-ds-fg-body [overflow-wrap:anywhere]" title={m.responsibilities}>{m.responsibilities}</span> : <span className="text-ds-fg-muted">{EMPTY}</span>) },
    { key: 'joined', header: 'Joined', priority: 2, width: 'w-[112px]', card: 'meta', cell: (m) => <span className="whitespace-nowrap tabular-nums">{formatDate(m.joined_at)}</span> },
    { key: 'actions', header: 'Actions', align: 'right', width: 'w-[56px]', cell: menu },
  ];
  return (
    <SectionCard id="team" title="Team members" meta={rows.length > 0 ? count(rows.length, 'member', 'members') : undefined} actions={<><AiButton h={h} ai="suggest-team">AI suggest</AiButton>{add}</>}>
      <RegisterTable<TeamMember>
        caption="Team members"
        columns={columns}
        rows={rows}
        getRowId={(m) => m.id}
        cardTitle={(m) => <div className="flex items-start justify-between gap-[8px]"><PersonChip name={m.user_name} />{menu(m)}</div>}
        empty={<EmptyState kind="firstUse" bare icon={Users} title="No team members yet" action={add} />}
      />
    </SectionCard>
  );
}
