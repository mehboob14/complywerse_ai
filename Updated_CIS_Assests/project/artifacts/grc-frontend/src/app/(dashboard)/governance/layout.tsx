'use client';

import { Link } from 'wouter';
import { usePathname } from '@/lib/navigation';
import {
  LayoutDashboard,
  FileText,
  Calendar,
  CheckSquare,
  Link2,
  AlertTriangle,
} from 'lucide-react';
import { clsx } from 'clsx';

const governanceNavigation = [
  { name: 'Overview', href: '/governance', icon: LayoutDashboard },
  { name: 'Documents', href: '/governance/documents', icon: FileText },
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
    <div className="-m-4 lg:-m-5 text-slate-900">
      <div className="border-b border-gray-200 px-3 sm:px-6 pt-3 overflow-x-auto">
        <div className="flex items-center gap-0 min-w-max">
          {governanceNavigation.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== '/governance' && pathname.startsWith(item.href));
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
                <item.icon size={14} />
                {item.name}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="px-4 sm:px-6 py-4 sm:py-5 space-y-4 sm:space-y-6">{children}</div>
    </div>
  );
}
