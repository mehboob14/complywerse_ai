'use client';

// /tasks/my-tasks: the My Tasks view (the page's own head, with a way back to Task Management). The same view is the "My Tasks" tab of /tasks; the rules and the words are in _MyTasksView.
import { PageHeader } from '@/components/ui';
import { routeFor } from '@/lib/navRegistry';
import { MyTasksView } from '../_MyTasksView';

const TITLE = routeFor('/tasks/my-tasks')?.label ?? 'My tasks';

export default function MyTasksPage() {
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader variant="page" title={TITLE} back={{ href: '/tasks', label: 'Back to Task Management' }} info="The tasks you own, are assigned to or review." />
      <MyTasksView />
    </div>
  );
}
