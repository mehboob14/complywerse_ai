'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FileText,
  AlertTriangle,
} from 'lucide-react';
import { clsx } from 'clsx';

// "Overview" now lives in the sidebar (Governance Oversight) — kept out of this
// top nav so it isn't duplicated on the documents bar.
const governanceNavigation = [
  { name: 'Documents', href: '/governance/documents', icon: FileText },
  { name: 'Policy Exceptions', href: '/governance/exceptions', icon: AlertTriangle },
];

export default function GovernanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="-m-4 lg:-m-5 text-slate-900">
      <div className="border-b border-slate-200 px-3 sm:px-6 pt-3 overflow-x-auto">
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
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
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
