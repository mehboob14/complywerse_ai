'use client';

// Regulatory Changes: one place for the circulars the organisation works through, with three views: Overview (what needs you), Changes (the register) and Feed (what the regulators published, on its
// own address). This page holds the first two; the strip is the same on the Feed. The Overview is the way in; the Overview's counters, the old links and the Compliance Overview's card land on
// the right view (?tab=changes&work=late ...). Upload circular and Add manually are in the head whichever view is open.
import { useState } from 'react';
import { PenLine, Upload } from 'lucide-react';
import { PageHeader } from '@/components/ui';
import { Button, useTabParam } from '@/components/ui/ds';
import { usePermissions } from '@/hooks/usePermissions';
import { routeFor } from '@/lib/navRegistry';
import CreatePanel, { type CreateMode } from './_CreatePanel';
import { RegulatoryOverview } from './_overview/RegulatoryOverview';
import { RegulatoryShell } from './_parts/shared';
import { ChangesRegister } from './_register/ChangesRegister';

const TABS = ['overview', 'changes'] as const;

export default function RegulatoryChangesPage() {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('governance:regulatory_changes:create');
  const canDelete = hasPermission('governance:regulatory_changes:delete');
  const [tab, setTab] = useTabParam('tab', TABS, { fallback: 'overview' });
  const [create, setCreate] = useState<CreateMode | null>(null);

  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader
        variant="page"
        title={routeFor('/governance/regulatory-changes')?.label ?? 'Regulatory Changes'}
        info="The circulars you are working through, from obligation to closure, and the feed of what the regulators publish."
        actions={canCreate ? (
          <>
            <Button leftIcon={<PenLine aria-hidden />} onClick={() => setCreate('manual')}>Add manually</Button>
            <Button variant="primary" leftIcon={<Upload aria-hidden />} onClick={() => setCreate('circular')}>Upload circular</Button>
          </>
        ) : undefined}
      />
      <RegulatoryShell value={tab} onSwitch={setTab}>
        {tab === 'overview' ? <RegulatoryOverview /> : <ChangesRegister canCreate={canCreate} canDelete={canDelete} onAdd={setCreate} />}
      </RegulatoryShell>
      <CreatePanel open={!!create} mode={create || 'circular'} onMode={setCreate} onClose={() => setCreate(null)} />
    </div>
  );
}
