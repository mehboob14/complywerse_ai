'use client';

// Task Management: the Task Board, My Tasks, the module's Settings and the Reports as the four tabs of one page. ONE page head ("Task Management", with New task for the people who may
// create tasks); the open tab is the address (?tab=my-tasks, sla, reports; the board has the plain address) so a link, a reload and Back land where the person was, and the pages that
// used to be embedded here still open on their own (/tasks/my-tasks, /tasks/reports: the same views with their own head). Each tab's view is drawn only while its tab is open, so it
// asks the server again every time it is opened, as it always did. The board is _Board, the create form _CreateTask, the other tabs _MyTasksView, ModuleSettingsPanel (the shared
// module settings, used as it is) and _ReportsView. It is built on the design-system kit (components/ui/ds); the rules of the pages are tasksModel.ts.
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, TabPanel, Tabs, useTabParam } from '@/components/ui/ds';
import ModuleSettingsPanel from '@/components/settings/ModuleSettingsPanel';
import { usePermissions } from '@/hooks/usePermissions';
import { routeFor } from '@/lib/navRegistry';
import { Board } from './_Board';
import { CreateTaskDrawer } from './_CreateTask';
import { MyTasksView } from './_MyTasksView';
import { ReportsView } from './_ReportsView';
import { TAB_ALIASES, TAB_LABELS, TASK_TABS } from './tasksModel';

const TITLE = routeFor('/tasks')?.label ?? 'Task Management';

export default function TaskManagementPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('critical_tasks:tasks:create');
  const [tab, setTab] = useTabParam('tab', TASK_TABS, { fallback: 'board', aliases: TAB_ALIASES });
  const [creating, setCreating] = useState(false);
  const openCreate = () => setCreating(true);

  return (
    <div className="flex flex-col gap-[12px]">
      <PageHeader
        variant="page"
        title={TITLE}
        info="Every task you may see: the ones you create, and the ones that document reviews, committees and regulatory changes raise."
        actions={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={openCreate}>New task</Button> : undefined}
      />
      <Tabs ariaLabel="Task Management sections" value={tab} onChange={setTab} tabs={TASK_TABS.map((key) => ({ key, label: TAB_LABELS[key] }))}>
        <TabPanel tabKey="board" className="pt-[12px]">{tab === 'board' && <Board canCreate={canCreate} onNew={openCreate} />}</TabPanel>
        <TabPanel tabKey="my-tasks" className="pt-[12px]">{tab === 'my-tasks' && <MyTasksView />}</TabPanel>
        <TabPanel tabKey="sla" className="pt-[12px]">{tab === 'sla' && <ModuleSettingsPanel moduleKey="tasks" />}</TabPanel>
        <TabPanel tabKey="reports" className="pt-[12px]">{tab === 'reports' && <ReportsView />}</TabPanel>
      </Tabs>
      {creating && <CreateTaskDrawer onClose={() => setCreating(false)} />}
    </div>
  );
}
