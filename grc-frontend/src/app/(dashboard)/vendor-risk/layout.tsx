'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle, Building2, FileQuestion, Inbox, LayoutDashboard, LineChart, Radio, Settings, type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import ModuleHead from './_lib/ModuleHead';
import { usePortfolioCounts, useRefreshCountsAfterChanges } from './_lib/portfolioApi';
import { badgeText, isDrillDown, shellKey } from './_lib/portfolioModel';
import { RAIL, entryOf, tabActive, type RailEntry } from './_lib/railModel';

const ICON: Record<string, LucideIcon> = {
  overview: LayoutDashboard, vendors: Building2, intake: Inbox, findings: AlertTriangle, questionnaires: FileQuestion,
  monitoring: Radio, insights: LineChart, setup: Settings,
};

export default function VendorRiskLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const counts = usePortfolioCounts();
  useRefreshCountsAfterChanges();
  const on = entryOf(pathname);
  const drillDown = isDrillDown(pathname);

  const link = (item: RailEntry, compact = false) => {
    const here = on?.key === item.key;
    const Icon = ICON[item.key];
    const n = badgeText(item.count ? counts?.[item.count] : 0);
    return (
      <Link key={item.key} href={item.href} aria-current={here ? 'page' : undefined}
        className={clsx('relative flex items-center gap-2.5 rounded-lg text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
          compact ? 'shrink-0 whitespace-nowrap px-3 py-1.5' : 'px-2.5 py-1.5',
          here ? 'bg-primary-50 font-medium text-primary-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')}>
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        {item.name}
        {n && (
          // explicit colours: the platform CSS repaints slate and primary utilities
          <span className={clsx('ml-auto rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-[18px]', here ? 'bg-[#0f766e] text-[#fff]' : 'bg-[#e1e6eb] text-[#586472]')}>
            {n}<span className="sr-only"> {item.waiting}</span>
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="-m-4 flex min-h-full text-slate-900 lg:-m-5">
      <aside className="sticky top-0 hidden h-[calc(100vh-4rem)] w-56 shrink-0 flex-col overflow-y-auto border-r border-slate-200 bg-white px-3 py-4 lg:flex"
        aria-label="Third-party risk">
        <p className="flex items-center gap-2 px-2.5 text-sm font-semibold text-slate-900">
          <Building2 className="h-4 w-4 text-primary-600" /> Third-party risk
        </p>
        <nav className="mt-3 flex-1 space-y-0.5">{RAIL.map((i) => link(i))}</nav>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Narrow screens: the same links in one scrolling row. */}
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 py-2 lg:hidden" aria-label="Third-party risk">
          {RAIL.map((i) => link(i, true))}
        </nav>
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
