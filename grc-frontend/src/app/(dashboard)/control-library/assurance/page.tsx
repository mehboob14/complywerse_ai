'use client';

export const dynamic = 'force-dynamic';

import ControlSurfaceTabs from '@/components/dashboard/ControlSurfaceTabs';
import ControlAssuranceOverviewCards from '@/components/dashboard/ControlAssuranceOverviewCards';
import LinkCoverageCard from '@/components/dashboard/LinkCoverageCard';

export default function ControlAssurancePage() {
  return (
    <div className="space-y-4 p-1">
      <ControlSurfaceTabs active="assurance" />
      <div>
        <h1 className="text-xl font-bold text-slate-900">Control Testing &amp; Assurance</h1>
        <p className="text-[13px] text-slate-500">
          Are your controls tested, operating effectively, and re-tested on time — scored by weighted section over the CT&amp;A workbench.
        </p>
      </div>
      <ControlAssuranceOverviewCards />
      {/* CTEM Phase 2.5 — automated evidence coverage + bulk link suggestions */}
      <LinkCoverageCard />
    </div>
  );
}
