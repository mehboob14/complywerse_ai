'use client';

// /tasks/reports: the Task Reports view (the page's own head, with a way back to Task Management). The same view is the "Reports" tab of /tasks; the numbers and the words are in _ReportsView.
import { PageHeader } from '@/components/ui';
import { routeFor } from '@/lib/navRegistry';
import { ReportsView } from '../_ReportsView';

const TITLE = routeFor('/tasks/reports')?.label ?? 'Task reports';

export default function TaskReportsPage() {
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader variant="page" title={TITLE} back={{ href: '/tasks', label: 'Back to Task Management' }} info="Analytics for the tasks you may see: status, priority, SLA, workload and the trend over the last twelve months." />
      <ReportsView />
    </div>
  );
}
