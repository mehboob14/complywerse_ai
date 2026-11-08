'use client';

// The Performance Overview (the sidebar leaf `dashboard:overview:*`, and where a person lands after login): the platform's posture in one page. Everything it draws is in
// ./_overview: PerfOverview (the page: head, the band of what needs attention, where to act first, Overall readiness, one row per area; rules in perfModel.ts and
// lib/perf/moduleFeeds.ts, both tested) and CyberKpis (the Cyber Security KPI strip, kpiModel.ts). Audit: features/ux-revamp-reports/G12_performance_overview_audit.md, plan G13_perf-page_plan.md.
// The old tabbed workspace behind SHOW_LEGACY_TABS (about 10,100 lines nothing reached) was deleted with the owner's decision (G12 Q1).
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import apiClient from '@/lib/api';
import { flattenLeaves, navAccessFromMe, navigation, visibleNav } from '@/components/layout/navAccess';
import PerfOverview from './_overview/PerfOverview';
import { CyberKpis } from './_overview/CyberKpis';

// Where a person lands after login is this page: someone whose role does not open it (no `dashboard:overview:*`) lands on their own queue instead (G12 Q5). Their rights are the ones the menu is built from.
function useLanding() {
  const router = useRouter();
  useEffect(() => {
    let live = true;
    apiClient.get('/auth/me').then((res) => {
      if (!live) return;
      const leaves = flattenLeaves(visibleNav(navigation, navAccessFromMe(res.data)));
      if (!leaves.some((leaf) => leaf.href === '/dashboard')) router.replace('/needs-my-action');
    }, () => undefined);
    return () => { live = false; };
  }, [router]);
}

export default function MainDashboard() {
  useLanding();
  return (
    <div className="flex flex-col gap-[16px]">
      <PerfOverview />
      <CyberKpis />
    </div>
  );
}
