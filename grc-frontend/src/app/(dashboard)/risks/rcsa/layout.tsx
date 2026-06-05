'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  LayoutDashboard,
  Megaphone,
  ClipboardList,
  FileText,
  AlertTriangle,
  CheckSquare,
  Sheet,
} from 'lucide-react';

const NAV_ITEMS = [
  { label: 'Dashboard',         href: '/risks/rcsa',                  icon: LayoutDashboard, exact: true },
  { label: 'Campaigns',         href: '/risks/rcsa/campaigns',        icon: Megaphone },
  { label: 'Assessments',       href: '/risks/rcsa/assessments',      icon: ClipboardList },
  { label: 'Templates',         href: '/risks/rcsa/templates',        icon: FileText },
  { label: 'Custom Templates',  href: '/risks/rcsa/custom-templates', icon: Sheet },
  { label: 'Findings',          href: '/risks/rcsa/findings',         icon: AlertTriangle },
  { label: 'Approvals',         href: '/risks/rcsa/approvals',        icon: CheckSquare },
];

export default function RCSALayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';

  function isActive(item: typeof NAV_ITEMS[0]) {
    if (item.exact) return pathname === item.href;
    return pathname.startsWith(item.href);
  }

  return (
    <div className="space-y-4">
      {/* Sub-navigation */}
      <nav className="flex items-center gap-1 border-b border-slate-200 pb-0 overflow-x-auto">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                active
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div>{children}</div>
    </div>
  );
}
