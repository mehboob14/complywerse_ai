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
        <h1 className="page-title">Compliance</h1>
        <p className="page-description">Policy statement tracking and compliance assessment</p>
      </div>

      <div className="cw-card flex flex-wrap gap-1 p-1 shadow-sm">
        {complianceNavigation.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== '/compliance' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all',
                isActive
                  ? 'bg-[var(--color-base)] text-[var(--color-text-inverse)] shadow-sm'
                  : 'cw-text-muted hover:bg-[var(--color-hover)]'
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
