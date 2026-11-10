'use client';

// Third-Party Vendor Risk. The module has no menu of its own inside the page any more: its eight entries are sub-items of the sidebar (railModel.ts SIDEBAR; navAccess.ts is the parent's), and the
// pages an entry groups share a strip of tabs under the page's head. What this layout draws, by who draws the page's head (HEAD of railModel.ts):
//   page    nothing: the page draws its own head and, when its entry has tabs, <VendorTabs /> under it
//   layout  the head (the page's name, the module's facts, Request vendor / Add vendor on Vendors and Intake) and the strip, until the page's group rebuilds it
//   legacy  the strip only, above the page's own older heading
// A vendor's record and the questionnaire builder draw their own header and get nothing. While the sidebar does not list the eight entries yet, one row of them stands above the page so the
// module is never a dead end; it disappears by itself when navAccess lists them.
import { usePathname } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { flattenLeaves, navigation } from '@/components/layout/navAccess';
import { titleFor } from '@/lib/navRegistry';
import VendorActions from './_lib/VendorActions';
import { ModuleRow, VendorTabs } from './_lib/VendorNav';
import { usePortfolioCounts, useRefreshCountsAfterChanges } from './_lib/portfolioApi';
import { headerStats, isDrillDown, shellKey } from './_lib/portfolioModel';
import { WITH_ACTIONS, headOf } from './_lib/railModel';

const SIDEBAR_LISTS_ENTRIES = flattenLeaves(navigation).some((leaf) => leaf.href === '/vendor-risk/intake');

function LayoutHead({ path }: { path: string }) {
  const counts = usePortfolioCounts();
  return (
    <>
      <PageHeader
        variant="page"
        title={titleFor(path) ?? 'Third-Party Vendor Risk'}
        meta={headerStats(counts)}
        actions={WITH_ACTIONS.includes(path) ? <VendorActions /> : undefined}
      />
      <VendorTabs />
    </>
  );
}

export default function VendorRiskLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  useRefreshCountsAfterChanges();
  const drillDown = isDrillDown(pathname);
  const head = headOf(pathname);
  return (
    <div className="flex min-h-full flex-col gap-[16px]">
      {!SIDEBAR_LISTS_ENTRIES && !drillDown && <ModuleRow />}
      {/* Remount only when entering/leaving a vendor-detail route so moving between list pages reuses cached queries instead of flashing loaders. */}
      <div key={shellKey(pathname)} className="flex flex-col gap-[16px]">
        {!drillDown && head === 'layout' && <LayoutHead path={pathname.replace(/\/+$/, '')} />}
        {!drillDown && head === 'legacy' && <VendorTabs />}
        {children}
      </div>
    </div>
  );
}
