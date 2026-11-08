'use client';

// Task Management: My work (the front door), All tasks (the register), Reports and the module's Settings as the four tabs of one page. ONE page head ("Task Management", with New task for the
// people who may create tasks); the open tab is the address (?tab=all, reports, settings; My work has the plain address) so a link, a reload and Back land where the person was. Every old
// name still opens the tab that holds its content (taskTabs.ts: board -> All tasks, my-tasks and mine -> My work, sla -> Settings), and an old board link with no ?tab= (it carries the
// register's own parameters: ?status= ?priority= ?mine=1 ?view=kanban ...) opens All tasks with those filters, as it did when the board was the first tab. The old pages /tasks/my-tasks,
// /tasks/reports and /tasks/sla are forwards to the tabs. Each tab's view is drawn only while its tab is open, so it asks the server again every time it is opened. My work is _work/MyWork,
// All tasks is _Board (the register), Reports _ReportsView, Settings _SettingsTab; the create form is _CreateTask. Built on the design-system kit (components/ui/ds).
import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, TabPanel, Tabs, useTabParam } from '@/components/ui/ds';
import { usePermissions } from '@/hooks/usePermissions';
import { routeFor } from '@/lib/navRegistry';
import { Board } from './_Board';
import { CreateTaskDrawer } from './_CreateTask';
import { ReportsView } from './_ReportsView';
import { SettingsTab } from './_SettingsTab';
import { MyWork } from './_work/MyWork';
import { TAB_ALIASES, TAB_LABELS, TASK_TABS, defaultTab } from './taskTabs';

const TITLE = routeFor('/tasks')?.label ?? 'Task Management';

export default function TaskManagementPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('critical_tasks:tasks:create');
  const search = useSearchParams()?.toString() ?? '';
  const [tab, setTab] = useTabParam('tab', TASK_TABS, { fallback: defaultTab(search), aliases: TAB_ALIASES });
  const [creating, setCreating] = useState(false);
  const openCreate = () => setCreating(true);

  return (
    <div className="flex flex-col gap-[12px]">
      <PageHeader
        variant="page"
        title={TITLE}
        info="Your work first: the tasks you are on or review, and what waits for your decision. All tasks has every task you may see, including the ones that document reviews, committees and regulatory changes raise."
        actions={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={openCreate}>New task</Button> : undefined}
      />
      <Tabs ariaLabel="Task Management sections" value={tab} onChange={setTab} tabs={TASK_TABS.map((key) => ({ key, label: TAB_LABELS[key] }))}>
        <TabPanel tabKey="work" className="pt-[12px]">{tab === 'work' && <MyWork />}</TabPanel>
        <TabPanel tabKey="all" className="pt-[12px]">{tab === 'all' && <Board canCreate={canCreate} onNew={openCreate} />}</TabPanel>
        <TabPanel tabKey="reports" className="pt-[12px]">{tab === 'reports' && <ReportsView />}</TabPanel>
        <TabPanel tabKey="settings" className="pt-[12px]">{tab === 'settings' && <SettingsTab canEdit={canCreate} />}</TabPanel>
      </Tabs>
      {creating && <CreateTaskDrawer onClose={() => setCreating(false)} />}
    </div>
  );
}
