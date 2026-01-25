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
  AlertTriangle,
  Target,
  Activity,
  AlertCircle,
  FileText,
  GitBranch,
  ClipboardCheck,
  Library,
  Bug,
  Clock,
  Users,
  BookOpen,
  Layers,
  ClipboardList,
  type LucideIcon,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { clsx } from 'clsx';

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

interface NavGroup {
  name: string;
  icon: LucideIcon;
  items: NavItem[];
  defaultOpen?: boolean;
}

type NavEntry = NavItem | NavGroup;

const navigation: NavEntry[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  {
    name: 'Governance',
    icon: Scale,
    defaultOpen: true,
    items: [
      { name: 'Policies', href: '/governance', icon: BookOpen },
      { name: 'Documents', href: '/governance/documents', icon: FileText },
      { name: 'Attestations', href: '/governance/attestations', icon: ClipboardCheck },
      { name: 'Regulatory Changes', href: '/governance/regulatory-changes', icon: FileCheck },
      { name: 'Committees', href: '/governance/committees', icon: Users },
      { name: 'Workflows', href: '/governance/workflows', icon: GitBranch },
      { name: 'Reviews', href: '/governance/reviews', icon: ClipboardList },
    ],
  },
  {
    name: 'Risk Management',
    icon: AlertTriangle,
    items: [
      { name: 'ERM Overview', href: '/erm', icon: BarChart3 },
      { name: 'Risk Register', href: '/risks', icon: AlertTriangle },
      { name: 'RCSA', href: '/risks/rcsa', icon: ClipboardList },
      { name: 'Internal Controls', href: '/erm/internal-controls', icon: Target },
      { name: 'KRIs', href: '/erm/kris', icon: Activity },
      { name: 'Incidents', href: '/erm/incidents', icon: AlertCircle },
    ],
  },
  {
    name: 'Compliance',
    icon: Shield,
    items: [
      { name: 'Frameworks', href: '/frameworks', icon: Layers },
      { name: 'Controls', href: '/controls', icon: Shield },
      { name: 'Statements', href: '/compliance/statements', icon: FileText },
      { name: 'Evidence', href: '/evidence', icon: FileCheck },
      { name: 'Control Library', href: '/control-library', icon: Library },
    ],
  },
  {
    name: 'Vulnerability Management',
    icon: Bug,
    items: [
      { name: 'Dashboard', href: '/vulnerabilities/dashboard', icon: BarChart3 },
      { name: 'Vulnerabilities', href: '/vulnerabilities', icon: Bug },
      { name: 'Departments', href: '/vulnerabilities/departments', icon: Users },
      { name: 'Reports', href: '/vulnerabilities/reports', icon: FileText },
      { name: 'SLA Config', href: '/vulnerabilities/sla', icon: Clock },
    ],
  },
  {
    name: 'Assets',
    icon: Server,
    items: [
      { name: 'IT Assets', href: '/assets', icon: Server },
    ],
  },
  {
    name: 'Administration',
    icon: Settings,
    items: [
      { name: 'Users', href: '/users', icon: Users },
      { name: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

function isGroup(item: NavEntry): item is NavGroup {
  return 'items' in item;
}

function NavItemLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname();
  const isActive = pathname === item.href || 
    (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));

  return (
    <Link
      href={item.href}
      className={clsx(
        'group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all duration-200',
        'hover:bg-slate-800/80 hover:text-white',
        isActive 
          ? 'bg-primary-600/15 text-primary-400 border-l-[3px] border-primary-500 ml-0 pl-[calc(0.75rem-3px)]' 
          : 'text-slate-400 border-l-[3px] border-transparent',
        collapsed && 'justify-center px-2'
      )}
      title={collapsed ? item.name : undefined}
    >
      <item.icon 
        size={18} 
        className={clsx(
          'flex-shrink-0 transition-transform duration-200',
          'group-hover:scale-110'
        )} 
      />
      {!collapsed && (
        <span className="truncate transition-colors duration-200">{item.name}</span>
      )}
    </Link>
  );
}

function NavGroupSection({ group, collapsed }: { group: NavGroup; collapsed: boolean }) {
  const pathname = usePathname();
  const isAnyChildActive = group.items.some(
    item => pathname === item.href || 
    (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'))
  );
  const [isOpen, setIsOpen] = useState(group.defaultOpen || isAnyChildActive);

  useEffect(() => {
    if (isAnyChildActive && !isOpen) {
      setIsOpen(true);
    }
  }, [isAnyChildActive, isOpen]);

  if (collapsed) {
    return (
      <div className="relative group/nav">
        <button
          className={clsx(
            'flex items-center justify-center w-full rounded-lg p-2.5 transition-all duration-200',
            'hover:bg-slate-800/80',
            isAnyChildActive 
              ? 'text-primary-400 bg-primary-600/10' 
              : 'text-slate-400 hover:text-white'
          )}
          title={group.name}
        >
          <group.icon size={18} />
        </button>
        <div className="absolute left-full top-0 ml-2 hidden group-hover/nav:block z-50">
          <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl py-2 min-w-52 animate-fade-in">
            <div className="px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-700/50 mb-1">
              {group.name}
            </div>
            {group.items.map((item) => {
              const isActive = pathname === item.href || 
                (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={clsx(
                    'flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-150',
                    'hover:bg-slate-700/50 hover:text-white',
                    isActive 
                      ? 'text-primary-400 bg-primary-600/10 border-l-2 border-primary-500' 
                      : 'text-slate-300 border-l-2 border-transparent'
                  )}
                >
                  <item.icon size={16} className="flex-shrink-0" />
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
          'group flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-semibold transition-all duration-200',
          'hover:bg-slate-800/60',
          isAnyChildActive ? 'text-white' : 'text-slate-300 hover:text-white'
        )}
      >
        <group.icon 
          size={18} 
          className={clsx(
            'flex-shrink-0 transition-colors duration-200',
            isAnyChildActive ? 'text-primary-400' : 'text-slate-500 group-hover:text-slate-400'
          )} 
        />
        <span className="flex-1 text-left truncate">{group.name}</span>
        <ChevronDown 
          size={16} 
          className={clsx(
            'text-slate-500 transition-transform duration-200',
            !isOpen && '-rotate-90'
          )} 
        />
      </button>
      <div
        className={clsx(
          'overflow-hidden transition-all duration-300 ease-out',
          isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="ml-3 pl-3 border-l border-slate-700/50 space-y-0.5 py-1">
          {group.items.map((item) => {
            const isActive = pathname === item.href || 
              (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));
            return (
              <Link
                key={item.name}
                href={item.href}
                className={clsx(
                  'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200',
                  'hover:bg-slate-800/50 hover:text-white',
                  isActive 
                    ? 'text-primary-400 bg-primary-600/10 border-l-2 border-primary-500 -ml-[1px]' 
                    : 'text-slate-400 border-l-2 border-transparent -ml-[1px]'
                )}
              >
                <item.icon 
                  size={16} 
                  className={clsx(
                    'flex-shrink-0 transition-transform duration-200',
                    'group-hover:scale-105'
                  )} 
                />
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
        'flex flex-col bg-slate-900 border-r border-slate-800 transition-all duration-300 ease-out',
        collapsed ? 'w-[68px]' : 'w-64'
      )}
    >
      <div className={clsx(
        'h-16 flex items-center border-b border-slate-800 transition-all duration-300',
        collapsed ? 'px-3 justify-center' : 'px-4'
      )}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-primary-500 to-primary-700 flex items-center justify-center shadow-lg shadow-primary-600/20">
            <Shield size={18} className="text-white" />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <span className="text-lg font-bold text-white whitespace-nowrap">GRC Platform</span>
            </div>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-1">
        {navigation.map((item) => {
          if (isGroup(item)) {
            return (
              <NavGroupSection
                key={item.name}
                group={item}
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

      <div className="p-3 border-t border-slate-800">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={clsx(
            'flex items-center gap-2 w-full px-3 py-2.5 rounded-lg',
            'text-slate-400 hover:text-white hover:bg-slate-800 transition-all duration-200',
            collapsed && 'justify-center px-2'
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronRight 
            size={18} 
            className={clsx(
              'transition-transform duration-300',
              !collapsed && 'rotate-180'
            )}
          />
          {!collapsed && <span className="text-sm">Collapse</span>}
        </button>
        {!collapsed && (
          <div className="mt-3 px-3 text-xs text-slate-600">
            Enterprise GRC v1.0
          </div>
        )}
      </div>
    </aside>
  );
}
