'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { GitBranch } from 'lucide-react';

// The Risk Management pages' frame. Its tab strip is gone: every page it listed has a sidebar entry now (navAccess.ts, by lifecycle), except
// Dependencies, which hangs under the Risk Register and opens from this link on the register's pages until it becomes the risk record's "Related risks" tab.
const REGISTER_PAGES = ['/erm/risks', '/erm/risks/dashboard', '/erm/risks/list'];

export default function ERMLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="cw-dashboard risk-workspace min-h-full space-y-4 px-1 pb-2">
      {REGISTER_PAGES.includes(pathname ?? '') && (
        <div className="flex justify-end">
          <Link
            href="/erm/dependencies"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-700"
          >
            <GitBranch className="h-4 w-4" />
            Risk dependencies
          </Link>
        </div>
      )}

      <div>{children}</div>
    </div>
  );
}
