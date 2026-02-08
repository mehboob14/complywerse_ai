'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  ClipboardCheck,
} from 'lucide-react';
import { clsx } from 'clsx';

const complianceNavigation = [
  { name: 'Overview', href: '/compliance', icon: LayoutDashboard },
  { name: 'Policy Statements', href: '/compliance/statements', icon: FileText },
  { name: 'Assessments', href: '/compliance/assessments', icon: ClipboardCheck },
];

export default function ComplianceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-black">Compliance</h1>
        <p className="text-slate-600">Policy statement tracking and compliance assessment</p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl bg-white p-1">
        {complianceNavigation.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== '/compliance' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
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
