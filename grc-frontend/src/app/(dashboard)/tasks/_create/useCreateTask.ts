'use client';

// The two ways New task makes a task: from the form (POST critical-tasks, the body createPayload built) and from a template (POST critical-tasks/create-from-template, the body templateBody
// built). Both say "Task created" with the title and an "Open task" button; a refused or failed create is NOT toasted: it stays inside the drawer, in the server's words, with Retry when asking
// again can help and everything typed kept. Both refresh the lists that hold a task, My Tasks and the reports.
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNotify, useReportedMutation } from '@/components/ui/ds';
import { canRetry, errorMessage } from '@/components/ui/ds/reportOutcome';
import { criticalTasksApi } from '@/lib/api';
import { truncate } from '@/lib/format';

type Body = Record<string, unknown>;
export interface CreateProblem { message: string; retry: boolean }

const REFRESH = [['critical-tasks'], ['my-tasks'], ['task-reports']] as const;

export function useCreateTask(onClose: () => void) {
  const notify = useNotify();
  const router = useRouter();
  const [problem, setProblem] = useState<CreateProblem | null>(null);
  const last = useRef<{ from: 'form' | 'template'; body: Body } | null>(null);

  const made = (res: { data?: { id?: number; title?: string } }, fallbackTitle: string) => {
    const id = res.data?.id;
    notify.success(truncate(res.data?.title ?? fallbackTitle, 80).text, {
      title: 'Task created',
      action: id ? { label: 'Open task', onClick: () => router.push(`/tasks/${id}`) } : undefined,
    });
    onClose();
  };
  const failed = (error: unknown) => setProblem({ message: errorMessage(error, 'The task was not created. Nothing you typed was lost.'), retry: canRetry(error) });

  const fromForm = useReportedMutation({
    mutationFn: (body: Body) => criticalTasksApi.create(body),
    success: 'Task created',
    failure: "Couldn't create the task",
    invalidate: REFRESH,
    toast: 'none',                                                      // a failure is shown inside the drawer, once, with the form still filled
    onSuccess: (res, body) => made(res as { data?: { id?: number; title?: string } }, String(body.title)),
    onError: failed,
  });
  const fromTemplate = useReportedMutation({
    mutationFn: (body: Body) => criticalTasksApi.createFromTemplate(body),
    success: 'Task created',
    failure: "Couldn't create the task",
    invalidate: REFRESH,
    toast: 'none',
    onSuccess: (res, body) => made(res as { data?: { id?: number; title?: string } }, String(body.title)),
    onError: failed,
  });

  return {
    problem,
    pending: fromForm.isPending || fromTemplate.isPending,
    /** make the task from the form's payload */
    create: (body: Body) => { setProblem(null); last.current = { from: 'form', body }; fromForm.mutate(body); },
    /** make the task from a template's body */
    createFromTemplate: (body: Body) => { setProblem(null); last.current = { from: 'template', body }; fromTemplate.mutate(body); },
    /** repeat the last try */
    retry: () => {
      const again = last.current;
      if (!again) return;
      setProblem(null);
      (again.from === 'form' ? fromForm : fromTemplate).mutate(again.body);
    },
    clear: () => setProblem(null),
  };
}
