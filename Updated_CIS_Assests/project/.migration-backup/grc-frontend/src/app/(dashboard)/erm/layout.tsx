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
        <div className="flex flex-wrap items-center gap-0 border-b border-gray-200">
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
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
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
