'use client';

// /tasks/<id>: one task. This file reads it (GET critical-tasks/<id>, key ['critical-task', id], as ever) and says what the read did: a skeleton while it loads, and when it fails WHAT happened in the
// server's words (a task that was deleted or is not one of the person's, no right to Task Management, the server unreachable) with Retry where trying again can help: it used to say "Task not found"
// for every failure. The page itself is _TaskView. It is built on the design-system kit (components/ui/ds).
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { criticalTasksApi } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, Skeleton, SkeletonLines } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { retryRead } from '../_queries';
import type { TaskDetail } from '../tasksModel';
import { TaskView } from './_TaskView';

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = Number(params?.id);
  const q = useQuery<TaskDetail>({
    queryKey: ['critical-task', taskId],
    queryFn: async () => (await criticalTasksApi.get(taskId)).data,
    retry: retryRead,
  });

  if (q.isPending) {
    return (
      <div role="status" aria-label="Loading the task" className="flex flex-col gap-[16px]">
        <Skeleton className="h-[28px] w-[60%]" />
        <div className="grid grid-cols-2 gap-[12px] lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[72px] w-full" />)}</div>
        <SkeletonLines lines={5} />
      </div>
    );
  }
  if (q.isError || !q.data) {
    const missing = statusOf(q.error) === 404;
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title={missing ? 'Task not found' : 'Task'} back={{ href: '/tasks', label: 'Back to Task Management' }} />
        <ErrorState
          title={missing ? 'This task is not available' : "Couldn't open this task"}
          message={missing ? 'It was deleted, or it is not one of the tasks you may see.' : errorMessage(q.error)}
          onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined}
        />
        <div><Button href="/tasks">Back to Task Management</Button></div>
      </div>
    );
  }
  return <TaskView task={q.data} />;
}
