'use client';

// Control Assurance (/control-library/assurance): are the controls tested, operating effectively and re-tested on time, scored by weighted section over the Catalog's testing work. The Dashboard's
// assurance card links here. The cards are components/dashboard/ControlAssuranceOverviewCards.
import { PageHeader } from '@/components/ui';
import ControlSurfaceTabs from '@/components/dashboard/ControlSurfaceTabs';
import ControlAssuranceOverviewCards from '@/components/dashboard/ControlAssuranceOverviewCards';
import { routeFor } from '@/lib/navRegistry';

export const dynamic = 'force-dynamic';

export default function ControlAssurancePage() {
  return (
    <div className="flex flex-col gap-[16px]">
      <PageHeader variant="page" title={routeFor('/control-library/assurance')?.label ?? 'Control Assurance'} info="Are your controls tested, operating effectively and re-tested on time? Scored by weighted section over the Control Catalog's testing work." />
      <ControlSurfaceTabs active="assurance" />
      <ControlAssuranceOverviewCards />
    </div>
  );
}
