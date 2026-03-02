'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileText,
  GitPullRequest,
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
  { name: 'Workflows', href: '/governance/workflows', icon: GitPullRequest },
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
    <div className="governance-light space-y-6">
      <div className="gov-header-row">
        <div>
          <h1 className="text-[18px] font-semibold text-[var(--color-text)]">Governance</h1>
          <p className="helper-text">Policy and document lifecycle management</p>
        </div>
        <button className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 text-[13px] font-medium text-[var(--color-text)]">
          More Filters
        </button>
      </div>

      <div className="filters-row rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1">
        {governanceNavigation.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== '/governance' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'gov-tab flex items-center gap-2 rounded-[var(--radius-md)] px-4 py-2.5 text-[13px] transition-colors',
                isActive
                  ? 'gov-tab-active bg-[var(--color-subtle)] text-[var(--color-text)]'
                  : 'text-[var(--color-muted)] hover:bg-[var(--color-subtle)] hover:text-[var(--color-text)]'
              )}
            >
              <item.icon size={18} strokeWidth={1.5} />
              {item.name}
            </Link>
          );
        })}
      </div>

      <div>{children}</div>
    </div>
  );
}
