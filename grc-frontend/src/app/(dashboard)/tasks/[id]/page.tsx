'use client';

// /tasks/<id>: one task. This file reads it (GET critical-tasks/<id>, key ['critical-task', id], as ever) and says what the read did: a skeleton while it loads, and when it fails WHAT happened in the
// server's words (a task that was deleted or is not one of the person's, no right to Task Management, the server unreachable) with Retry where trying again can help. The page itself is
// _workspace/TaskWorkspace: the task as a timeline-first workspace with its properties edited in place. ?tab=details|subtasks|comments|evidence|history still opens the page and scrolls to the
// section that holds what the tab held. Built on the design-system kit (components/ui/ds).
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { criticalTasksApi } from '@/lib/api';
import { PageHeader } from '@/components/ui';
import { Button, ErrorState, Skeleton, SkeletonLines } from '@/components/ui/ds';
import { canRetry, errorMessage, statusOf } from '@/components/ui/ds/reportOutcome';
import { routeFor } from '@/lib/navRegistry';
import { retryRead } from '../_queries';
import { TaskWorkspace } from './_workspace/TaskWorkspace';
import type { TaskPageData } from './_workspace/taskPageModel';

const TITLE = routeFor('/tasks/1')?.label ?? 'Task';

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = Number(params?.id);
  const q = useQuery<TaskPageData>({
    queryKey: ['critical-task', taskId],
    queryFn: async () => (await criticalTasksApi.get(taskId)).data,
    retry: retryRead,
  });

  if (q.isPending) {
    return (
      <div role="status" aria-label="Loading the task" className="flex flex-col gap-[16px]">
        <Skeleton className="h-[28px] w-[60%]" />
        <div className="grid grid-cols-1 gap-[16px] lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex flex-col gap-[16px]"><Skeleton className="h-[120px] w-full" /><Skeleton className="h-[160px] w-full" /><SkeletonLines lines={5} /></div>
          <Skeleton className="h-[320px] w-full" />
        </div>
      </div>
    );
  }
  if (q.isError || !q.data) {
    const missing = statusOf(q.error) === 404;
    return (
      <div className="flex flex-col gap-[16px]">
        <PageHeader variant="page" title={TITLE} back={{ href: '/tasks', label: 'Back to Task Management' }} />
        <ErrorState
          title={missing ? 'Task not found' : "Couldn't open this task"}
          message={missing ? 'It was deleted, or it is not one of the tasks you may see.' : errorMessage(q.error)}
          onRetry={canRetry(q.error) ? () => { void q.refetch(); } : undefined}
        />
        <div><Button href="/tasks">Back to Task Management</Button></div>
      </div>
    );
  }
  return <TaskWorkspace task={q.data} />;
}
