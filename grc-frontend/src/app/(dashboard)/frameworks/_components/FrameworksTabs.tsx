'use client';

// FrameworksTabs
// ─────────────────────────────────────────────────────────────────────────
// Shared tab bar at the top of /frameworks and /frameworks/manage. Drives
// navigation between the dashboard surface (compliance posture + launcher)
// and the management surface (processing / active / available frameworks).

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, FolderKanban, ExternalLink } from 'lucide-react';

const TABS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    href: '/frameworks',
    icon: LayoutDashboard,
    hint: 'Posture, launcher, recent activity',
  },
  {
    id: 'manage',
    label: 'Manage Frameworks',
    href: '/frameworks/manage',
    icon: FolderKanban,
    hint: 'Active journeys + available library',
  },
];

export function FrameworksTabs({ leadingAction }: { leadingAction?: React.ReactNode }) {
  const pathname = usePathname();
  // Manage page lives at /frameworks/manage; everything else under /frameworks
  // (root + journey detail + overview) treats the Dashboard tab as active.
  const activeId = pathname?.startsWith('/frameworks/manage') ? 'manage' : 'dashboard';

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex items-end gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-semibold text-slate-900 tracking-tight">Compliance Frameworks</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {activeId === 'dashboard'
              ? 'Live posture across active framework journeys.'
              : 'Browse the library and manage existing journeys.'}
          </p>
        </div>
        {/* Slot for a small action (e.g. Start Journey launcher) that should
            sit on the top-left side, next to the page title. */}
        {leadingAction && <div className="pb-0.5">{leadingAction}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <nav className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeId === tab.id;
            return (
              <Link
                key={tab.id}
                href={tab.href}
                className={`relative inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                  active
                    ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
              </Link>
            );
          })}
        </nav>
        <Link
          href="/auditor-portal"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:border-slate-300 hover:bg-slate-50 shadow-sm"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Auditor Portal
        </Link>
      </div>
    </div>
  );
}
