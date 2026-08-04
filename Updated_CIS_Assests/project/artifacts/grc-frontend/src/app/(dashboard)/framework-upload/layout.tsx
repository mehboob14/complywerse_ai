'use client';

import { Link } from 'wouter';
import { usePathname } from '@/lib/navigation';
import {
  Upload,
  FileText,
  GitCompare,
  ClipboardCheck,
} from 'lucide-react';
import { clsx } from 'clsx';

const frameworkUploadNavigation = [
  { name: 'Upload', href: '/framework-upload', icon: Upload },
  { name: 'Parsed Controls', href: '/framework-upload/controls', icon: FileText },
  { name: 'Alignment', href: '/framework-upload/alignment', icon: GitCompare },
  { name: 'Assessment', href: '/framework-upload/assessment', icon: ClipboardCheck },
];

export default function FrameworkUploadLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-black">Framework Upload</h1>
        <p className="text-slate-600">Upload, parse, and assess compliance frameworks</p>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl bg-white p-1">
        {frameworkUploadNavigation.map((item) => {
          const isActive = pathname === item.href || 
            (item.href !== '/framework-upload' && pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary-600 text-white'
                  : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
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
