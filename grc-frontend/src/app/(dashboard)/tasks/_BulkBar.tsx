'use client';

// What the board does with the tasks that are ticked: set their priority, move them to In Progress or Completed, give them to one person. The requests are the old ones (the same
// action names and values, the same payloads); what changed is what they say. The server answers how many it changed and how many it left (a document request's task follows its
// request), and the bar says so: "Updated 2 of 5 tasks", or that nothing changed and why, never a quiet success. A failed write is a message with Retry. Moving tasks to Completed and
// giving them to someone ask first, as an action on many records should.
import { useState } from 'react';
import { CheckCircle2, Flag, PlayCircle, UserPlus } from 'lucide-react';
import { criticalTasksApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Button, Combobox, FormField, Menu, useConfirm, useNotify, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { FormProblem } from './_ui';
import { PRIORITIES, bulkReport, userOptions, type BulkAction, type TaskUser } from './tasksModel';

interface BulkVars { ids: number[]; action: BulkAction; value?: string; assignee?: number }

/** The body the server has always been sent for each action. */
const bodyOf = (v: BulkVars): Record<string, unknown> => (v.action === 'assign'
  ? { task_ids: v.ids, action: v.action, assigned_owner_id: v.assignee }
  : { task_ids: v.ids, action: v.action, value: v.value });

export function BulkBar({ ids, users, onClear }: { ids: number[]; users: { data?: TaskUser[]; isError: boolean; error: unknown; refetch: () => unknown }; onClear: () => void }) {
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const [assigning, setAssigning] = useState(false);
  const [person, setPerson] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ message: string; retry: boolean } | null>(null);

  const bulk = useReportedMutation({
    mutationFn: (v: BulkVars) => criticalTasksApi.bulkAction(bodyOf(v)),
    success: 'Done',                                                   // not used: what it says depends on what the server did (below)
    failure: "Couldn't update the tasks",
    invalidate: [['critical-tasks']],
    toast: 'errors',
    onSuccess: (response, v) => {
      const report = bulkReport({ action: v.action, selected: v.ids.length, updated: Number(response?.data?.updated) || 0, left: Number(response?.data?.left_document_tasks) || 0 });
      if (report.kind === 'success') {
        notify.success(report.message ?? report.title, report.message ? { title: report.title } : undefined);
        onClear();
      } else {
        notify.warning(report.message ?? report.title, report.message ? { title: report.title } : undefined);   // nothing changed: the ticks stay, so another choice can be made
      }
      setAssigning(false);
      setPerson(null);
      setProblem(null);
    },
    onError: (error) => setProblem({ message: errorMessage(error, 'The tasks were not updated.'), retry: canRetry(error) }),
  });

  const n = ids.length;
  const noun = `${n} task${n === 1 ? '' : 's'}`;
  const run = (v: Omit<BulkVars, 'ids'>) => bulk.mutate({ ids, ...v });

  const completeAll = async () => {
    const yes = await confirm({
      title: `Move ${noun} to Completed?`,
      message: 'A task moves one step at a time: only the selected tasks that are Under Review can be completed, and the others are left as they are.',
      confirmLabel: `Complete ${noun}`,
    });
    if (yes) run({ action: 'change_status', value: 'Completed' });
  };

  const items: MenuItem[] = [
    ...PRIORITIES.map((p) => ({ key: `priority-${p}`, label: `Set priority to ${p}`, icon: Flag, onSelect: () => run({ action: 'change_priority', value: p }) })),
    { key: 'status-progress', label: 'Set status to In Progress', icon: PlayCircle, onSelect: () => run({ action: 'change_status', value: 'In Progress' }) },
    { key: 'status-completed', label: 'Set status to Completed', icon: CheckCircle2, onSelect: () => { void completeAll(); } },
    { key: 'assign', label: 'Assign to…', icon: UserPlus, onSelect: () => { setProblem(null); setAssigning(true); } },
  ];

  return (
    <div role="region" aria-label="Selected tasks" className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px] rounded-ds-card border border-ds-border bg-ds-primary-soft px-[12px] py-[8px]">
      <span role="status" className="text-ds-body font-[600] text-ds-fg">{n} selected</span>
      <Menu label={`Bulk actions (${n})`} items={items} disabled={bulk.isPending} />
      <Button variant="ghost" onClick={onClear}>Clear selection</Button>
      <AnimatedModal
        isOpen={assigning}
        onClose={() => setAssigning(false)}
        title={`Assign ${noun}`}
        size="md"
        dirty={person !== null}
        footer={(
          <div className="flex items-center justify-end gap-2">
            <Button onClick={() => setAssigning(false)}>Cancel</Button>
            <Button variant="primary" loading={bulk.isPending} disabled={!person} onClick={() => run({ action: 'assign', assignee: Number(person) })}>Assign</Button>
          </div>
        )}
      >
        <div className="flex flex-col gap-[12px] p-[16px]">
          <FormProblem message={problem?.message} onRetry={problem?.retry && person ? () => run({ action: 'assign', assignee: Number(person) }) : undefined} />
          <FormField label="Assign to" hint="The person becomes the only owner of each selected task. A task from a document request is left as it is.">
            <Combobox label="Person" searchable options={userOptions(users.data)} value={person} onChange={setPerson} placeholder={users.isError ? 'The people could not be loaded' : 'Select a person'} searchPlaceholder="Search users" />
          </FormField>
          {users.isError && <Button onClick={() => { void users.refetch(); }}>Retry loading people</Button>}
        </div>
      </AnimatedModal>
      {confirmDialog}
    </div>
  );
}
