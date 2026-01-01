'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileStack,
  Shield,
  FileCheck,
  AlertTriangle,
  Scale,
  FileText,
  Server,
  Settings,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useState } from 'react';
import { clsx } from 'clsx';

const navigation = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Frameworks', href: '/frameworks', icon: FileStack },
  { name: 'Controls', href: '/controls', icon: Shield },
  { name: 'Evidence', href: '/evidence', icon: FileCheck },
  { name: 'Risks', href: '/risks', icon: AlertTriangle },
  { name: 'Governance', href: '/governance', icon: Scale },
  { name: 'Documents', href: '/documents', icon: FileText },
  { name: 'Assets', href: '/assets', icon: Server },
  { name: 'Settings', href: '/settings', icon: Settings },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={clsx(
        'flex flex-col border-r border-slate-700 bg-slate-800 transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="flex h-16 items-center justify-between border-b border-slate-700 px-4">
        {!collapsed && (
          <span className="text-lg font-bold text-white">GRC Platform</span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-white"
        >
          {collapsed ? <ChevronRight size={20} /> : <ChevronLeft size={20} />}
        </button>
      </div>

      <nav className="flex-1 space-y-1 p-2">
        {navigation.map((item) => {
          const isActive = pathname.startsWith(item.href);
          return (
            <Link
              key={item.name}
              href={item.href}
              className={clsx(
                'nav-link',
                isActive && 'nav-link-active'
              )}
              title={collapsed ? item.name : undefined}
            >
              <item.icon size={20} />
              {!collapsed && <span>{item.name}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-700 p-4">
        {!collapsed && (
          <div className="text-xs text-slate-500">
            Enterprise GRC v0.1.0
          </div>
        )}
      </div>
    </aside>
  );
}
