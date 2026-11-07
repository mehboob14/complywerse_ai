"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Shield,
  ScrollText,
  Plug,
  FileText,
  ClipboardCheck,
  Rss,
  AlertTriangle,
  Users,
  ClipboardList,
  Server,
  Radar,
  Settings,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Target,
  Activity,
  AlertCircle,
  Bug,
  GitPullRequest,
  Clock,
  Workflow,
  Calendar,
  CheckCircle,
  Bot,
  FolderKanban,
  ListTodo,
  ShieldCheck,
  Gavel,
  Landmark,
  ShieldAlert,
  LifeBuoy,
  CalendarClock,
  Zap,
  PlayCircle,
  Bookmark,
  Building2,
  Ticket,
  UsersRound,
  Contact,
  BookOpen,
  MessageSquareText,
  Home,
  KeyRound,
  type LucideIcon,
} from "lucide-react";
import { useState, useEffect } from "react";
import { clsx } from "clsx";
import { apiClient } from "@/cyber-assurance/lib/api";

const navIconProps = {
  size: 18,
  strokeWidth: 1.75,
};

interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  requiredPermissions?: string[];
  requiredModules?: string[];
  /** Path prefix for active-highlighting when it differs from href. */
  activeMatch?: string;
  /** Visible only to requester-only users: hidden for admins and for anyone who
   *  holds the agent-console permission (helpdesk:tickets:view). */
  requesterOnly?: boolean;
}

interface NavGroup {
  name: string;
  icon?: LucideIcon;
  items: NavEntry[];   // may contain nested groups (folder ΓåÆ sub-dropdown)
  defaultOpen?: boolean;
  requiredModules?: string[];
  adminOnly?: boolean;
}

type NavEntry = (NavItem & { requiredModules?: string[]; adminOnly?: boolean }) | NavGroup;

const ADMIN_DEFAULT_MODULES = [
  'dashboard', 'assets', 'vulnerabilities', 'erm', 'admin'
];

const AUTHENTICATED_DEFAULT_MODULES = [
  'dashboard', 'assets', 'vulnerabilities', 'erm'
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
  // Cross-product home — no perm gate: always visible.
  { name: 'Performance', href: '/cyber-assurance/dashboard', icon: LayoutDashboard },
  {
    name: 'IT Asset',
    icon: Server,
    items: [
      { name: 'IT Asset Discovery',        href: '/cyber-assurance/asset-discovery',               icon: Radar,         requiredPermissions: ['assets:asset_inventory:*'] },
      { name: 'IT Asset Inventory',        href: '/cyber-assurance/assets',                        icon: Server,        requiredPermissions: ['assets:asset_inventory:*'] },
      { name: 'Licenses',                  href: '/cyber-assurance/licenses',                      icon: KeyRound,      requiredPermissions: ['assets:asset_inventory:*'] },
      { name: 'Assets Risk Posture',       href: '/cyber-assurance/risk-posture',                  icon: Activity,      requiredPermissions: ['erm:risks:*'] },
    ],
  },
  {
    name: 'Cybersecurity',
    icon: ShieldCheck,
    items: [
      { name: 'Vulnerabilities',           href: '/cyber-assurance/vulnerabilities',               icon: Bug,           requiredPermissions: ['vulnerabilities:vulnerability_register:*'], requiredModules: ['vulnerabilities'] },
      { name: 'Advisories',                href: '/cyber-assurance/advisories',                    icon: AlertCircle,   requiredPermissions: ['vulnerabilities:vulnerability_register:*'], requiredModules: ['vulnerabilities'] },
      { name: 'AI Pentest',                href: '/cyber-assurance/pentest',                       icon: Bot,           activeMatch: '/pentest' },
    ],
  },
  {
    // Help Desk — ComplyVerse-native ITIL-lite service desk, one FastAPI engine
    // (modules/helpdesk_native). Findings become remediation Incidents.
    // Teams live in Administration (grc_teams); Home is dropped (Dashboard only).
    name: 'Help Desk',
    icon: LifeBuoy,
    // Role-aware (OR gate — hasPermission uses `.some`): agent-console items need
    // helpdesk:tickets:view; the three requester items need only the end-user
    // perms, so a requester-only user sees JUST those three, an agent the console.
    items: [
      // Three sub-dropdowns for the three Help Desk audiences, gated by role:
      //   Agent Console  → helpdesk:tickets:view  (agents + admin)
      //   Administration → helpdesk:settings:manage (admin / settings role)
      //   End-user Portal→ helpdesk:requests:*     (requesters; agents too when
      //                    their role carries it; admin via isAdmin superset)
      // Admin sees all three (isAdmin short-circuit in hasPermission).
      {
        name: 'Agent Console',
        icon: LayoutDashboard,
        defaultOpen: true,
        items: [
          { name: 'Dashboard',        href: '/cyber-assurance/helpdesk/dashboard',  icon: LayoutDashboard, requiredPermissions: ['helpdesk:tickets:view'] },
          { name: 'Tickets',          href: '/cyber-assurance/helpdesk/tickets',    icon: Ticket,          requiredPermissions: ['helpdesk:tickets:view'] },
          { name: 'Incidents',        href: '/cyber-assurance/helpdesk/incidents',  icon: AlertCircle,     requiredPermissions: ['helpdesk:tickets:view'] },
          { name: 'Problems',         href: '/cyber-assurance/helpdesk/problems',   icon: Bug,             requiredPermissions: ['helpdesk:tickets:view'] },
          { name: 'Changes',          href: '/cyber-assurance/helpdesk/changes',    icon: GitPullRequest,  requiredPermissions: ['helpdesk:tickets:view'] },
          { name: 'Service Requests', href: '/cyber-assurance/helpdesk/service-requests', icon: ClipboardList, requiredPermissions: ['helpdesk:tickets:view'] },
          { name: 'Agents',           href: '/cyber-assurance/helpdesk/agents',     icon: Users,           requiredPermissions: ['helpdesk:tickets:view'] },
          { name: 'Customers',        href: '/cyber-assurance/helpdesk/customers',  icon: Building2,       requiredPermissions: ['helpdesk:tickets:view'] },
          { name: 'Contacts',         href: '/cyber-assurance/helpdesk/contacts',   icon: Contact,         requiredPermissions: ['helpdesk:tickets:view'] },
          { name: 'Knowledge Base',   href: '/cyber-assurance/helpdesk/kb',         icon: BookOpen,        requiredPermissions: ['helpdesk:tickets:view'] },
          { name: 'Canned Responses', href: '/cyber-assurance/helpdesk/canned',     icon: MessageSquareText, requiredPermissions: ['helpdesk:tickets:view'] },
        ],
      },
      {
        // 'Service Desk Admin' not 'Administration' — the global platform admin
        // popover (bottom of the sidebar) is the real 'Administration'; two
        // identically-labelled entries confused QA. This is the help-desk config.
        name: 'Service Desk Admin',
        icon: Settings,
        items: [
          { name: 'Service Catalogue', href: '/cyber-assurance/helpdesk/admin/catalogue',  icon: Bookmark, requiredPermissions: ['helpdesk:settings:manage'] },
          { name: 'CMDB',              href: '/cyber-assurance/helpdesk/admin/cmdb',        icon: Server,   requiredPermissions: ['helpdesk:settings:manage'] },
          { name: 'Governance',        href: '/cyber-assurance/helpdesk/admin/governance',  icon: Shield,   requiredPermissions: ['helpdesk:settings:manage'] },
          { name: 'Settings',          href: '/cyber-assurance/helpdesk/settings',          icon: Settings, requiredPermissions: ['helpdesk:settings:manage'] },
        ],
      },
      {
        name: 'End-user Portal',
        icon: ClipboardCheck,
        items: [
          { name: 'Request something', href: '/cyber-assurance/helpdesk/portal/request',     icon: ClipboardCheck,    requiredPermissions: ['helpdesk:requests:create', 'helpdesk:requests:view_own'] },
          { name: 'My Requests',       href: '/cyber-assurance/helpdesk/portal/my-requests', icon: ListTodo,          requiredPermissions: ['helpdesk:requests:view_own', 'helpdesk:requests:create'] },
          { name: 'My Approvals',      href: '/cyber-assurance/helpdesk/portal/my-approvals', icon: ShieldCheck,      requiredPermissions: ['helpdesk:requests:view_own', 'helpdesk:requests:create'] },
          { name: 'Report an issue',   href: '/cyber-assurance/helpdesk/portal/report',      icon: MessageSquareText, requiredPermissions: ['helpdesk:requests:create', 'helpdesk:requests:view_own'] },
          { name: 'Help / Knowledge Base', href: '/cyber-assurance/helpdesk/portal/kb',      icon: BookOpen,          requiredPermissions: ['helpdesk:requests:view_own', 'helpdesk:requests:create'] },
        ],
      },
    ],
  },
  // Reports — its own top-level module.
  { name: 'Reports', href: '/cyber-assurance/reports', icon: FileText, requiredPermissions: ['assets:asset_inventory:*'] },
];

function isGroup(item: NavEntry): item is NavGroup {
  return 'items' in item;
}

// Nested-nav helpers: a group may contain sub-groups (folder ΓåÆ sub-dropdown).
function leafHrefs(entries: NavEntry[]): string[] {
  return flattenLeaves(entries).map((it) => it.href);
}
function bestActiveHref(pathname: string, items: NavItem[]): string | undefined {
  const matchPath = (it: NavItem) => it.activeMatch ?? it.href;
  return items
    .filter((it) => {
      const m = matchPath(it);
      return pathname === m || (m !== '/dashboard' && pathname.startsWith(m + '/'));
    })
    .sort((a, b) => matchPath(b).length - matchPath(a).length)
    .map((it) => it.href)[0];
}
function flattenLeaves(entries: NavEntry[]): NavItem[] {
  const out: NavItem[] = [];
  for (const e of entries) { if (isGroup(e)) out.push(...flattenLeaves(e.items)); else out.push(e); }
  return out;
}

// A nested collapsible (Assessments ΓåÆ Cyber Security ΓåÆ templates). Indented one
// level under its parent group; auto-opens when a descendant route is active.
function NavSubGroup({ group, activeHref }: { group: NavGroup; activeHref?: string }) {
  const hrefs = leafHrefs(group.items);
  const hasActive = activeHref ? hrefs.includes(activeHref) : false;
  const [open, setOpen] = useState(hasActive);
  const Icon = group.icon;
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
          hasActive ? 'font-medium text-[var(--color-text)]' : 'font-normal text-[var(--sidebar-text-subitem)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
        )}
      >
        {Icon && <Icon size={16} strokeWidth={1.75} className={clsx('flex-shrink-0', hasActive ? 'text-[var(--color-base)]' : 'text-[var(--sidebar-icon)]')} />}
        <span className="flex-1 min-w-0 truncate text-left">{group.name}</span>
        <ChevronDown size={13} className={clsx('flex-shrink-0 text-[var(--sidebar-icon)] transition-transform duration-200', !open && '-rotate-90')} />
      </button>
      <div className={clsx('grid transition-[grid-template-rows] duration-300 ease-out', open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
        <div className="overflow-hidden">
          <div className="ml-3 mt-0.5 space-y-px border-l border-[var(--sidebar-hover-bg)] pl-2.5">
            {group.items.map((item) => {
              if (isGroup(item)) {
                return <NavSubGroup key={item.name} group={item} activeHref={activeHref} />;
              }
              const childActive = activeHref === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  tabIndex={open ? 0 : -1}
                  className={clsx(
                    'group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[12.5px] transition-colors',
                    childActive ? 'bg-[var(--sidebar-active-bg)] font-medium text-[var(--color-text)]' : 'font-normal text-[var(--sidebar-text-subitem)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
                  )}
                >
                  <item.icon size={15} strokeWidth={1.75} className={clsx('flex-shrink-0', childActive ? 'text-[var(--color-base)]' : 'text-[var(--sidebar-icon)]')} />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function NavItemLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = usePathname();
  const isActive = pathname === item.href ||
    (item.href !== '/dashboard' && pathname.startsWith(item.href + '/'));

  return (
    <Link
      href={item.href}
      className={clsx(
        'group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors duration-150',
        isActive
          ? 'bg-[var(--sidebar-active-bg)] font-semibold text-[var(--color-text)]'
          : 'font-normal text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]',
        collapsed && 'justify-center px-2'
      )}
      title={collapsed ? item.name : undefined}
    >
      <item.icon
        {...navIconProps}
        className={clsx(
          'flex-shrink-0 transition-colors duration-150',
          isActive ? 'text-[var(--color-base)]' : 'text-[var(--sidebar-icon)] group-hover:text-[var(--color-text)]'
        )}
      />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.name}</span>}
    </Link>
  );
}

function NavGroupSection({ group, collapsed }: { group: NavGroup; collapsed: boolean }) {
  const pathname = usePathname();
  const activeChildHref = bestActiveHref(pathname, flattenLeaves(group.items));
  const hasActiveChild = Boolean(activeChildHref);
  // Closed by default ΓÇö only auto-open the section whose page is currently
  // active (so a deep-link still reveals its context) or one explicitly marked
  // defaultOpen.
  const [isOpen, setIsOpen] = useState(group.defaultOpen === true || hasActiveChild);
  const GroupIcon = group.icon;

  if (collapsed) {
    return (
      <div className="relative group/nav">
        <button
          className={clsx(
            'flex items-center justify-center w-full rounded-lg p-2 transition-colors duration-150',
            hasActiveChild
              ? 'bg-[var(--sidebar-active-bg)] text-[var(--color-base)]'
              : 'text-[var(--sidebar-icon)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
          )}
          title={group.name}
        >
          {GroupIcon
            ? <GroupIcon {...navIconProps} />
            : <span className="text-[11px] font-semibold">{group.name.charAt(0)}</span>}
        </button>
        <div className="absolute left-full top-0 ml-2 hidden group-hover/nav:block z-50">
          <div className="min-w-[210px] rounded-xl border border-slate-200 bg-white shadow-elevated p-1.5">
            <div className="px-2.5 py-1.5 text-[11px] font-semibold text-[var(--color-text)]">
              {group.name}
            </div>
            {flattenLeaves(group.items).map(item => (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors',
                  activeChildHref === item.href
                    ? 'bg-[var(--sidebar-active-bg)] font-semibold text-[var(--color-text)]'
                    : 'font-normal text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
                )}
              >
                <item.icon size={16} strokeWidth={1.75} className={clsx('flex-shrink-0', activeChildHref === item.href ? 'text-[var(--color-base)]' : 'text-[var(--sidebar-icon)]')} />
                {item.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className={clsx(
          'group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[14px] font-semibold transition-colors duration-150',
          hasActiveChild
            ? 'text-[var(--color-text)]'
            : 'text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
        )}
      >
        {GroupIcon && (
          <GroupIcon
            {...navIconProps}
            className={clsx('flex-shrink-0 transition-colors duration-150',
              hasActiveChild ? 'text-[var(--color-base)]' : 'text-[var(--sidebar-icon)] group-hover:text-[var(--color-text)]')}
          />
        )}
        <span className="flex-1 min-w-0 truncate text-left">{group.name}</span>
        <ChevronDown
          size={15}
          className={clsx('flex-shrink-0 text-[var(--sidebar-icon)] transition-transform duration-200', !isOpen && '-rotate-90')}
        />
      </button>

      {/* Animated open/close ΓÇö the grid-rows 0frΓåÆ1fr trick smoothly expands the
          height without measuring content, and the inner items fade + slide in
          (staggered) as the section "populates". */}
      <div
        className={clsx(
          'grid transition-[grid-template-rows] duration-300 ease-out',
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        )}
      >
        <div className="overflow-hidden">
          <div className="mt-0.5 ml-[1.6rem] space-y-px border-l border-[var(--sidebar-hover-bg)] pl-2.5">
            {group.items.map((item, idx) => {
              if (isGroup(item)) {
                return <NavSubGroup key={item.name} group={item} activeHref={activeChildHref} />;
              }
              const childActive = activeChildHref === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  tabIndex={isOpen ? 0 : -1}
                  style={{ transitionDelay: isOpen ? `${Math.min(idx, 6) * 30 + 60}ms` : '0ms' }}
                  className={clsx(
                    'group flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-all duration-200 ease-out',
                    isOpen ? 'translate-x-0 opacity-100' : '-translate-x-1 opacity-0',
                    childActive
                      ? 'bg-[var(--sidebar-active-bg)] font-medium text-[var(--color-text)]'
                      : 'font-normal text-[var(--sidebar-text-subitem)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
                  )}
                >
                  <item.icon
                    size={16}
                    strokeWidth={1.75}
                    className={clsx('flex-shrink-0',
                      childActive ? 'text-[var(--color-base)]' : 'text-[var(--sidebar-icon)] group-hover:text-[var(--color-text)]')}
                  />
                  <span className="min-w-0 flex-1 truncate">{item.name}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ΓöÇΓöÇΓöÇ Administration popover ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
// The Administration entry used to live in the scrolling nav. It's now a
// pinned button at the bottom of the sidebar that opens a flyout listing
// every admin sub-section as a button. Each button deep-links to /admin
// with a ?tab=<id> query param (admin/page.tsx reads it on mount), so the
// internal admin tab bar lands on the right tab automatically.
//
// Permission gate: same as the old nav entry (adminOnly + admin module +
// any of the four broad admin permissions). The popover itself only
// renders for users who pass this check.

// Most items deep-link into the admin tab bar via `/admin?tab=<id>`. Items
// that live at their own standalone route set `href` to override that.
const ADMIN_POPOVER_ITEMS: Array<{ id: string; label: string; icon: LucideIcon; href?: string }> = [
  { id: 'company',          label: 'Company',               icon: Settings },
  { id: 'users',            label: 'User Management',       icon: Users },
  { id: 'roles',            label: 'Role Management',       icon: ShieldCheck },
  { id: 'teams',            label: 'Teams',                 icon: Users },
  { id: 'departments',      label: 'Departments',           icon: Building2 },
  { id: 'password-policy',  label: 'Password Policy',       icon: Shield },
  // Unified Connectors tab — External Connectors, Vulnerability Scanners, Cloud,
  // Discovery Hosts and Identity/SSO now live here as categories.
  { id: 'connectors',       label: 'Connectors',            icon: Plug },
  { id: 'audit',            label: 'Audit Logs',            icon: ScrollText },
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
    <div className="border-t border-[var(--sidebar-hover-bg)] px-2.5 py-2 relative" data-admin-popover-root>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={clsx(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors duration-150',
          open
            ? 'bg-[var(--sidebar-hover-bg)] font-medium text-[var(--color-text)]'
            : 'font-normal text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]',
          collapsed && 'justify-center px-2'
        )}
        title={collapsed ? 'Administration' : undefined}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Settings {...navIconProps} className={clsx('flex-shrink-0', open ? 'text-[var(--color-base)]' : 'text-[var(--sidebar-icon)]')} />
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
          {ADMIN_POPOVER_ITEMS.map(({ id, label, icon: Icon, href }) => (
            <Link
              key={id}
              href={href ?? `/admin?tab=${id}`}
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
          const { authedFetch } = await import('@/cyber-assurance/lib/auth-fetch');
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
    if (item.requesterOnly) {
      // Requester-portal items: never for admins, never for agents (anyone who can
      // use the console). Otherwise only if the user truly holds the item's own
      // perms — deliberately NO admin shortcut here.
      if (isAdmin) return false;
      if (matchesPermission('helpdesk:tickets:view')) return false;
      return (item.requiredPermissions ?? []).some((perm) => matchesPermission(perm));
    }
    if (!hasModuleAccess(item.requiredModules)) return false;
    return hasPermission(item.requiredPermissions);
  };

  // Recursive: groups may now contain nested groups (folder ΓåÆ sub-dropdown).
  const filterEntries = (entries: NavEntry[]): NavEntry[] =>
    entries.reduce<NavEntry[]>((acc, item) => {
      if (isGroup(item)) {
        if (item.adminOnly && !isAdmin) return acc;
        if (!hasModuleAccess(item.requiredModules)) return acc;
        const kids = filterEntries(item.items);
        if (kids.length === 0) return acc;
        acc.push({ ...item, items: kids });
        return acc;
      }
      if (canAccessItem(item)) acc.push(item);
      return acc;
    }, []);
  // ComplyVerse is a cybersecurity-assurance product only. Show just that section; the
  // rest of the cloned GRC nav (Governance, Compliance, ERM, …) is hidden.
  const CYBER_SECTIONS = new Set(['Performance', 'IT Asset', 'Cybersecurity', 'Help Desk', 'Reports']);
  const filteredNavigation: NavEntry[] = loaded
    ? filterEntries(navigation).filter((e) => CYBER_SECTIONS.has(e.name))
    : [];

  return (
    <aside
      className={clsx(
        'flex flex-col bg-white border-r border-slate-200 shadow-sidebar transition-all duration-300 ease-out',
        collapsed ? 'w-[64px]' : 'w-60'
      )}
    >
      {/* Brand + collapse toggle share one row to save vertical space. */}
      <div className={clsx(
        'h-14 flex items-center border-b border-[var(--sidebar-hover-bg)] transition-all duration-300',
        collapsed ? 'justify-center px-2' : 'justify-between px-4'
      )}>
        {!collapsed && (
          <span className="whitespace-nowrap text-base font-semibold text-[var(--color-text)] flex items-baseline gap-0.5">
            ComplyVerse
            <span className="ml-1 text-xs font-medium text-[var(--color-base)] opacity-70">AI</span>
          </span>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--sidebar-icon)] transition-colors duration-150 hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronRight
            size={17}
            strokeWidth={1.75}
            className={clsx('transition-transform duration-300', !collapsed && 'rotate-180')}
          />
        </button>
      </div>

      {/* Top-aligned nav ΓÇö items start at the top (no vertical centering). */}
      <nav className="flex-1 overflow-y-auto scrollbar-thin px-2.5 py-3 space-y-1">
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

      {/* Administration popover ΓÇö pinned at the bottom. The old nav
          entry was `adminOnly: true`, and admins bypass module + perm
          checks, so the effective gate is just "is admin". Non-admins
          see no Administration row at all. */}
      <AdministrationPopover collapsed={collapsed} visible={loaded && isAdmin} />
    </aside>
  );
}
