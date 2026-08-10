'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  AlertTriangle,
  Calendar,
  GitBranch,
  ListTodo,
  Target,
  Crosshair,
} from 'lucide-react';
import { clsx } from 'clsx';

const ermNavigation = [
  { name: 'Risk Register', href: '/erm/risks', icon: AlertTriangle },
  { name: 'CTEM Scopes', href: '/erm/ctem-scopes', icon: Crosshair },
  { name: 'Appetite', href: '/erm/appetite', icon: Target },
  { name: 'Mitigation Actions', href: '/erm/mitigation-actions', icon: ListTodo },
  // 'Internal Controls' moved to Control Testing & Assurance (/controls);
  // 'KRIs' moved to Governance — removed from the ERM/Risk tab strip.
  { name: 'Reviews', href: '/erm/reviews', icon: Calendar },
  { name: 'Dependencies', href: '/erm/dependencies', icon: GitBranch },
];

export default function ERMLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isOverview = pathname === '/erm';
  const isAnalyticsRoute = pathname?.startsWith('/erm/analytics');
  const isRiskAssessmentsRoute = pathname?.startsWith('/erm/risk-assessments');
  const isRcsaRoute = pathname?.startsWith('/erm/rcsa');
  // Incidents moved to the "Issue & Incident Management" module — render it clean,
  // without the ERM Risk tab strip.
  const isIncidentsRoute = pathname?.startsWith('/erm/incidents');
  // KRIs moved to Governance — render clean, without the ERM Risk tab strip.
  const isKrisRoute = pathname?.startsWith('/erm/kris');
  // Risk detail pages need the full workspace chrome (like assets/vulns) — no
  // sibling-module tab strip competing with the detail header.
  const isRiskDetailRoute =
    !!pathname && (/^\/erm\/risks\/\d+/.test(pathname) || pathname.startsWith('/erm/risks/nca/'));

  const hideTabs =
    isOverview ||
    isAnalyticsRoute ||
    isRiskAssessmentsRoute ||
    isRcsaRoute ||
    isIncidentsRoute ||
    isKrisRoute ||
    isRiskDetailRoute;

  return (
    <div className="cw-dashboard risk-workspace min-h-full space-y-4 px-1 pb-2">
      {!hideTabs && (
        <div className="flex flex-wrap items-center gap-0 border-b border-slate-200">
          {ermNavigation.map((item) => {
            const isActive = pathname === item.href || 
              (item.href !== '/erm' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                className={clsx(
                  'inline-flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px',
                  isActive
                    ? 'border-primary-600 text-primary-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.name}
              </Link>
            );
          })}
        </div>
      )}

      <div>{children}</div>
    </div>
  );
}
