'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Building2, ClipboardList, AlertTriangle, Radio, FileQuestion, Shield, Settings } from 'lucide-react';
import { clsx } from 'clsx';

const vendorRiskNavigation = [
  { name: 'Dashboard', href: '/vendor-risk', icon: LayoutDashboard, exact: true },
  { name: 'Vendors', href: '/vendor-risk/vendors', icon: Building2 },
  { name: 'Assessments', href: '/vendor-risk/assessments', icon: ClipboardList },
  { name: 'Findings', href: '/vendor-risk/findings', icon: AlertTriangle },
  { name: 'Monitoring', href: '/vendor-risk/monitoring', icon: Radio },
  { name: 'Questionnaires', href: '/vendor-risk/questionnaires', icon: FileQuestion },
  { name: 'Risk 360°', href: '/vendor-risk/risk-360', icon: Shield },
  { name: 'Settings', href: '/vendor-risk/settings', icon: Settings },
];

export default function VendorRiskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="-m-4 lg:-m-5 text-slate-900">
      <div className="border-b border-gray-200 px-3 sm:px-6 pt-3 overflow-x-auto">
        <div className="flex items-center gap-0 min-w-max">
          {vendorRiskNavigation.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.name}
                href={item.href}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap',
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </div>
      </div>

      {/* TPRM-013: key by pathname so tab navigation FROM a vendor-detail route
          always remounts the target screen (App Router otherwise reused the stale
          detail subtree). */}
      <div key={pathname} className="px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-6">{children}</div>
    </div>
  );
}
