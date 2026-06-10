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
  Layers,
  Globe,
  Calendar,
  CheckCircle,
  Bot,
  FolderKanban,
  ListTodo,
  ShieldCheck,
  // CIS integration icons
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
  requiredModules?: string[];
}

interface NavGroup {
  name: string;
  items: NavItem[];
  defaultOpen?: boolean;
  requiredModules?: string[];
  adminOnly?: boolean;
}

type NavEntry = (NavItem & { requiredModules?: string[]; adminOnly?: boolean }) | NavGroup;

const ADMIN_DEFAULT_MODULES = [
  'dashboard', 'risks', 'erm', 'controls', 'compliance', 'evidence', 'governance',
  'vulnerabilities', 'assets', 'frameworks', 'reports', 'admin', 'workflow_engine', 'integrations',
  'is_projects', 'critical_tasks'
];

const AUTHENTICATED_DEFAULT_MODULES = [
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
    defaultOpen: true,
    requiredModules: ['governance'],
    items: [
      { name: 'Documents', href: '/governance', icon: ScrollText, requiredPermissions: ['governance:policies:*'] },
      { name: 'Attestations', href: '/governance/attestations', icon: ClipboardCheck, requiredPermissions: ['governance:attestations:*'] },
      { name: 'Regulatory Changes', href: '/governance/regulatory-changes', icon: GitPullRequest, requiredPermissions: ['governance:regulatory_changes:*'] },
      { name: 'Regulatory Feeds', href: '/governance/regulatory-feeds', icon: Rss, requiredPermissions: ['governance:regulatory_changes:*'] },
      { name: 'Committees', href: '/governance/committees', icon: Users, requiredPermissions: ['governance:committees:*'] },
    ],
  },
  {
    name: 'Risk Management',
    requiredModules: ['risks', 'erm'],
    items: [
      { name: 'ERM Overview', href: '/erm', icon: BarChart3, requiredPermissions: ['erm:risks:*'] },
      { name: 'Risk Assessments', href: '/erm/risk-assessments', icon: ClipboardList, requiredPermissions: ['risks:risk_assessment:*', 'erm:rcsa:*'] },
      { name: 'Risk Register', href: '/erm/risks', icon: AlertTriangle, requiredPermissions: ['erm:risks:*'] },
      { name: 'Vendor Risk', href: '/vendor-risk', icon: Shield, requiredPermissions: ['erm:risks:*'] },
      { name: 'RCSA', href: '/risks/rcsa', icon: ClipboardList, requiredPermissions: ['erm:rcsa:*'] },
      { name: 'Internal Controls', href: '/erm/internal-controls', icon: Target, requiredPermissions: ['erm:internal_controls:*'] },
      // { name: 'KRIs', href: '/erm/kris', icon: Activity, requiredPermissions: ['erm:kris:*'] },
      // { name: 'Incidents', href: '/erm/incidents', icon: AlertCircle, requiredPermissions: ['erm:incidents:*'] },
      { name: 'Advanced Analytics', href: '/erm/analytics', icon: BarChart3, requiredPermissions: ['erm:risks:*'] },
    ],
  },
  {
    name: 'Compliance',
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
    name: 'Auditor Portal',
    href: '/auditor-portal',
    icon: ShieldCheck,
    requiredModules: ['frameworks', 'compliance'],
    requiredPermissions: ['compliance:frameworks:*'],
  },
  // IT ASSETS collapsible group — Inventory + the consolidated
  // "Compliance & Scans" entry (which mounts Compliance Overview /
  // Compliance Rules / Risk Posture / Scanners as 4 top tabs inside
  // /compliance-overview) + Criticality Assessments + the absorbed
  // Vulnerability-management items.
  {
    name: 'IT Assets',
    items: [
      { name: 'Inventory',                 href: '/assets',                       icon: Bot,        requiredPermissions: ['dashboard:assets*'] },
      // Single entry for the 4-tab Compliance & Scans hub. Standalone
      // routes (/compliance-plugins/library, /risk-posture, /admin/agents)
      // stay alive so deep-links elsewhere in the app keep working.
      { name: 'Compliance & Scans',        href: '/compliance-overview',          icon: BarChart3,  requiredPermissions: ['compliance:scan:execute', 'erm:risks:*', 'compliance:agents:manage'] },
      { name: 'Criticality Assessments',   href: '/assets/criticality-assessments', icon: ClipboardCheck, requiredPermissions: ['assets:criticality_assessments:view'] },
      { name: 'Vulnerabilities',           href: '/vulnerabilities',              icon: Bug,        requiredPermissions: ['vulnerabilities:vulnerability_register:*'], requiredModules: ['vulnerabilities'] },
      { name: 'Vulnerability Exceptions',  href: '/vulnerabilities/exceptions',   icon: FileText,   requiredPermissions: ['vulnerabilities:vulnerability_register:*'], requiredModules: ['vulnerabilities'] },
    ],
  },

  {
    name: 'Projects',
    href: '/is-projects',
    icon: FolderKanban,
    requiredModules: ['is_projects'],
    requiredPermissions: ['is_projects:projects:*', 'is_projects:dashboard:view']
  },
  {
    name: 'Critical Tasks',
    href: '/tasks',
    icon: ListTodo,
    requiredModules: ['critical_tasks'],
    requiredPermissions: ['critical_tasks:tasks:*', 'critical_tasks:reports:view']
  },
  {
    name: 'Issues',
    href: '/issues',
    icon: AlertCircle,
    requiredModules: ['issue_management'],
    requiredPermissions: ['issue_management:issues:view']
  },
  { name: 'ComplyChat', href: '/complychat', icon: Bot, requiredPermissions: ['dashboard:ai_insights:*'] },
  // Bulk Discovery's standalone sidebar entry was removed. The CIDR
  // network scanner route at /admin/discover stays alive: the Setup
  // Wizard on /admin/agents still hands off discovered hostnames into
  // the agent-enrollment flow.
  // Connect Wizard's standalone sidebar entry was removed — it now lives
  // as a button on /admin/agents. Route at /admin/integrations/connect
  // stays alive: per-asset Connect button on /assets and other entry
  // points still deep-link into it.
  // Administration was lifted out of the scrolling nav into a pinned
  // bottom popover button — see <AdministrationPopover/> further down.
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
        'group flex items-center gap-2.5 rounded-[var(--radius-md)] border-l-[3px] px-2.5 py-1.5 text-[12px] md:text-[13px] tracking-[0.01em] transition-all duration-150',
        isActive
          ? 'border-[var(--sidebar-active-border)] bg-[var(--sidebar-active-bg)] text-[var(--color-on-base)] shadow-sm font-medium'
          : 'border-transparent text-[var(--sidebar-text)] font-medium hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]',
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
  const activeChild = group.items
    .filter((item) => pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href + '/')))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const activeChildHref = activeChild?.href;
  const [isOpen, setIsOpen] = useState(group.defaultOpen !== false);

  if (collapsed) {
    return (
      <div className="relative group/nav">
        <button
          className={clsx(
            'flex items-center justify-center w-full rounded-[var(--radius-md)] border-l-[3px] p-2 transition-all duration-150',
            'border-transparent text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
          )}
          title={group.name}
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.08em]">{group.name.charAt(0)}</span>
        </button>
        <div className="absolute left-full top-0 ml-2 hidden group-hover/nav:block z-50">
          <div className="min-w-[200px] rounded-[var(--radius-lg)] border border-slate-200 bg-white shadow-elevated py-1.5">
            <div className="px-3 py-1 text-[10px] md:text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--sidebar-text-section)]">
              {group.name}
            </div>
            {group.items.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'flex items-center gap-2 border-l-[3px] px-3 py-1.5 text-[12px] md:text-[13px] font-medium tracking-[0.01em] transition-colors',
                  activeChildHref === item.href
                    ? 'border-[var(--sidebar-active-border)] bg-[var(--sidebar-active-bg)] text-[var(--color-on-base)] shadow-sm'
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
        onClick={() => setIsOpen(prev => !prev)}
        className={clsx(
          'group flex w-full items-center rounded-[var(--radius-md)] border-l-[3px] px-2.5 py-1.5 text-[10px] md:text-[11px] font-bold uppercase tracking-[0.12em] transition-all duration-150',
          'border-transparent text-[var(--sidebar-text-section)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
        )}
      >
        <span className="flex-1 text-left truncate">{group.name}</span>
        {isOpen
          ? <ChevronDown size={13} className="flex-shrink-0 opacity-60" />
          : <ChevronRight size={13} className="flex-shrink-0 opacity-60" />
        }
      </button>
      {isOpen && (
        <div className="ml-3 space-y-0.5 border-l border-[var(--sidebar-hover-bg)] pl-3">
          {group.items.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'group flex items-center gap-2.5 rounded-[var(--radius-md)] border-l-[3px] px-2.5 py-1.5 text-[12px] md:text-[13px] font-medium tracking-[0.01em] transition-all duration-150',
                activeChildHref === item.href
                  ? 'border-[var(--sidebar-active-border)] bg-[var(--sidebar-active-bg)] text-[var(--color-on-base)] shadow-sm'
                  : 'border-transparent text-[var(--sidebar-text-subitem)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
              )}
            >
              <item.icon
                {...navIconProps}
                className={clsx(
                  'flex-shrink-0',
                  activeChildHref === item.href
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

// ─── Administration popover ──────────────────────────────────────────────────
// The Administration entry used to live in the scrolling nav. It's now a
// pinned button at the bottom of the sidebar that opens a flyout listing
// every admin sub-section as a button. Each button deep-links to /admin
// with a ?tab=<id> query param (admin/page.tsx reads it on mount), so the
// internal admin tab bar lands on the right tab automatically.
//
// Permission gate: same as the old nav entry (adminOnly + admin module +
// any of the four broad admin permissions). The popover itself only
// renders for users who pass this check.

const ADMIN_POPOVER_ITEMS: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: 'company',          label: 'Company',            icon: Settings },
  { id: 'users',            label: 'User Management',    icon: Users },
  { id: 'roles',            label: 'Role Management',    icon: ShieldCheck },
  { id: 'teams',            label: 'Teams',              icon: Users },
  { id: 'password-policy',  label: 'Password Policy',    icon: Shield },
  { id: 'integrations',     label: 'Integrations',       icon: Bot },
  { id: 'cloud-connectors', label: 'Cloud Connectors',   icon: Globe },
  { id: 'connectors',       label: 'Connectors',         icon: Layers },
  { id: 'identity',         label: 'Identity Providers', icon: Shield },
  { id: 'workflow',         label: 'Workflow Engine',    icon: GitPullRequest },
  { id: 'audit',            label: 'Audit Logs',         icon: ScrollText },
];

function AdministrationPopover({
  collapsed,
  visible,
}: { collapsed: boolean; visible: boolean }) {
  const [open, setOpen] = useState(false);

  // Close on outside click + Escape.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target && target.closest('[data-admin-popover-root]')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!visible) return null;

  return (
    <div className="border-t border-[var(--sidebar-hover-bg)] p-2.5 relative" data-admin-popover-root>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-2 text-sm transition-all duration-150',
          open
            ? 'bg-[var(--sidebar-hover-bg)] text-[var(--color-text)]'
            : 'text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]',
          collapsed && 'justify-center px-2'
        )}
        title={collapsed ? 'Administration' : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Settings {...navIconProps} />
        {!collapsed && <span className="truncate flex-1 text-left">Administration</span>}
        {!collapsed && (
          <ChevronRight
            size={14}
            className={clsx('transition-transform duration-200', open && 'rotate-90')}
          />
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute z-50 rounded-lg border border-slate-200 bg-white shadow-xl py-1.5',
            'min-w-[220px] max-h-[70vh] overflow-y-auto',
            // Anchor: appear to the right of the sidebar, bottom-aligned
            // with the trigger so the menu grows upward.
            'left-full bottom-2 ml-2',
          )}
        >
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-100 mb-1">
            Administration
          </div>
          {ADMIN_POPOVER_ITEMS.map(({ id, label, icon: Icon }) => (
            <Link
              key={id}
              href={`/admin?tab=${id}`}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-900"
            >
              <Icon size={14} className="text-slate-500" />
              <span className="truncate">{label}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// Top-of-sidebar collapse toggle. Same chevron + label as the original
// bottom row, just relocated. Kept as its own component so the parent
// stays readable.
function CollapseToggleRow({
  collapsed,
  onToggle,
}: { collapsed: boolean; onToggle: () => void }) {
  return (
    <div className="border-b border-[var(--sidebar-hover-bg)] p-2.5">
      <button
        onClick={onToggle}
        className={clsx(
          'flex w-full items-center gap-2 rounded-[var(--radius-md)] px-2.5 py-1.5 text-[11px] transition-all duration-150',
          'text-[var(--sidebar-text-collapse)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]',
          collapsed && 'justify-center px-2'
        )}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <ChevronRight
          {...navIconProps}
          className={clsx('transition-transform duration-300', !collapsed && 'rotate-180')}
        />
        {!collapsed && <span className="text-xs">Collapse</span>}
      </button>
    </div>
  );
}


export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [allowedModules, setAllowedModules] = useState<string[]>([]);
  const [allowedPermissions, setAllowedPermissions] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const loadMe = async () => {
      let data: any = null;
      try {
        const res = await apiClient.get('/auth/me');
        data = res.data;
      } catch {
        // Fallback in case axios interceptors/session state cause an edge-case redirect.
        // authedFetch attaches Bearer + X-Tenant-Slug from localStorage so the request
        // works even when Domain=localhost cookies were rejected by the browser.
        try {
          const { authedFetch } = await import('@/lib/auth-fetch');
          const res = await authedFetch('/api/auth/me');
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

        setAllowedModules(hasNoAccessPayload ? AUTHENTICATED_DEFAULT_MODULES : resolvedModules);
        setAllowedPermissions(permissions);
        const adminStatus = data.user.is_admin || false;
        setIsAdmin(adminStatus);

        // If admin but no modules/permissions set, initialize with all modules
        if (adminStatus && resolvedModules.length === 0) {
          setAllowedModules(ADMIN_DEFAULT_MODULES);
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
        'flex flex-col bg-white border-r border-slate-200 shadow-sidebar transition-all duration-300 ease-out',
        collapsed ? 'w-[60px]' : 'w-56'
      )}
    >
      <div className={clsx(
        'h-12 flex items-center border-b border-[var(--sidebar-hover-bg)] transition-all duration-300',
        collapsed ? 'px-3 justify-center' : 'px-4'
      )}>
        <div className="flex items-center gap-2">
          {collapsed ? (
            /* Collapsed: show just styled "C" mark */
            <span className="text-base font-bold text-[var(--color-text)] select-none">C</span>
          ) : (
            <span className="whitespace-nowrap text-base font-semibold text-[var(--color-text)] flex items-baseline gap-0.5">
              Compl<span className="relative inline-block leading-none">
                <span style={{ fontVariantLigatures: 'none' }}>ı</span>
                <span
                  className="logo-dot absolute left-1/2 rounded-full"
                  style={{ top: '-3px', width: '5px', height: '5px', background: 'var(--color-base, #14b8a6)' }}
                />
              </span>verse
              <span className="ml-1 text-xs font-medium text-[var(--color-base)] opacity-70">AI</span>
            </span>
          )}
        </div>
      </div>

      {/* Collapse toggle moved from the bottom to the top — sits right
          under the brand header, above the scrolling nav. Same behaviour
          as before. */}
      <CollapseToggleRow collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />

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

      {/* Administration popover — pinned at the bottom. The old nav
          entry was `adminOnly: true`, and admins bypass module + perm
          checks, so the effective gate is just "is admin". Non-admins
          see no Administration row at all. */}
      <AdministrationPopover collapsed={collapsed} visible={loaded && isAdmin} />
    </aside>
  );
}
