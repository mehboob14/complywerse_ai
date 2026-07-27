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
  Radar,
  Settings,
  ChevronDown,
  ChevronRight,
  BarChart3,
  Target,
  Activity,
  AlertCircle,
  Bug,
  Clock,
  Layers,
  Workflow,
  Globe,
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
  Bookmark,
  Building2,
  type LucideIcon,
} from "lucide-react";
import { useState, useEffect } from "react";
import { clsx } from "clsx";
import { apiClient } from "@/lib/api";

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
  'dashboard', 'risks', 'erm', 'controls', 'compliance', 'evidence', 'governance',
  'vulnerabilities', 'assets', 'frameworks', 'reports', 'admin', 'workflow_engine', 'integrations',
  'is_projects', 'critical_tasks', 'bcm'
];

const AUTHENTICATED_DEFAULT_MODULES = [
  'dashboard', 'risks', 'erm', 'controls', 'compliance', 'evidence', 'governance',
  'vulnerabilities', 'assets', 'frameworks', 'reports', 'workflow_engine', 'integrations',
  'is_projects', 'critical_tasks', 'bcm'
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
    name: 'Performance Overview',
    href: '/dashboard',
    icon: LayoutDashboard,
    requiredModules: ['dashboard'],
    requiredPermissions: ['dashboard:overview:*']
  },
  {
    name: 'Governance',
    icon: Landmark,
    requiredModules: ['governance'],
    items: [
      { name: 'Overview', href: '/governance', icon: LayoutDashboard, requiredPermissions: ['governance:policies:*'] },
      { name: 'Document Management', href: '/governance/documents', icon: ScrollText, requiredPermissions: ['governance:policies:*'] },
      { name: 'Committees', href: '/governance/committees', icon: Users, requiredPermissions: ['governance:committees:*'] },
      { name: 'KRIs', href: '/erm/kris', icon: Activity, requiredPermissions: ['erm:kris:*'] },
      { name: 'KPI Report', href: '/governance/kpi-report', icon: Target, requiredPermissions: ['erm:kris:*'] },
      { name: 'Projects', href: '/is-projects', icon: FolderKanban, requiredPermissions: ['is_projects:projects:*', 'is_projects:dashboard:view'] },
    ],
  },
  {
    name: 'Risk Management',
    icon: ShieldAlert,
    requiredModules: ['risks', 'erm'],
    items: [
      { name: 'Overview', href: '/erm', icon: LayoutDashboard, requiredPermissions: ['erm:risks:*'] },
      {
        name: 'Operational Risk',
        icon: Layers,
        items: [
          { name: 'Risk Register', href: '/erm/risks', icon: AlertTriangle, requiredPermissions: ['erm:risks:*'] },
          { name: 'Risk Assessments', href: '/erm/risk-assessments', icon: ClipboardList, requiredPermissions: ['risks:risk_assessment:*', 'erm:rcsa:*'] },
          { name: 'RCSA', href: '/erm/rcsa', icon: ClipboardList, requiredPermissions: ['erm:rcsa:*'] },
          // moved out of Advanced Analytics into the sidebar
          { name: 'Scenario Analysis', href: '/erm/analytics/scenario', icon: Target, requiredPermissions: ['erm:risks:*'] },
          { name: 'Bow-Tie Analysis', href: '/erm/analytics/bowtie', icon: Workflow, requiredPermissions: ['erm:risks:*'] },
          { name: 'Advanced Analytics', href: '/erm/analytics', icon: BarChart3, requiredPermissions: ['erm:risks:*'] },
        ],
      },
    ],
  },
  {
    name: 'Third-Party Vendor Risk',
    href: '/vendor-risk',
    icon: Building2,
    requiredModules: ['erm'],
    requiredPermissions: ['erm:risks:*'],
  },
  {
    name: 'Compliance Management',
    icon: ShieldCheck,
    requiredModules: ['compliance', 'controls', 'evidence', 'frameworks'],
    items: [
      { name: 'Overview', href: '/compliance', icon: LayoutDashboard, requiredPermissions: ['compliance:frameworks:*', 'controls:control_library:*', 'evidence:evidence_library:*'] },
      { name: 'Frameworks', href: '/frameworks/manage', activeMatch: '/frameworks', icon: Layers, requiredPermissions: ['compliance:frameworks:*'] },
      { name: 'Evidence Management', href: '/evidence', icon: FileText, requiredPermissions: ['evidence:evidence_library:*', 'evidence:evidence_upload:*'] },
      { name: 'Access Reviews', href: '/compliance/access-reviews', icon: Users, requiredPermissions: ['compliance:frameworks:*'] },
      { name: 'Regulatory Changes', href: '/governance/regulatory-changes', icon: GitPullRequest, requiredPermissions: ['governance:regulatory_changes:*'] },
      { name: 'Regulatory Feeds', href: '/governance/regulatory-feeds', icon: Rss, requiredPermissions: ['governance:regulatory_changes:*'] },
      {
        name: 'Assessments',
        icon: ClipboardCheck,
        items: [
          { name: 'Overview', href: '/assessments', icon: LayoutDashboard, requiredPermissions: ['compliance:assessments:*'] },
          // Cyber Security features now live on a dedicated hub page
          // (/cyber-security) instead of a nested 7-item dropdown.
          { name: 'Cyber Security', href: '/cyber-security', activeMatch: '/cyber-security', icon: ShieldAlert, requiredPermissions: ['compliance:assessments:*'] },
          // NCA features now live on a dedicated hub page (/nca) instead of a
          // nested 4-item dropdown.
          { name: 'NCA', href: '/nca', activeMatch: '/nca', icon: ShieldCheck, requiredPermissions: ['compliance:assessments:*'] },
          { name: 'Digital Operations Maturity', href: '/assessments/digital_ops_maturity', icon: Target, requiredPermissions: ['compliance:assessments:*'] },
          { name: 'DPIA / PIA', href: '/assessments/dpia', icon: ClipboardList, requiredPermissions: ['compliance:assessments:*'] },
          { name: 'Saudi PDPL', href: '/assessments/pdpl', icon: ShieldCheck, requiredPermissions: ['compliance:assessments:*'] },
        ],
      },
      {
        name: 'Business Continuity',
        icon: LifeBuoy,
        requiredModules: ['bcm'],
        items: [
          { name: 'Overview', href: '/bcm', icon: LayoutDashboard, requiredPermissions: ['bcm:dashboard:*'] },
          { name: 'Continuity Plans', href: '/bcm/plans', icon: ClipboardList, requiredPermissions: ['bcm:plans:*'] },
          { name: 'Drills & Invocations', href: '/bcm/drills', icon: CalendarClock, requiredPermissions: ['bcm:drills:*'] },
        ],
      },
    ],
  },
  {
    name: 'Control Testing & Assurance',
    icon: CheckCircle,
    requiredModules: ['controls'],
    items: [
      { name: 'Assurance Overview', href: '/control-library/assurance', icon: LayoutDashboard, requiredPermissions: ['controls:control_library:*'] },
      { name: 'Controls Overview', href: '/controls/overview', icon: Shield, requiredPermissions: ['controls:control_library:*'] },
      { name: 'Control Catalog', href: '/controls', icon: Layers, requiredPermissions: ['controls:control_library:*'] },
    ],
  },
  {
    name: 'Issue & Incident Management',
    icon: AlertCircle,
    items: [
      { name: 'Issues', href: '/issues', icon: ListTodo, requiredPermissions: ['issue_management:issues:*'] },
      { name: 'Incidents', href: '/erm/incidents', icon: AlertCircle, requiredPermissions: ['erm:incidents:*'] },
    ],
  },
  {
    name: 'Cybersecurity Assurance',
    icon: ShieldCheck,
    items: [
      // CIS Benchmark merged into IT Asset Inventory as a tab (/assets?tab=cis).
      { name: 'IT Asset Inventory',        href: '/assets',                        icon: Server,        requiredPermissions: ['assets:asset_inventory:*'] },
      // IT Asset Discovery — from feat/pdpl-ndmo-assessment.
      // Preview UI wired into nav; confirm discovery endpoints before customer demos.
      { name: 'IT Asset Discovery',        href: '/asset-discovery',               icon: Radar,         requiredPermissions: ['assets:asset_inventory:*'] },
      { name: 'Assets Risk Posture',       href: '/risk-posture',                  icon: Activity,      requiredPermissions: ['erm:risks:*'] },
      { name: 'Criticality Assessments',   href: '/assets/criticality-assessments', icon: ClipboardCheck, requiredPermissions: ['assets:criticality_assessments:view'] },
      { name: 'Vulnerabilities',           href: '/vulnerabilities',               icon: Bug,           requiredPermissions: ['vulnerabilities:vulnerability_register:*'], requiredModules: ['vulnerabilities'] },
    ],
  },
  {
    name: 'Auditor Portal',
    icon: Gavel,
    requiredModules: ['frameworks', 'compliance'],
    items: [
      { name: 'Portal', href: '/auditor-portal', icon: Gavel, requiredPermissions: ['compliance:frameworks:*'] },
      { name: 'Internal Audit', href: '/auditor-portal/internal-audit', icon: ClipboardCheck, requiredPermissions: ['compliance:assessments:*'] },
    ],
  },
  {
    name: 'Critical Tasks',
    href: '/tasks',
    icon: ListTodo,
    requiredModules: ['critical_tasks'],
    requiredPermissions: ['critical_tasks:tasks:*', 'critical_tasks:reports:view']
  },
  // Reports — built-in interactive reporting workspace across all modules.
  {
    name: 'Reports',
    icon: BarChart3,
    items: [
      { name: 'Workspace', href: '/reports', icon: BarChart3 },
      { name: 'Saved reports', href: '/reports/saved', icon: Bookmark },
    ],
  },
  // Issues moved into "Issue & Incident Management" (top-bar quick action removed in Header.tsx).
  // ComplyChat remains the global AI assistant in the top bar.
  // Administration stays as the pinned bottom popover.
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
        <span className="flex-1 text-left leading-tight break-words">{group.name}</span>
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
                  <span className="leading-tight break-words">{item.name}</span>
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
      {!collapsed && <span className="leading-tight break-words">{item.name}</span>}
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
          'group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors duration-150',
          hasActiveChild
            ? 'font-semibold text-[var(--color-text)]'
            : 'font-normal text-[var(--sidebar-text)] hover:bg-[var(--sidebar-hover-bg)] hover:text-[var(--color-text)]'
        )}
      >
        {GroupIcon && (
          <GroupIcon
            {...navIconProps}
            className={clsx('flex-shrink-0 transition-colors duration-150',
              hasActiveChild ? 'text-[var(--color-base)]' : 'text-[var(--sidebar-icon)] group-hover:text-[var(--color-text)]')}
          />
        )}
        <span className="flex-1 text-left leading-tight break-words">{group.name}</span>
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
                  <span className="leading-tight break-words">{item.name}</span>
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
  { id: 'company',          label: 'Company',            icon: Settings },
  { id: 'users',            label: 'User Management',    icon: Users },
  { id: 'ai-usage',         label: 'Token usage',        icon: BarChart3, href: '/admin/ai-usage' },
  { id: 'roles',            label: 'Role Management',    icon: ShieldCheck },
  { id: 'teams',            label: 'Teams',              icon: Users },
  { id: 'password-policy',  label: 'Password Policy',    icon: Shield },
  { id: 'integrations',     label: 'Integrations',       icon: Bot },
  { id: 'cloud-connectors', label: 'Cloud Connectors',   icon: Globe },
  { id: 'connectors',       label: 'Connectors',         icon: Layers },
  { id: 'identity',         label: 'Identity Providers', icon: Shield },
  { id: 'workflow',         label: 'Workflow Engine',    icon: GitPullRequest },
  { id: 'usage',            label: 'Usage Monitoring',   icon: Activity, href: '/admin/usage' },
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
  const filteredNavigation: NavEntry[] = loaded ? filterEntries(navigation) : [];

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
            Compliverse
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
