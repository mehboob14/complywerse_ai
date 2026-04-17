'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
    <div className="governance-light min-h-full">
      {/* Header strip — full-width, title + underline tab bar */}
      <div className="-mx-4 lg:-mx-5 -mt-4 lg:-mt-5 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="px-4 lg:px-5 pt-0 pb-0">
          {/* Underline tab bar */}
          <div className="flex items-center gap-0 overflow-x-auto">
            {governanceNavigation.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/governance' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={clsx(
                    'inline-flex items-center gap-1.5 px-3.5 py-3 text-[13px] font-semibold border-b-2 transition-colors -mb-px whitespace-nowrap',
                    isActive
                      ? 'border-[var(--color-base)] text-[var(--color-base)]'
                      : 'border-transparent text-[var(--color-muted)] hover:text-[var(--color-text)] hover:border-[var(--color-border)]'
                  )}
                >
                  <item.icon size={14} strokeWidth={1.75} />
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>
      </div>

      <div className="pt-4">{children}</div>
    </div>
  );
}
