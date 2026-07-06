'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, Building2, ClipboardList, AlertTriangle, Radio, FileQuestion, Shield, Settings } from 'lucide-react';
import { clsx } from 'clsx';

// Primary working set — the tabs a TPRM analyst lives in day to day.
const vendorRiskNavigation = [
  { name: 'Dashboard', href: '/vendor-risk', icon: LayoutDashboard, exact: true },
  { name: 'Vendors', href: '/vendor-risk/vendors', icon: Building2 },
  { name: 'Assessments', href: '/vendor-risk/assessments', icon: ClipboardList },
  { name: 'Findings', href: '/vendor-risk/findings', icon: AlertTriangle },
  { name: 'Monitoring', href: '/vendor-risk/monitoring', icon: Radio },
  { name: 'Questionnaires', href: '/vendor-risk/questionnaires', icon: FileQuestion },
  { name: 'Risk 360°', href: '/vendor-risk/risk-360', icon: Shield },
];

// Settings is demoted out of the primary set — see the trailing gear.
const settingsNav = { name: 'Settings', href: '/vendor-risk/settings', icon: Settings };

export default function VendorRiskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const tabRefs = useRef<Array<HTMLAnchorElement | null>>([]);

  const isTabActive = (item: { href: string; exact?: boolean }) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(item.href + '/');

  const activeIndex = vendorRiskNavigation.findIndex(isTabActive);

  // Roving-tabindex keyboard support for the WAI-ARIA tabs pattern.
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    const last = vendorRiskNavigation.length - 1;
    let next = index;
    if (e.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (e.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = last;
    else return;
    e.preventDefault();
    const el = tabRefs.current[next];
    el?.focus();
    router.push(vendorRiskNavigation[next].href);
  };

  const settingsActive = pathname === settingsNav.href || pathname.startsWith(settingsNav.href + '/');

  return (
    <div className="-m-4 lg:-m-5 text-slate-900">
      <div className="border-b border-slate-200 px-3 sm:px-6 pt-3 overflow-x-auto">
        <div className="flex items-center gap-2 min-w-max">
          <div role="tablist" aria-label="Vendor risk sections" className="flex items-center gap-0">
            {vendorRiskNavigation.map((item, index) => {
              const isActive = isTabActive(item);
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  ref={(el) => { tabRefs.current[index] = el; }}
                  role="tab"
                  aria-selected={isActive}
                  aria-current={isActive ? 'page' : undefined}
                  // Roving tabindex: only the active tab (or the first when none is
                  // active) is in the tab order; the rest are reached with arrows.
                  tabIndex={isActive || (activeIndex === -1 && index === 0) ? 0 : -1}
                  onKeyDown={(e) => onTabKeyDown(e, index)}
                  className={clsx(
                    'inline-flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 rounded-t',
                    isActive
                      ? 'border-primary-600 text-primary-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                  )}
                >
                  <item.icon className="h-4 w-4" strokeWidth={1.75} />
                  {item.name}
                </Link>
              );
            })}
          </div>

          {/* Settings demoted to a trailing gear, separated from the working set. */}
          <div className="ml-auto flex items-center border-l border-slate-200 pl-2">
            <Link
              href={settingsNav.href}
              aria-label="Settings"
              aria-current={settingsActive ? 'page' : undefined}
              title="Settings"
              className={clsx(
                'inline-flex items-center justify-center rounded-lg p-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1',
                settingsActive
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700'
              )}
            >
              <settingsNav.icon className="h-4 w-4" strokeWidth={1.75} />
            </Link>
          </div>
        </div>
      </div>

      {/* TPRM-013: key by pathname so tab navigation FROM a vendor-detail route
          always remounts the target screen (App Router otherwise reused the stale
          detail subtree). */}
      <div key={pathname} className="px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-6">{children}</div>
    </div>
  );
}
