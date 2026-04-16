'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  Calendar,
  CheckSquare,
  Link2,
  Users,
  AlertTriangle,
} from 'lucide-react';
import { clsx } from 'clsx';

const governanceNavigation = [
  { name: 'Overview', href: '/governance', icon: LayoutDashboard },
  { name: 'Documents', href: '/governance/documents', icon: FileText },
  { name: 'Committees', href: '/governance/committees', icon: Users },
  { name: 'Mappings', href: '/governance/mappings', icon: Link2 },
  { name: 'Approvals', href: '/governance/approvals', icon: CheckSquare },
  { name: 'Exceptions', href: '/governance/exceptions', icon: AlertTriangle },
  { name: 'Reviews', href: '/governance/reviews', icon: Calendar },
];

export default function GovernanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="governance-light min-h-full space-y-3 px-0.5 pb-1">
      <div className="gov-header-row">
        <div className="space-y-0.5">
          <h1 className="text-[15px] font-semibold text-[var(--color-text)]">Governance</h1>
          <p className="helper-text">Policy and document lifecycle management</p>
        </div>
      </div>

      <div className="filters-row rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-[3px]">
        {governanceNavigation.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== '/governance' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'gov-tab flex items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                isActive
                  ? 'gov-tab-active bg-[var(--color-subtle)] text-[var(--color-text)] shadow-sm'
                  : 'text-[var(--color-muted)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-text)]'
              )}
            >
              <item.icon size={16} strokeWidth={1.5} />
              {item.name}
            </Link>
          );
        })}
      </div>

      <div>{children}</div>
    </div>
  );
}
