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
  Calendar,
  ShieldAlert,
  CheckSquare,
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
      { name: 'Acknowledgments', href: '/governance/acknowledgments', icon: CheckSquare },
      { name: 'Exceptions', href: '/governance/exceptions', icon: ShieldAlert },
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
    items: [
      { name: 'ERM Overview', href: '/erm', icon: BarChart3 },
      { name: 'Risk Assessments', href: '/erm/risk-assessments', icon: ClipboardCheck },
      { name: 'Risk Register', href: '/risks', icon: AlertTriangle },
      { name: 'RCSA', href: '/risks/rcsa', icon: ClipboardList },
      { name: 'Internal Controls', href: '/erm/internal-controls', icon: Target },
      { name: 'KRIs', href: '/erm/kris', icon: Activity },
      { name: 'Incidents', href: '/erm/incidents', icon: AlertCircle },
      { name: 'Advanced Analytics', href: '/erm/analytics', icon: BarChart3 },
    ],
  },
  {
    name: 'Compliance',
    icon: Shield,
    items: [
      { name: 'Frameworks', href: '/frameworks', icon: Layers },
      { name: 'Controls', href: '/controls', icon: Shield },
      { name: 'Evidence Requirements', href: '/evidence-requirements', icon: ClipboardList },
      { name: 'Statements', href: '/compliance/statements', icon: FileText },
      { name: 'Assessments', href: '/compliance/assessments', icon: ClipboardCheck },
      { name: 'Pending Approvals', href: '/compliance/assessments/approvals', icon: Clock },
      { name: 'Evidence', href: '/evidence', icon: FileCheck },
      { name: 'Evidence Approvals', href: '/evidence/approvals', icon: CheckSquare },
      { name: 'Compliance Calendar', href: '/compliance/calendar', icon: Calendar },
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
  { name: 'Reports', href: '/reports', icon: BarChart3 },
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
        isActive 
          ? 'border-l-[3px] ml-0 pl-[calc(0.75rem-3px)]' 
          : 'border-l-[3px] border-transparent',
        collapsed && 'justify-center px-2'
      )}
      style={{
        color: isActive ? 'var(--color-surface)' : 'rgba(255, 255, 255, 0.65)',
        backgroundColor: isActive ? 'rgba(255, 255, 255, 0.12)' : undefined,
        borderLeftColor: isActive ? 'var(--color-surface)' : 'transparent',
      }}
      onMouseEnter={(e) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
          e.currentTarget.style.color = 'var(--color-surface)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isActive) {
          e.currentTarget.style.backgroundColor = '';
          e.currentTarget.style.color = 'rgba(255, 255, 255, 0.65)';
        }
      }}
      title={collapsed ? item.name : undefined}
    >
      <item.icon 
        size={18} 
        className="flex-shrink-0 transition-transform duration-200 group-hover:scale-110"
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
          className="flex items-center justify-center w-full rounded-lg p-2.5 transition-all duration-200"
          style={{
            color: isAnyChildActive ? 'var(--color-surface)' : 'rgba(255, 255, 255, 0.65)',
            backgroundColor: isAnyChildActive ? 'rgba(255, 255, 255, 0.1)' : undefined,
          }}
          title={group.name}
        >
          <group.icon size={18} />
        </button>
        <div className="absolute left-full top-0 ml-2 hidden group-hover/nav:block z-50">
          <div className="rounded-xl shadow-2xl py-2 min-w-52 animate-fade-in" style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)' }}>
              {group.name}
            </div>
            {group.items.map((item) => {
              const isActive = pathname === item.href || 
                (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className="flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-150 border-l-2"
                  style={{
                    color: isActive ? 'var(--color-base)' : 'var(--color-text)',
                    backgroundColor: isActive ? 'var(--color-subtle)' : undefined,
                    borderLeftColor: isActive ? 'var(--color-base)' : 'transparent',
                  }}
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
        className="group flex items-center gap-3 w-full rounded-lg px-3 py-2.5 text-sm font-semibold transition-all duration-200"
        style={{
          color: isAnyChildActive ? 'var(--color-surface)' : 'rgba(255, 255, 255, 0.8)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = '';
        }}
      >
        <group.icon 
          size={18} 
          className="flex-shrink-0 transition-colors duration-200"
          style={{ color: isAnyChildActive ? 'var(--color-surface)' : 'rgba(255, 255, 255, 0.5)' }}
        />
        <span className="flex-1 text-left truncate">{group.name}</span>
        <ChevronDown 
          size={16} 
          className={clsx(
            'transition-transform duration-200',
            !isOpen && '-rotate-90'
          )}
          style={{ color: 'rgba(255, 255, 255, 0.4)' }}
        />
      </button>
      <div
        className={clsx(
          'overflow-hidden transition-all duration-300 ease-out',
          isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        <div className="ml-3 pl-3 space-y-0.5 py-1" style={{ borderLeft: '1px solid rgba(255, 255, 255, 0.12)' }}>
          {group.items.map((item) => {
            const isActive = pathname === item.href || 
              (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));
            return (
              <Link
                key={item.name}
                href={item.href}
                className="group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all duration-200 border-l-2 -ml-[1px]"
                style={{
                  color: isActive ? 'var(--color-surface)' : 'rgba(255, 255, 255, 0.55)',
                  backgroundColor: isActive ? 'rgba(255, 255, 255, 0.1)' : undefined,
                  borderLeftColor: isActive ? 'var(--color-surface)' : 'transparent',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.06)';
                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.backgroundColor = '';
                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.55)';
                  }
                }}
              >
                <item.icon 
                  size={16} 
                  className="flex-shrink-0 transition-transform duration-200 group-hover:scale-105"
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
        'flex flex-col transition-all duration-300 ease-out',
        collapsed ? 'w-[68px]' : 'w-64'
      )}
      style={{ backgroundColor: 'var(--color-base)' }}
    >
      <div className={clsx(
        'h-16 flex items-center transition-all duration-300',
        collapsed ? 'px-3 justify-center' : 'px-4'
      )} style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg" style={{ backgroundColor: 'rgba(255, 255, 255, 0.15)' }}>
            <Shield size={18} style={{ color: 'var(--color-surface)' }} />
          </div>
          {!collapsed && (
            <div className="overflow-hidden">
              <span className="text-lg font-semibold whitespace-nowrap" style={{ color: 'var(--color-surface)' }}>ComplyVerse</span>
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

      <div className="p-3" style={{ borderTop: '1px solid rgba(255, 255, 255, 0.1)' }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={clsx(
            'flex items-center gap-2 w-full px-3 py-2.5 rounded-lg transition-all duration-200',
            collapsed && 'justify-center px-2'
          )}
          style={{ color: 'rgba(255, 255, 255, 0.6)' }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)';
            e.currentTarget.style.color = 'var(--color-surface)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = '';
            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.6)';
          }}
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
          <div className="mt-3 px-3 text-xs" style={{ color: 'rgba(255, 255, 255, 0.3)' }}>
            Enterprise GRC v1.0
          </div>
        )}
      </div>
    </aside>
  );
}
