'use client';

// One step of one task from My work: Start, Send for review, Complete, Verify, Request approval, Approve. The same requests, bodies and words as the register's (_register/TaskRegister.tsx:
// transition, request-approval, approve), reported when the server has answered (a failure stays on screen with a Retry); the row changes at once in the person's work and in the register's
// list when it is loaded, and nothing is loaded again for one step (a recurring task that was completed makes its next occurrence, so that one asks again).
import { useQueryClient } from '@tanstack/react-query';
import { useReportedMutation } from '@/components/ui/ds';
import { criticalTasksApi } from '@/lib/api';
import { truncate } from '@/lib/format';
import { statusPill } from '@/lib/status';
import { taskStatus } from '@/lib/statuses/tasks';
import { TASK_REFRESH, patchTask, stepPatch } from '../_register/taskData';
import type { NextStep, RegisterTask } from '../taskRecord';
import { patchWork } from './workData';

type Change = { task: RegisterTask; kind: 'transition'; to: string } | { task: RegisterTask; kind: 'request_approval'; to?: string } | { task: RegisterTask; kind: 'approve' };

export function useTaskStep() {
  const qc = useQueryClient();
  const mutation = useReportedMutation({
    mutationFn: async (v: Change) => {
      if (v.kind === 'transition') return (await criticalTasksApi.transition(v.task.id, { new_status: v.to })).data as Record<string, unknown>;
      if (v.kind === 'request_approval') { await criticalTasksApi.requestApproval(v.task.id, { comment: '', ...(v.to ? { transition_to: v.to } : {}) }); return { approval_status: 'Pending' } as Record<string, unknown>; }
      await criticalTasksApi.approveTask(v.task.id, { comment: '' });
      return { approval_status: 'Approved' } as Record<string, unknown>;
    },
    success: (_, v) => {
      const name = truncate(v.task.title, 70).text;
      if (v.kind === 'transition') return { title: `Moved to ${statusPill(taskStatus, v.to).label}`, message: name };
      if (v.kind === 'approve') return { title: 'Task approved', message: name };
      return { title: 'Approval requested', message: v.task.reviewer ? `${v.task.reviewer.display_name ?? 'The reviewer'} can now approve “${name}”.` : 'No reviewer is set yet, so nobody can approve it. Set a reviewer on the task.' };
    },
    failure: "Couldn't update the task",
    invalidate: TASK_REFRESH.filter((k) => k[0] !== 'critical-tasks'),
    onSuccess: (answer, v) => {
      const patch = stepPatch(answer);
      patchTask(qc, v.task.id, patch);
      patchWork(qc, v.task.id, patch);
      const next = v.kind === 'transition' && v.to === 'Completed' && !!v.task.recurrence_pattern;
      void qc.invalidateQueries({ queryKey: ['critical-tasks'], refetchType: next ? 'active' : 'none' });
    },
  });
  /** Press the step of a row: a status step is a transition, the others are the approval requests. */
  const run = (task: RegisterTask, step: NextStep) => {
    if (step.id === 'approve') mutation.mutate({ task, kind: 'approve' });
    else if (step.id === 'request_approval') mutation.mutate({ task, kind: 'request_approval', to: step.to });
    else if (step.to) mutation.mutate({ task, kind: 'transition', to: step.to });
  };
  /** The task whose step is being saved (its button waits). */
  const busyId = mutation.isPending ? mutation.variables?.task.id ?? null : null;
  return { run, busyId };
}
