'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  BarChart3,
  AlertTriangle,
  Activity,
  AlertCircle,
  Calendar,
  GitBranch,
  FileText,
  ListTodo,
  Target,
  Shield,
  ClipboardCheck,
} from 'lucide-react';
import { clsx } from 'clsx';

const ermNavigation = [
  { name: 'Overview', href: '/erm', icon: LayoutDashboard },
  { name: 'Risk Register', href: '/erm/risks', icon: AlertTriangle },
  { name: 'Advanced Analytics', href: '/erm/analytics', icon: BarChart3 },
  { name: 'Appetite', href: '/erm/appetite', icon: Target },
  { name: 'Mitigation Actions', href: '/erm/mitigation-actions', icon: ListTodo },
  { name: 'Internal Controls', href: '/erm/internal-controls', icon: Shield },
  { name: 'KRIs', href: '/erm/kris', icon: Activity },
  { name: 'Incidents', href: '/erm/incidents', icon: AlertCircle },
  { name: 'Reviews', href: '/erm/reviews', icon: Calendar },
  { name: 'Assessments', href: '/erm/risk-assessments', icon: ClipboardCheck },
  { name: 'RCSA', href: '/erm/rcsa', icon: ClipboardCheck },
  { name: 'Dependencies', href: '/erm/dependencies', icon: GitBranch },
  { name: 'Reports', href: '/erm/reports', icon: FileText },
];

export default function ERMLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isOverview = pathname === '/erm';

  return (
    <div className="cw-dashboard risk-workspace min-h-full space-y-4 px-1 pb-2">
      <div className="space-y-0.5">
        <h1 className="text-[15px] font-semibold text-slate-900">Enterprise Risk Management</h1>
        <p className="text-[11px] text-slate-500">Comprehensive risk identification, assessment, and monitoring</p>
      </div>

      {!isOverview && (
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
