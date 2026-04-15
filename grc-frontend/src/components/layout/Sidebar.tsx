"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Shield,
  ScrollText,
  FileText,
  ClipboardCheck,
  GitPullRequest,
  Rss,
  AlertTriangle,
  Users,
  ClipboardList,
  Server,
  Settings,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Target,
  Activity,
  AlertCircle,
  Library,
  Bug,
  Clock,
  BookOpen,
  Layers,
  Globe,
  Calendar,
  CheckCircle,
  Bot,
  Wifi,
  FolderKanban,
  ListTodo,
  type LucideIcon,
} from "lucide-react";
import { useState, useEffect } from "react";
import { clsx } from "clsx";
import { apiClient } from "@/lib/api";

const navIconProps = {
  size: 16,
  strokeWidth: 1.5,
};

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  requiredPermissions?: string[];
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
  { 
    name: 'Dashboard', 
    href: '/dashboard', 
    icon: LayoutDashboard,
    requiredModules: ['dashboard'],
    requiredPermissions: ['dashboard:overview:*']
  },
  {
    name: 'Governance',
    icon: Shield,
    defaultOpen: true,
    requiredModules: ['governance'],
    items: [
      { name: 'Policies', href: '/governance', icon: ScrollText, requiredPermissions: ['governance:policies:*'] },
      { name: 'Documents', href: '/governance/documents', icon: FileText, requiredPermissions: ['governance:policies:*'] },
      { name: 'Attestations', href: '/governance/attestations', icon: ClipboardCheck, requiredPermissions: ['governance:attestations:*'] },
      { name: 'Regulatory Changes', href: '/governance/regulatory-changes', icon: GitPullRequest, requiredPermissions: ['governance:regulatory_changes:*'] },
      { name: 'Regulatory Feeds', href: '/governance/regulatory-feeds', icon: Rss, requiredPermissions: ['governance:regulatory_changes:*'] },
      { name: 'Exceptions', href: '/governance/exceptions', icon: AlertTriangle, requiredPermissions: ['governance:policy_exceptions:*'] },
      { name: 'Committees', href: '/governance/committees', icon: Users, requiredPermissions: ['governance:committees:*'] },
      { name: 'Reviews', href: '/governance/reviews', icon: ClipboardList, requiredPermissions: ['governance:policies:*'] },
    ],
  },
  {
    name: 'Risk Management',
    icon: AlertTriangle,
    requiredModules: ['risks', 'erm'],
    items: [
      { name: 'ERM Overview', href: '/erm', icon: BarChart3, requiredPermissions: ['erm:risks:*'] },
      { name: 'Risk Assessments', href: '/erm/risk-assessments', icon: ClipboardList, requiredPermissions: ['risks:risk_assessment:*', 'erm:rcsa:*'] },
      { name: 'Risk Register', href: '/erm/risks', icon: AlertTriangle, requiredPermissions: ['erm:risks:*'] },
      { name: 'Vendor Risk', href: '/vendor-risk', icon: Shield, requiredPermissions: ['erm:risks:*'] },
      { name: 'Assessments', href: '/vendor-risk/assessments', icon: ClipboardCheck, requiredPermissions: ['erm:risks:*'] },
      { name: 'Questionnaires', href: '/vendor-risk/questionnaires', icon: ClipboardList, requiredPermissions: ['erm:risks:*'] },
      { name: 'RCSA', href: '/risks/rcsa', icon: ClipboardList, requiredPermissions: ['erm:rcsa:*'] },
      { name: 'Internal Controls', href: '/erm/internal-controls', icon: Target, requiredPermissions: ['erm:internal_controls:*'] },
      { name: 'KRIs', href: '/erm/kris', icon: Activity, requiredPermissions: ['erm:kris:*'] },
      { name: 'Incidents', href: '/erm/incidents', icon: AlertCircle, requiredPermissions: ['erm:incidents:*'] },
      { name: 'Advanced Analytics', href: '/erm/analytics', icon: BarChart3, requiredPermissions: ['erm:risks:*'] },
    ],
  },
  {
    name: 'Compliance',
    icon: Shield,
    requiredModules: ['compliance', 'controls', 'evidence', 'frameworks'],
    items: [
      { name: 'Frameworks', href: '/frameworks', icon: Layers, requiredPermissions: ['compliance:frameworks:*'] },
      { name: 'Controls', href: '/controls', icon: Shield, requiredPermissions: ['controls:control_library:*'] },
      // { name: 'Evidence Requirements', href: '/evidence-requirements', icon: ClipboardList, requiredPermissions: ['evidence:evidence_requirements:*'] },
      { name: 'Statements', href: '/compliance/statements', icon: FileText, requiredPermissions: ['compliance:statements:*'] },
      { name: 'Assessments', href: '/compliance/assessments', icon: ClipboardCheck, requiredPermissions: ['compliance:assessments:*'] },
      { name: 'Pending Approvals', href: '/compliance/assessments/approvals', icon: Clock, requiredPermissions: ['compliance:assessments:*'] },
      { name: 'Evidence', href: '/evidence', icon: FileText, requiredPermissions: ['evidence:evidence_library:*', 'evidence:evidence_upload:*'] },
      { name: 'Control Library', href: '/control-library', icon: Library, requiredPermissions: ['controls:control_library:*'] },
    ],
  },
  {
    name: 'Vulnerability Mgmt',
    icon: Bug,
    requiredModules: ['vulnerabilities'],
    items: [
      { name: 'Dashboard', href: '/vulnerabilities/dashboard', icon: BarChart3, requiredPermissions: ['vulnerabilities:vulnerability_register:*'] },
      { name: 'Vulnerabilities', href: '/vulnerabilities', icon: Bug, requiredPermissions: ['vulnerabilities:vulnerability_register:*'] },
      { name: 'Departments', href: '/vulnerabilities/departments', icon: Users, requiredPermissions: ['vulnerabilities:remediation:*'] },
      // { name: 'Reports', href: '/vulnerabilities/reports', icon: FileText, requiredPermissions: ['vulnerabilities:reports:*'] },
      { name: 'SLA Config', href: '/vulnerabilities/sla', icon: Clock, requiredPermissions: ['vulnerabilities:sla_management:*'] },
    ],
  },
  {
    name: 'Scanner Integration',
    icon: Wifi,
    requiredModules: ['integrations'],
    items: [
      { name: 'Connections', href: '/integrations/connections', icon: Wifi, requiredPermissions: ['integrations:connections:*'] },
      { name: 'Exceptions', href: '/integrations/exceptions', icon: AlertTriangle, requiredPermissions: ['integrations:exceptions:*'] },
      { name: 'Analytics', href: '/integrations', icon: BarChart3, requiredPermissions: ['integrations:analytics:*'] },
    ],
  },
  {
    name: 'Assets',
    icon: Server,
    requiredModules: ['assets'],
    items: [
      { name: 'IT Assets', href: '/assets', icon: Server, requiredPermissions: ['assets:asset_inventory:*'] },
    ],
  },
  {
    name: 'IS Projects',
    icon: FolderKanban,
    requiredModules: ['is_projects'],
    items: [
      { name: 'Projects', href: '/is-projects', icon: FolderKanban, requiredPermissions: ['is_projects:projects:*'] },
      { name: 'Portfolio Dashboard', href: '/is-projects/dashboard', icon: BarChart3, requiredPermissions: ['is_projects:dashboard:view'] },
      { name: 'My Projects', href: '/is-projects/my-projects', icon: Users, requiredPermissions: ['is_projects:projects:view'] },
    ],
  },
  {
    name: 'Critical Tasks',
    icon: ListTodo,
    requiredModules: ['critical_tasks'],
    items: [
      { name: 'Task Board', href: '/tasks', icon: ListTodo, requiredPermissions: ['critical_tasks:tasks:*'] },
      { name: 'My Tasks', href: '/tasks/my-tasks', icon: Target, requiredPermissions: ['critical_tasks:tasks:view'] },
      { name: 'Reports', href: '/tasks/reports', icon: BarChart3, requiredPermissions: ['critical_tasks:reports:view'] },
    ],
  },
  {
    name: 'Workflow Engine',
    href: '/workflow-engine',
    icon: GitPullRequest,
    requiredPermissions: ['workflow_engine:definitions:*', 'workflow_engine:executions:*']
  },
  { name: 'ComplyChat', href: '/complychat', icon: Bot, requiredPermissions: ['dashboard:ai_insights:*'] },
  {
    name: 'Administration',
    icon: Settings,
    adminOnly: true,
    requiredModules: ['admin'],
    items: [
      { name: 'Overview', href: '/admin', icon: Settings, requiredPermissions: ['admin:organization:*'] },
      { name: 'Company', href: '/admin/organization', icon: Server, requiredPermissions: ['admin:organization:*'] },
      { name: 'User Management', href: '/admin/users', icon: Users, requiredPermissions: ['admin:users:*'] },
      { name: 'Role Management', href: '/admin/roles', icon: Shield, requiredPermissions: ['admin:roles:*'] },
      { name: 'Audit Logs', href: '/admin/audit-logs', icon: FileText, requiredPermissions: ['admin:audit_logs:*'] },
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
        'group flex items-center gap-2.5 rounded-[var(--radius-md)] border-l-[3px] px-2.5 py-1.5 text-[12px] font-normal transition-all duration-150',
        isActive 
          ? 'border-[var(--sidebar-active-border)] bg-[var(--sidebar-active-bg)] text-[var(--color-on-base)] font-medium' 
          : 'border-transparent text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]',
        collapsed && 'justify-center px-2'
      )}
      title={collapsed ? item.name : undefined}
    >
      <item.icon
        {...navIconProps}
        className={clsx(
          'flex-shrink-0 transition-colors duration-150',
          isActive ? 'text-[var(--color-on-base)]' : 'text-[var(--sidebar-icon)] group-hover:text-[var(--color-text)]'
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
            'flex items-center justify-center w-full rounded-[var(--radius-md)] border-l-[3px] p-2 transition-all duration-150',
            isAnyChildActive 
              ? 'border-[var(--sidebar-active-border)] bg-[var(--sidebar-active-bg)] text-[var(--color-on-base)]'
              : 'border-transparent text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
          )}
        >
          <group.icon {...navIconProps} className="text-[var(--sidebar-icon)] group-hover:text-[var(--color-text)]" />
        </button>
        <div className="absolute left-full top-0 ml-2 hidden group-hover/nav:block z-50">
          <div className="min-w-[200px] rounded-[var(--radius-lg)] border border-slate-200 bg-white shadow-elevated py-1.5">
            <div className="px-3 py-1 text-[9px] font-normal uppercase tracking-[0.12em] text-[var(--sidebar-text-section)]">
              {group.name}
            </div>
            {group.items.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'flex items-center gap-2 border-l-[3px] px-3 py-1.5 text-[12px] transition-colors',
                  pathname === item.href || pathname.startsWith(item.href + '/')
                    ? 'border-[var(--sidebar-active-border)] bg-[var(--sidebar-active-bg)] text-[var(--color-on-base)]'
                    : 'border-transparent text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
                )}
              >
                <item.icon {...navIconProps} className="text-[var(--sidebar-icon)]" />
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
          'group flex w-full items-center gap-2.5 rounded-[var(--radius-md)] border-l-[3px] px-2.5 py-1.5 text-[9px] font-normal uppercase tracking-[0.12em] transition-all duration-150',
          isAnyChildActive
            ? 'border-[var(--sidebar-active-border)] bg-[var(--sidebar-active-bg)] text-[var(--color-on-base)]'
            : 'border-transparent text-[var(--sidebar-text-section)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
        )}
      >
        <group.icon
          {...navIconProps}
          className={clsx(
            'flex-shrink-0 transition-colors duration-150',
            isAnyChildActive ? 'text-[var(--color-on-base)]' : 'text-[var(--sidebar-icon)] group-hover:text-[var(--color-text)]'
          )} 
        />
        <span className="flex-1 text-left truncate">{group.name}</span>
        <ChevronDown
          {...navIconProps}
          className={clsx(
            'text-[var(--sidebar-icon)] transition-transform duration-200',
            isOpen ? '' : '-rotate-90'
          )}
        />
      </button>
      {isOpen && (
        <div className="ml-3 space-y-0.5 border-l border-[var(--sidebar-hover-bg)] pl-3">
          {group.items.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'group flex items-center gap-2.5 rounded-[var(--radius-md)] border-l-[3px] px-2.5 py-1.5 text-[11px] transition-all duration-150',
                (pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/')))
                  ? 'border-[var(--sidebar-active-border)] bg-[var(--sidebar-active-bg)] text-[var(--color-on-base)] font-medium'
                  : 'border-transparent text-[var(--sidebar-text-subitem)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
              )}
            >
              <item.icon
                {...navIconProps}
                className={clsx(
                  'flex-shrink-0',
                  (pathname === item.href || pathname.startsWith(item.href + '/'))
                    ? 'text-[var(--color-on-base)]' 
                    : 'text-[var(--sidebar-icon)] group-hover:text-[var(--color-text)]'
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
  const [allowedPermissions, setAllowedPermissions] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const adminDefaultModules = [
    'dashboard', 'risks', 'erm', 'controls', 'compliance', 'evidence', 'governance',
    'vulnerabilities', 'assets', 'frameworks', 'reports', 'admin', 'workflow_engine', 'integrations',
    'is_projects', 'critical_tasks'
  ];

  const authenticatedDefaultModules = [
    'dashboard', 'risks', 'erm', 'controls', 'compliance', 'evidence', 'governance',
    'vulnerabilities', 'assets', 'frameworks', 'reports', 'workflow_engine', 'integrations',
    'is_projects', 'critical_tasks'
  ];

  const normalizePerm = (perm: string): string => {
    const cleaned = perm.trim();
    if (!cleaned) return '';
    return cleaned.includes('.') ? cleaned.replace(/\./g, ':') : cleaned;
  };

  const extractModuleFromPerm = (perm: string): string => {
    const normalized = normalizePerm(perm);
    return normalized.split(':')[0] || '';
  };

  useEffect(() => {
    const loadMe = async () => {
      let data: any = null;
      try {
        const res = await apiClient.get('/auth/me');
        data = res.data;
      } catch {
        // Fallback to raw fetch in case axios interceptors/session state cause an edge-case redirect
        try {
          const res = await fetch('/api/auth/me', { credentials: 'include' });
          data = await res.json();
        } catch {
          data = null;
        }
      }

      if (data?.authenticated && data.user) {
        const rawPermissions: string[] = data.user.permissions || [];
        const permissions: string[] = rawPermissions
          .filter((perm) => typeof perm === 'string')
          .map((perm) => normalizePerm(perm));
        const explicitModules: string[] = data.user.allowed_modules || [];
        const modulesFromPermissions = permissions
          .map((perm) => extractModuleFromPerm(perm))
          .filter((m) => !!m);
        const resolvedModules = Array.from(new Set([
          ...explicitModules,
          ...modulesFromPermissions,
        ]));

        // Defensive fallback: some tenants can return authenticated user with empty role payload.
        // In that case, avoid collapsing sidebar to a near-empty state.
        const hasNoAccessPayload = resolvedModules.length === 0 && permissions.length === 0;

        setAllowedModules(hasNoAccessPayload ? authenticatedDefaultModules : resolvedModules);
        setAllowedPermissions(permissions);
        const adminStatus = data.user.is_admin || false;
        setIsAdmin(adminStatus);
        
        // If admin but no modules/permissions set, initialize with all modules
        if (adminStatus && resolvedModules.length === 0) {
          setAllowedModules(adminDefaultModules);
          setAllowedPermissions(['*:*:*']);
        }
      }
      setLoaded(true);
    };

    loadMe()
      .catch((error) => {
        console.error('Failed to fetch user data:', error);
        setLoaded(true);
      });
  }, []);

  const matchesPermission = (requiredPerm: string) => {
    const required = normalizePerm(requiredPerm);

    // Admin bypass
    if (allowedPermissions.includes('*:*:*')) return true;
    
    // Exact match
    if (allowedPermissions.includes(required)) return true;
    
    // If required permission is a wildcard like "risks:risk_register:*"
    if (required.endsWith(':*')) {
      const prefix = required.slice(0, -2); // "risks:risk_register"
      // Check if user has ANY permission starting with this prefix
      return allowedPermissions.some((perm) => perm.startsWith(prefix + ':'));
    }
    
    // If required permission is specific like "risks:risk_register:view"
    // Check if user has a wildcard that covers it
    const parts = required.split(':');
    if (parts.length === 3) {
      const wildcardPerm = `${parts[0]}:${parts[1]}:*`;
      if (allowedPermissions.includes(wildcardPerm)) return true;
      
      // Also check module-level wildcard
      const moduleWildcard = `${parts[0]}:*:*`;
      if (allowedPermissions.includes(moduleWildcard)) return true;
    }
    
    return false;
  };

  const hasPermission = (required?: string[]) => {
    if (!required || required.length === 0) return true;
    if (isAdmin) return true;
    return required.some((perm) => matchesPermission(perm));
  };

  const hasModuleAccess = (required?: string[]) => {
    if (!required || required.length === 0) return true;
    if (isAdmin) return true;
    return required.some((mod) => allowedModules.includes(mod));
  };

  const canAccessItem = (item: NavItem & { requiredModules?: string[]; adminOnly?: boolean }) => {
    if (item.adminOnly && !isAdmin) return false;
    if (!hasModuleAccess(item.requiredModules)) return false;

    // Fallback for tenants where module access is populated but fine-grained permissions are empty/migrating
    if (!isAdmin && allowedModules.length > 0 && allowedPermissions.length === 0) {
      return true;
    }

    return hasPermission(item.requiredPermissions);
  };

  const filteredNavigation: NavEntry[] = loaded
    ? navigation.reduce<NavEntry[]>((acc, item) => {
        if (isGroup(item)) {
          if (item.adminOnly && !isAdmin) return acc;
          if (!hasModuleAccess(item.requiredModules)) return acc;

          const filteredItems = item.items.filter((child) => canAccessItem(child));
          if (filteredItems.length === 0) return acc;

          acc.push({ ...item, items: filteredItems });
          return acc;
        }

        if (canAccessItem(item)) {
          acc.push(item);
        }
        return acc;
      }, [])
    : [];

  return (
    <aside
      className={clsx(
        'flex flex-col bg-[var(--sidebar-bg)] border-r border-slate-200 shadow-sidebar transition-all duration-300 ease-out',
        collapsed ? 'w-[60px]' : 'w-56'
      )}
    >
      <div className={clsx(
        'h-12 flex items-center border-b border-[var(--sidebar-hover-bg)] transition-all duration-300',
        collapsed ? 'px-3 justify-center' : 'px-4'
      )}>
        <div className="flex items-center gap-2">
          <Shield {...navIconProps} className="text-[var(--color-base)] flex-shrink-0" />
          {!collapsed && (
            <span className="whitespace-nowrap text-base font-semibold text-[var(--color-text)]">Compliverse AI</span>
          )}
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto scrollbar-thin p-2.5 space-y-0.5">
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

      <div className="border-t border-[var(--sidebar-hover-bg)] p-2.5">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className={clsx(
            'flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[11px] transition-all duration-150',
            'text-[var(--sidebar-text-collapse)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]',
            collapsed && 'justify-center px-2'
          )}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronRight
            {...navIconProps}
            className={clsx(
              'transition-transform duration-300',
              !collapsed && 'rotate-180'
            )}
          />
          {!collapsed && <span className="text-xs">Collapse</span>}
        </button>
      </div>
    </aside>
  );
}
