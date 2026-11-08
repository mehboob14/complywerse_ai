'use client';

/**
 * What the register does with the tasks that are ticked: set their priority, move them to a status, give them to one person, export them. The requests are the old ones (`POST
 * critical-tasks/bulk-action` with the same action names and values); what changed is what is said. The server answers how many it changed and how many it left (a document request's task
 * follows its request), and the register says so: "Updated 2 of 5 tasks", or that nothing changed and why, never a quiet success. A failed write is a message with Retry. Every write on
 * many tasks asks first, naming how many. The hook returns the actions for the shared BulkBar and the dialog Assign opens.
 */
import { useState, type ReactNode } from 'react';
import { CheckCircle2, Download, Flag, PlayCircle, UserPlus } from 'lucide-react';
import { criticalTasksApi } from '@/lib/api';
import { AnimatedModal } from '@/components/ui/AnimatedModal';
import { Button, Combobox, FormField, useConfirm, useNotify, useReportedMutation, type MenuItem } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import type { BulkActionDef } from '@/components/records/BulkBar';
import { FormProblem } from '../_ui';
import { PRIORITIES, bulkReport, userOptions, type BulkAction, type TaskUser } from '../tasksModel';
import { TASK_REFRESH } from './taskData';

interface BulkVars { ids: number[]; action: BulkAction; value?: string; assignee?: number }

/** The body the server has always been sent for each action. */
const bodyOf = (v: BulkVars): Record<string, unknown> => (v.action === 'assign'
  ? { task_ids: v.ids, action: v.action, assigned_owner_id: v.assignee }
  : { task_ids: v.ids, action: v.action, value: v.value });

export interface BulkTasksArgs {
  /** the ticked tasks */
  ids: number[];
  users: { data?: TaskUser[]; isError: boolean; error: unknown; refetch: () => unknown };
  /** the ticks are cleared once the write changed something (a write that changed nothing leaves them, so another choice can be made) */
  onDone: () => void;
  /** the ticked tasks as a spreadsheet */
  onExport: () => void;
}

export function useBulkTasks({ ids, users, onDone, onExport }: BulkTasksArgs): { actions: BulkActionDef[]; more: MenuItem[]; busy: boolean; dialogs: ReactNode } {
  const notify = useNotify();
  const { confirm, confirmDialog } = useConfirm();
  const [assigning, setAssigning] = useState(false);
  const [person, setPerson] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ message: string; retry: boolean } | null>(null);

  const bulk = useReportedMutation({
    mutationFn: (v: BulkVars) => criticalTasksApi.bulkAction(bodyOf(v)),
    failure: "Couldn't update the tasks",
    invalidate: TASK_REFRESH,
    toast: 'errors',
    onSuccess: (response, v) => {
      const report = bulkReport({ action: v.action, selected: v.ids.length, updated: Number(response?.data?.updated) || 0, left: Number(response?.data?.left_document_tasks) || 0 });
      if (report.kind === 'success') {
        notify.success(report.message ?? report.title, report.message ? { title: report.title } : undefined);
        onDone();
      } else {
        notify.warning(report.message ?? report.title, report.message ? { title: report.title } : undefined);       // nothing changed: the ticks stay, so another choice can be made
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

  const priority = async (p: string) => {
    const yes = await confirm({ title: `Set the priority of ${noun} to ${p}?`, message: 'Each selected task takes the new priority. A task from a document request is left as it is.', confirmLabel: `Set to ${p}` });
    if (yes) run({ action: 'change_priority', value: p });
  };
  const status = async (to: 'In Progress' | 'Under Review' | 'Completed') => {
    const yes = await confirm({
      title: `Move ${noun} to ${to}?`,
      message: 'A task moves one step at a time: the selected tasks that cannot move to that status from where they are, and tasks from a document request, are left as they are.',
      confirmLabel: `Move ${noun}`,
    });
    if (yes) run({ action: 'change_status', value: to });
  };

  const actions: BulkActionDef[] = [
    { id: 'assign', label: 'Assign to…', icon: UserPlus, disabled: bulk.isPending, onRun: () => { setProblem(null); setAssigning(true); } },
    { id: 'export', label: 'Export selection', icon: Download, onRun: onExport },
  ];
  const more: MenuItem[] = [
    ...PRIORITIES.map((p, i) => ({ key: `priority-${p}`, label: p, icon: Flag, section: i === 0 ? 'Set priority to' : undefined, disabled: bulk.isPending, onSelect: () => { void priority(p); } })),
    { key: 'status-progress', label: 'In progress', icon: PlayCircle, section: 'Move to', disabled: bulk.isPending, onSelect: () => { void status('In Progress'); } },
    { key: 'status-review', label: 'Under review', icon: PlayCircle, disabled: bulk.isPending, onSelect: () => { void status('Under Review'); } },
    { key: 'status-completed', label: 'Completed', icon: CheckCircle2, disabled: bulk.isPending, onSelect: () => { void status('Completed'); } },
  ];

  const dialogs = (
    <>
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
    </>
  );
  return { actions, more, busy: bulk.isPending, dialogs };
}
