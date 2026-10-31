'use client';

// Projects (IS Projects): the portfolio at a glance, the register of every project, and the projects that are mine, as three tabs of one page. On the design-system
// kit: PageHeader variant="page" with the registry's name for the page, the kit's Tabs with the open tab in the address (?tab=projects, ?tab=my-projects; the plain
// address is Overview, as it always was), and a drawer for a new project. Each tab is a piece of its own (_PortfolioOverview, _ProjectsList, _MyProjects) that loads
// and fails on its own; /is-projects/dashboard and /is-projects/my-projects show the first and the last alone. What a person may do is as before: "New project" needs
// is_projects:projects:create (client side; the server asks only for the projects view), and nothing here adds a gate.
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { usePermissions } from '@/hooks/usePermissions';
import { PageHeader } from '@/components/ui';
import { Button, TabPanel, Tabs, useTabParam } from '@/components/ui/ds';
import { routeFor } from '@/lib/navRegistry';
import { LIST_TABS, LIST_TAB_KEYS, type ListTab } from './_model';
import { MyProjects } from './_MyProjects';
import { PortfolioOverview } from './_PortfolioOverview';
import { ProjectFormDrawer } from './_ProjectForm';
import { ProjectsList } from './_ProjectsList';

export default function ISProjectsPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('is_projects:projects:create');
  const [tab, setTab] = useTabParam('tab', LIST_TAB_KEYS, { fallback: 'overview' });
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={routeFor('/is-projects')?.label ?? 'Projects'}
        info="Track and manage information security projects across the organization"
        actions={canCreate ? <Button variant="primary" leftIcon={<Plus aria-hidden />} onClick={() => setCreating(true)}>New project</Button> : undefined}
      />

      <Tabs tabs={LIST_TABS.map((t) => ({ key: t.key, label: t.label }))} value={tab} onChange={(key) => setTab(key as ListTab)} ariaLabel="Projects views">
        <TabPanel tabKey="overview" lazy className="pt-[16px]"><PortfolioOverview /></TabPanel>
        <TabPanel tabKey="projects" lazy className="pt-[16px]"><ProjectsList canCreate={canCreate} onCreate={() => setCreating(true)} /></TabPanel>
        <TabPanel tabKey="my-projects" lazy className="pt-[16px]"><MyProjects /></TabPanel>
      </Tabs>

      {creating && <ProjectFormDrawer onClose={() => setCreating(false)} />}
    </div>
  );
}
