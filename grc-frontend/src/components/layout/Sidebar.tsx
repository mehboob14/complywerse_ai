'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Shield,
  FileCheck,
  Scale,
  Server,
  Settings,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Upload,
  FileStack,
  AlertTriangle,
  Target,
  Gauge,
  Activity,
  AlertCircle,
  FileText,
  GitBranch,
  ClipboardCheck,
  type LucideIcon,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { clsx } from 'clsx';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

interface NavCategory {
  name: string;
  icon: LucideIcon;
  items: NavItem[];
  defaultOpen?: boolean;
}

const navigation: (NavItem | NavCategory)[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  {
    name: 'Compliance & Frameworks',
    icon: Shield,
    defaultOpen: true,
    items: [
      { name: 'Frameworks', href: '/frameworks', icon: FileStack },
      { name: 'Framework Upload', href: '/framework-upload', icon: Upload },
      { name: 'Controls', href: '/controls', icon: Shield },
      { name: 'Evidence', href: '/evidence', icon: FileCheck },
    ],
  },
  {
    name: 'Risk Management',
    icon: BarChart3,
    items: [
      { name: 'ERM Dashboard', href: '/erm', icon: BarChart3 },
      { name: 'Risk Register', href: '/risks', icon: AlertTriangle },
      { name: 'Mitigation Actions', href: '/erm/mitigation-actions', icon: Target },
      { name: 'Risk Appetite', href: '/erm/appetite', icon: Gauge },
      { name: 'KRIs', href: '/erm/kris', icon: Activity },
      { name: 'Incidents', href: '/erm/incidents', icon: AlertCircle },
    ],
  },
  {
    name: 'Governance',
    icon: Scale,
    items: [
      { name: 'Overview', href: '/governance', icon: Scale },
      { name: 'Documents', href: '/governance/documents', icon: FileText },
      { name: 'Workflows', href: '/governance/workflows', icon: GitBranch },
      { name: 'Reviews', href: '/governance/reviews', icon: ClipboardCheck },
    ],
  },
  { name: 'Assets', href: '/assets', icon: Server },
  { name: 'Settings', href: '/settings', icon: Settings },
];

function isCategory(item: NavItem | NavCategory): item is NavCategory {
  return 'items' in item;
}

function NavItemLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname();
  const isActive = pathname === item.href || pathname.startsWith(item.href + '/');

  return (
    <Link
      href={item.href}
      className={clsx(
        'nav-link',
        isActive && 'nav-link-active'
      )}
      title={collapsed ? item.name : undefined}
    >
      <item.icon size={18} className="flex-shrink-0" />
      {!collapsed && <span className="truncate">{item.name}</span>}
    </Link>
  );
}

function NavCategoryGroup({ category, collapsed }: { category: NavCategory; collapsed: boolean }) {
  const pathname = usePathname();
  const isAnyChildActive = category.items.some(
    item => pathname === item.href || pathname.startsWith(item.href + '/')
  );
  const [isOpen, setIsOpen] = useState(category.defaultOpen || isAnyChildActive);

  useEffect(() => {
    if (isAnyChildActive && !isOpen) {
      setIsOpen(true);
    }
  }, [isAnyChildActive, isOpen]);

  if (collapsed) {
    return (
      <div className="relative group">
        <button
          className={clsx(
            'nav-category-btn w-full justify-center',
            isAnyChildActive && 'nav-category-active'
          )}
          title={category.name}
        >
          <category.icon size={18} />
        </button>
        <div className="absolute left-full top-0 ml-2 hidden group-hover:block z-50">
          <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-xl py-2 min-w-48">
            <div className="px-3 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-700 mb-1">
              {category.name}
            </div>
            {category.items.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={clsx(
                    'flex items-center gap-3 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700 hover:text-white transition-colors',
                    isActive && 'bg-slate-700 text-white'
                  )}
                >
                  <item.icon size={16} />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'nav-category-btn w-full',
          isAnyChildActive && 'nav-category-active'
        )}
      >
        <category.icon size={18} className="flex-shrink-0" />
        <span className="flex-1 text-left truncate">{category.name}</span>
        {isOpen ? (
          <ChevronDown size={16} className="text-slate-400" />
        ) : (
          <ChevronRight size={16} className="text-slate-400" />
        )}
      </button>
      <div
        className={clsx(
          'overflow-hidden transition-all duration-200 ease-in-out',
          isOpen ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="pl-4 space-y-0.5 py-1">
          {category.items.map((item) => {
            const isActive = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.name}
                href={item.href}
                className={clsx(
                  'nav-subitem',
                  isActive && 'nav-subitem-active'
                )}
              >
                <item.icon size={16} className="flex-shrink-0" />
                <span className="truncate">{item.name}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={clsx(
        'sidebar flex flex-col transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      <div className="sidebar-header">
        {!collapsed && (
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center">
              <Shield size={18} className="text-white" />
            </div>
            <span className="text-lg font-bold text-white">GRC Platform</span>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center mx-auto">
            <Shield size={18} className="text-white" />
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-1">
        {navigation.map((item) => {
          if (isCategory(item)) {
            return (
              <NavCategoryGroup
                key={item.name}
                category={item}
                collapsed={collapsed}
              />
            );
          }
          return (
            <NavItemLink
              key={item.name}
              item={item}
              collapsed={collapsed}
            />
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="sidebar-toggle-btn"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
          {!collapsed && <span className="text-sm">Collapse</span>}
        </button>
        {!collapsed && (
          <div className="mt-3 text-xs text-slate-500">
            Enterprise GRC v1.0
          </div>
        )}
      </div>
    </aside>
  );
}
