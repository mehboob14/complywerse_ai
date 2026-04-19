'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  BarChart3,
  AlertTriangle,
  Activity,
  AlertCircle,
  Calendar,
  GitBranch,
  ListTodo,
  Target,
  Shield,
} from 'lucide-react';
import { clsx } from 'clsx';

const ermNavigation = [
  { name: 'Risk Register', href: '/erm/risks', icon: AlertTriangle },
  { name: 'Appetite', href: '/erm/appetite', icon: Target },
  { name: 'Mitigation Actions', href: '/erm/mitigation-actions', icon: ListTodo },
  { name: 'Internal Controls', href: '/erm/internal-controls', icon: Shield },
  { name: 'KRIs', href: '/erm/kris', icon: Activity },
  { name: 'Incidents', href: '/erm/incidents', icon: AlertCircle },
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

  return (
    <div className="cw-dashboard risk-workspace min-h-full space-y-4 px-1 pb-2">
      {!isOverview && !isAnalyticsRoute && !isRiskAssessmentsRoute && !isRcsaRoute && (
        <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-white p-[3px]">
          {ermNavigation.map((item) => {
            const isActive = pathname === item.href || 
              (item.href !== '/erm' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                className={clsx(
                  'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors',
                  isActive
                    ? 'bg-primary-600 text-white shadow-sm'
                    : 'bg-white text-slate-800 hover:bg-slate-100'
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
