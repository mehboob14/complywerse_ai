'use client';

// The writes of a task's page, in one place: change one property (PUT with only the fields that changed), move the task to another status (the workflow's own transition), and ask for, give
// or refuse an approval. The requests and bodies are the old page's (update, transition, request-approval, approve, reject); what each says when it is done is a sentence, and a failure is
// said (toast with Retry, or inline in the editor that asked). Every one refreshes the task, the lists that hold it, My Tasks and the reports (TASK_REFRESH). Nothing here decides who may do
// what: the server does (it refuses a step the workflow does not allow, and a Completed or Verified step until the approval is given).
import { useReportedMutation } from '@/components/ui/ds';
import { criticalTasksApi } from '@/lib/api';
import { statusPill } from '@/lib/status';
import { taskStatus } from '@/lib/statuses/tasks';
import { TASK_REFRESH } from '../../_register/taskData';
import type { NextStep } from '../../taskRecord';
import type { TaskPageData } from './taskPageModel';

export interface Change { patch: Record<string, unknown>; /** what to say when it worked: "Priority set to High" */ said: string }

/** Change properties of the task. `inline`: an editor shows a failure itself (the toast says only that it worked); `onDone` and `onFail` are its hooks. */
export function useUpdateTask(taskId: number, opts: { inline?: boolean; onDone?: () => void; onFail?: (error: unknown) => void } = {}) {
  return useReportedMutation<unknown, Change>({
    mutationFn: ({ patch }) => criticalTasksApi.update(taskId, patch),
    success: (_, v) => v.said,
    failure: "Couldn't save the change",
    invalidate: TASK_REFRESH,
    toast: opts.inline ? 'success' : 'always',
    onSuccess: opts.onDone,
    onError: opts.onFail,
  });
}

/** Move the task to another status: the same transition request the workflow has always had. */
export function useMoveTask(taskId: number) {
  return useReportedMutation<unknown, string>({
    mutationFn: (to) => criticalTasksApi.transition(taskId, { new_status: to }),
    success: (_, to) => `Moved to ${statusPill(taskStatus, to).label}`,
    failure: "Couldn't move the task",
    invalidate: TASK_REFRESH,
  });
}

export type Decision = 'request' | 'approve' | 'reject';
export interface DecisionInput { action: Decision; comment: string; /** the status the approval is asked for (the next gate), when it is one */ to?: string }

/** Ask for, give or refuse the approval of a task that needs one. The comment is optional and goes with the request. */
export function useApproval(task: Pick<TaskPageData, 'id' | 'reviewer'>, onDone?: () => void) {
  return useReportedMutation<unknown, DecisionInput>({
    mutationFn: ({ action, comment, to }) => {
      if (action === 'request') return criticalTasksApi.requestApproval(task.id, { comment, ...(to ? { transition_to: to } : {}) });
      if (action === 'approve') return criticalTasksApi.approveTask(task.id, { comment });
      return criticalTasksApi.rejectTask(task.id, { comment });
    },
    success: (_, v) => {
      if (v.action === 'approve') return 'Task approved';
      if (v.action === 'reject') return 'Approval refused';
      return task.reviewer ? { title: 'Approval requested', message: `${task.reviewer.display_name ?? 'The reviewer'} can now approve it.` } : { title: 'Approval requested', message: 'No reviewer is set yet, so nobody can approve it. Choose a reviewer.' };
    },
    failure: "Couldn't record the decision",
    invalidate: TASK_REFRESH,
    onSuccess: onDone,
  });
}

/** The step the head's main button takes: a status step is a transition; Request approval and Approve are the approval requests. */
export function runStep(step: NextStep, actions: { move: (to: string) => void; decide: (input: DecisionInput) => void }): void {
  if (step.id === 'approve') actions.decide({ action: 'approve', comment: '' });
  else if (step.id === 'request_approval') actions.decide({ action: 'request', comment: '', to: step.to });
  else if (step.to) actions.move(step.to);
}
