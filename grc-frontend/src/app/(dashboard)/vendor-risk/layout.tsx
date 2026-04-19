'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, ClipboardList, FileQuestion } from 'lucide-react';
import { clsx } from 'clsx';

const vendorRiskNavigation = [
  { name: 'Vendor Risk', href: '/vendor-risk', icon: Building2, exact: true },
  { name: 'Assessments', href: '/vendor-risk/assessments', icon: ClipboardList },
  { name: 'Questionnaires', href: '/vendor-risk/questionnaires', icon: FileQuestion },
];

export default function VendorRiskLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="risk-workspace min-h-full space-y-4 px-1 pb-2">
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-[3px]">
        {vendorRiskNavigation.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                isActive
                  ? 'bg-primary-600 text-white shadow-sm'
                  : 'bg-white text-slate-800 hover:bg-slate-100'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.name}
            </Link>
          );
        })}
      </div>

      <div>{children}</div>
    </div>
  );
}
