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
  Rss,
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
  requiredModules?: string[];
  adminOnly?: boolean;
}

type NavEntry = (NavItem & { requiredModules?: string[]; adminOnly?: boolean }) | NavGroup;

const navigation: NavEntry[] = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, requiredModules: ['dashboard'] },
  {
    name: 'Governance',
    icon: Scale,
    defaultOpen: true,
    requiredModules: ['governance'],
    items: [
      { name: 'Policies', href: '/governance', icon: BookOpen },
      { name: 'Documents', href: '/governance/documents', icon: FileText },
      { name: 'Attestations', href: '/governance/attestations', icon: ClipboardCheck },
      { name: 'Regulatory Changes', href: '/governance/regulatory-changes', icon: FileCheck },
      { name: 'Regulatory Feeds', href: '/governance/regulatory-feeds', icon: Rss },
      { name: 'Committees', href: '/governance/committees', icon: Users },
      { name: 'Workflows', href: '/governance/workflows', icon: GitBranch },
      { name: 'Reviews', href: '/governance/reviews', icon: ClipboardList },
    ],
  },
  {
    name: 'Risk Management',
    icon: AlertTriangle,
    requiredModules: ['risks', 'erm'],
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
    requiredModules: ['compliance', 'controls', 'evidence', 'frameworks'],
    items: [
      { name: 'Frameworks', href: '/frameworks', icon: Layers },
      { name: 'Controls', href: '/controls', icon: Shield },
      { name: 'Evidence Requirements', href: '/evidence-requirements', icon: ClipboardList },
      { name: 'Statements', href: '/compliance/statements', icon: FileText },
      { name: 'Assessments', href: '/compliance/assessments', icon: ClipboardCheck },
      { name: 'Pending Approvals', href: '/compliance/assessments/approvals', icon: Clock },
      { name: 'Evidence', href: '/evidence', icon: FileCheck },
      { name: 'Control Library', href: '/control-library', icon: Library },
    ],
  },
  {
    name: 'Vulnerability Mgmt',
    icon: Bug,
    requiredModules: ['vulnerabilities'],
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
    requiredModules: ['assets'],
    items: [
      { name: 'IT Assets', href: '/assets', icon: Server },
    ],
  },
  {
    name: 'Administration',
    icon: Settings,
    adminOnly: true,
    requiredModules: ['admin'],
    items: [
      { name: 'Overview', href: '/admin', icon: Settings },
      { name: 'Company', href: '/admin/organization', icon: Server },
      { name: 'User Management', href: '/admin/users', icon: Users },
      { name: 'Role Management', href: '/admin/roles', icon: Shield },
      { name: 'Audit Logs', href: '/admin/audit-logs', icon: FileText },
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
        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-150',
        isActive 
          ? 'bg-primary-50 text-primary-700' 
          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
        collapsed && 'justify-center px-2'
      )}
      title={collapsed ? item.name : undefined}
    >
      <item.icon 
        size={18} 
        className={clsx(
          'flex-shrink-0 transition-colors duration-150',
          isActive ? 'text-primary-600' : 'text-slate-600 group-hover:text-slate-600'
        )} 
      />
      {!collapsed && <span className="truncate">{item.name}</span>}
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
            'flex items-center justify-center w-full rounded-lg p-2.5 transition-all duration-150',
            'hover:bg-slate-50',
            isAnyChildActive 
              ? 'text-primary-600 bg-primary-50' 
              : 'text-slate-600 hover:text-slate-600'
          )}
        >
          <group.icon size={18} />
        </button>
        <div className="absolute left-full top-0 ml-2 hidden group-hover/nav:block z-50">
          <div className="bg-white rounded-lg shadow-elevated border border-slate-200 py-2 min-w-[200px]">
            <div className="px-3 py-1.5 text-xs font-semibold text-slate-600 uppercase tracking-wider">
              {group.name}
            </div>
            {group.items.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'flex items-center gap-2 px-3 py-2 text-sm transition-colors',
                  pathname === item.href || pathname.startsWith(item.href + '/')
                    ? 'text-primary-700 bg-primary-50'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                )}
              >
                <item.icon size={14} />
                {item.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'group flex items-center gap-3 w-full rounded-lg px-3 py-2 text-sm font-semibold transition-all duration-150',
          'hover:bg-slate-50',
          isAnyChildActive ? 'text-slate-900' : 'text-slate-600 hover:text-slate-900'
        )}
      >
        <group.icon 
          size={18} 
          className={clsx(
            'flex-shrink-0 transition-colors duration-150',
            isAnyChildActive ? 'text-primary-600' : 'text-slate-600 group-hover:text-slate-500'
          )} 
        />
        <span className="flex-1 text-left truncate">{group.name}</span>
        <ChevronDown 
          size={16} 
          className={clsx(
            'text-slate-600 transition-transform duration-200',
            isOpen ? '' : '-rotate-90'
          )}
        />
      </button>
      {isOpen && (
        <div className="ml-4 space-y-0.5 border-l border-slate-200 pl-3">
          {group.items.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'group flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm transition-all duration-150',
                (pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/')))
                  ? 'text-primary-700 bg-primary-50 font-medium'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              )}
            >
              <item.icon 
                size={15} 
                className={clsx(
                  'flex-shrink-0',
                  (pathname === item.href || pathname.startsWith(item.href + '/'))
                    ? 'text-primary-600' 
                    : 'text-slate-600 group-hover:text-slate-500'
                )} 
              />
              <span className="truncate">{item.name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [allowedModules, setAllowedModules] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(res => res.json())
      .then(data => {
        if (data.authenticated && data.user) {
          setAllowedModules(data.user.allowed_modules || []);
          setIsAdmin(data.user.is_admin || false);
        }
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  const filteredNavigation = loaded ? navigation.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (!item.requiredModules || item.requiredModules.length === 0) return true;
    if (isAdmin) return true;
    return item.requiredModules.some(mod => allowedModules.includes(mod));
  }) : [];

  return (
    <aside
      className={clsx(
        'flex flex-col bg-white border-r border-slate-200 transition-all duration-300 ease-out shadow-sidebar',
        collapsed ? 'w-[68px]' : 'w-60'
      )}
    >
      <div className={clsx(
        'h-14 flex items-center border-b border-slate-200 transition-all duration-300',
        collapsed ? 'px-3 justify-center' : 'px-4'
      )}>
        <div className="flex items-center gap-2.5">
          <Shield size={22} className="text-primary-600 flex-shrink-0" />
          {!collapsed && (
            <span className="text-lg font-semibold text-black whitespace-nowrap">ComplyVerse</span>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-0.5">
        {filteredNavigation.map((item) => {
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

      <div className="p-3 border-t border-slate-200">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={clsx(
            'flex items-center gap-2 w-full px-3 py-2 rounded-lg',
            'text-slate-600 hover:text-slate-600 hover:bg-slate-50 transition-all duration-150',
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
      </div>
    </aside>
  );
}
