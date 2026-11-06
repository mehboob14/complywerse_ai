'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import ModuleHead from './_lib/ModuleHead';
import { useRefreshCountsAfterChanges } from './_lib/portfolioApi';
import { isDrillDown, shellKey } from './_lib/portfolioModel';
import { entryOf, tabActive } from './_lib/railModel';

// The module's eight entries (its "rail") are in the application shell now: the Work and context panel lists them with the numbers that wait at Intake and Findings
// (components/shell/panelModel.ts reads _lib/railModel.ts), so this layout draws no rail of its own, in the page or in a scrolling row. What stays here is the module's header and,
// for an entry that groups pages, the strip of tabs under it: the page's own way between its sibling pages.
export default function VendorRiskLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  useRefreshCountsAfterChanges();
  const on = entryOf(pathname);
  const drillDown = isDrillDown(pathname);

  return (
    <div className="-m-4 min-h-full text-slate-900 lg:-m-5">
      <div className="min-w-0">
        {/* Remount only when entering/leaving a vendor-detail route so moving
            between list pages reuses cached queries instead of flashing loaders. */}
        <div key={shellKey(pathname)} className="space-y-4 px-4 py-4 sm:space-y-6 sm:px-6 sm:py-5">
          {/* a vendor's record and the questionnaire builder draw their own header */}
          {!drillDown && <ModuleHead />}
          {/* the pages an entry groups: one strip of tabs under the header */}
          {!drillDown && on?.tabs && (
            <nav className="-mt-2 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200 sm:-mt-3" aria-label={`${on.name} pages`}>
              {on.tabs.map((t) => {
                const here = tabActive(pathname, t.href);
                return (
                  <Link key={t.href} href={t.href} aria-current={here ? 'page' : undefined}
                    className={clsx('-mb-px shrink-0 whitespace-nowrap border-b-2 px-3.5 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
                      here ? 'border-[#0f766e] font-medium text-[#0f766e]' : 'border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900')}>
                    {t.name}
                  </Link>
                );
              })}
            </nav>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
