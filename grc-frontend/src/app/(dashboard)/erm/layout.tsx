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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Enterprise Risk Management</h1>
        <p className="text-slate-600">Comprehensive risk identification, assessment, and monitoring</p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl bg-white p-1">
        {ermNavigation.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== '/erm' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-slate-900 hover:bg-slate-100'
              )}
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
