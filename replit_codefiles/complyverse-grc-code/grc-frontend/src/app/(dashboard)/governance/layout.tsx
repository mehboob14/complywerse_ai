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
} from 'lucide-react';
import { clsx } from 'clsx';

const governanceNavigation = [
  { name: 'Overview', href: '/governance', icon: LayoutDashboard },
  { name: 'Documents', href: '/governance/documents', icon: FileText },
  { name: 'Committees', href: '/governance/committees', icon: Users },
  { name: 'Mappings', href: '/governance/mappings', icon: Link2 },
  { name: 'Workflows', href: '/governance/workflows', icon: GitPullRequest },
  { name: 'Approvals', href: '/governance/approvals', icon: CheckSquare },
  { name: 'Reviews', href: '/governance/reviews', icon: Calendar },
];

export default function GovernanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>Governance</h1>
        <p style={{ color: 'var(--color-muted)' }}>Policy and document lifecycle management</p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl p-1" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        {governanceNavigation.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== '/governance' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-600 text-white'
                  : ''
              )}
              style={!isActive ? { color: 'var(--color-muted)' } : undefined}
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
