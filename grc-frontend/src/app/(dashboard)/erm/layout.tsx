'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  AlertTriangle,
  Activity,
  AlertCircle,
  Calendar,
  GitBranch,
  FileText,
  ListTodo,
  Target,
} from 'lucide-react';
import { clsx } from 'clsx';

const ermNavigation = [
  { name: 'Overview', href: '/erm', icon: LayoutDashboard },
  { name: 'Risk Register', href: '/erm/risks', icon: AlertTriangle },
  { name: 'Appetite', href: '/erm/appetite', icon: Target },
  { name: 'Mitigation Actions', href: '/erm/mitigation-actions', icon: ListTodo },
  { name: 'KRIs', href: '/erm/kris', icon: Activity },
  { name: 'Incidents', href: '/erm/incidents', icon: AlertCircle },
  { name: 'Reviews', href: '/erm/reviews', icon: Calendar },
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
        <h1 className="text-2xl font-bold text-white">Enterprise Risk Management</h1>
        <p className="text-slate-400">Comprehensive risk identification, assessment, and monitoring</p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl bg-slate-800 p-1">
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
                  : 'text-slate-400 hover:bg-slate-700 hover:text-white'
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
