// The sidebar's entries and who sees each one. Pure (no React), so navAccess.test.ts can check what a role sees.
// An entry is shown to an administrator, or to someone who holds one of its requiredPermissions, inside the modules and the
// client feature it names. An entry that names no permission is an administrator's: it used to be shown to everyone.
import {
  Activity, AlertCircle, AlertTriangle, BarChart3, Bookmark, Bot, Bug, Building2, CalendarClock, ClipboardCheck, ClipboardList,
  Crosshair, FileSpreadsheet, FileText, FolderKanban, Gavel, GitPullRequest, Landmark, Layers, LayoutDashboard, LifeBuoy,
  ListTodo, Radar, Rss, ScrollText, Server, ShieldAlert, ShieldCheck, Target, Users, Workflow, Zap,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  name: string;
  href: string;
  icon: LucideIcon;
  requiredPermissions?: string[];
  requiredModules?: string[];
  /** Path prefix for active-highlighting when it differs from href. */
  activeMatch?: string;
  /** A client-specific module the tenant must have (/auth/me tenant.features) — admins included. */
  requiredFeature?: string;
}

export interface NavGroup {
  name: string;
  icon?: LucideIcon;
  items: NavEntry[];   // may contain nested groups (folder -> sub-dropdown)
  defaultOpen?: boolean;
  requiredModules?: string[];
  adminOnly?: boolean;
}

export type NavEntry = (NavItem & { requiredModules?: string[]; adminOnly?: boolean }) | NavGroup;

export const navigation: NavEntry[] = [
  {
    name: 'Performance Overview',
    href: '/dashboard',
    icon: LayoutDashboard,
    requiredModules: ['dashboard'],
    requiredPermissions: ['dashboard:overview:*']
  },
  // Task Management sits where My Work did; My Work stays reachable from the dashboard.
  {
    name: 'Task Management',
    href: '/tasks',
    icon: ListTodo,
    requiredModules: ['critical_tasks'],
    requiredPermissions: ['critical_tasks:tasks:*', 'critical_tasks:reports:view']
  },
  {
    name: 'Governance',
    icon: Landmark,
    requiredModules: ['governance'],
    items: [
      { name: 'Overview', href: '/governance', icon: LayoutDashboard, requiredPermissions: ['governance:policies:*'] },
      { name: 'Documents', href: '/governance/documents', icon: ScrollText, requiredPermissions: ['governance:policies:*'] },
      { name: 'My Approvals', href: '/governance/approvals', icon: ClipboardCheck, requiredPermissions: ['governance:policies:*'] },
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
  // Scope is configured from Common controls, and checks and assurance live on
  // each control; their standalone routes still work.
  {
    name: 'Controls Automation',
    icon: Zap,
    requiredModules: ['controls'],
    items: [
      { name: 'Overview', href: '/automation/overview', icon: LayoutDashboard, requiredPermissions: ['controls:control_library:*', 'compliance:frameworks:*'] },
      { name: 'Common Controls', href: '/automation/soc2-controls', icon: Layers, requiredPermissions: ['controls:control_library:*', 'compliance:frameworks:*'] },
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
    // Cloned from Ava (the standalone cyber product) into the /cyber-assurance
    // namespace: these routes render Ava's UI on GRC's shell + DB + login.
    // Mirrors Ava's own sidebar exactly. GRC's native cyber pages
    // (/asset-discovery, /assets, /vulnerabilities, /risk-posture) stay in the
    // codebase untouched, just no longer linked from here.
    items: [
      // Performance reads every cyber module (its cards for a module the person cannot open say "unavailable"): any of their rights
      { name: 'Performance',            href: '/cyber-assurance/dashboard',       icon: LayoutDashboard, requiredPermissions: ['assets:asset_inventory:*', 'vulnerabilities:vulnerability_register:*', 'erm:risks:*'] },
      { name: 'IT Asset Discovery',     href: '/cyber-assurance/asset-discovery', icon: Radar,      requiredPermissions: ['assets:asset_inventory:*'] },
      { name: 'IT Asset Inventory',     href: '/cyber-assurance/assets',          icon: Server,     requiredPermissions: ['assets:asset_inventory:*'] },
      { name: 'Assets Risk Posture',    href: '/cyber-assurance/risk-posture',    icon: Activity,   requiredPermissions: ['erm:risks:*'] },
      { name: 'Vulnerabilities',        href: '/cyber-assurance/vulnerabilities', icon: Bug,        requiredPermissions: ['vulnerabilities:vulnerability_register:*'], requiredModules: ['vulnerabilities'] },
      { name: 'Vulnerability Scanning', href: '/cyber-assurance/scan-flows',      icon: Crosshair,  requiredPermissions: ['vulnerabilities:vulnerability_register:*'], requiredModules: ['vulnerabilities'] },
      // the catalog has no pentest key: the vulnerability register's, which its API (/pentest) checks
      { name: 'AI Pentest',             href: '/cyber-assurance/pentest',         icon: Bot,        requiredPermissions: ['vulnerabilities:vulnerability_register:*'], requiredModules: ['vulnerabilities'] },
    ],
  },
  {
    name: 'Auditor Portal',
    icon: Gavel,
    // issue_management: a role with only issue permissions still reaches the
    // Issue Register; the other items keep their own permission gates.
    requiredModules: ['frameworks', 'compliance', 'issue_management'],
    items: [
      { name: 'Portal', href: '/auditor-portal', icon: Gavel, requiredPermissions: ['compliance:frameworks:*'] },
      { name: 'Internal Audit', href: '/auditor-portal/internal-audit', icon: ClipboardCheck, requiredPermissions: ['compliance:assessments:*'] },
      { name: 'Statutory Audit', href: '/auditor-portal/statutory-audit', icon: ScrollText, requiredPermissions: ['compliance:assessments:*'] },
      // Audit Services' register — the client's monthly issue workbook, validated and reported.
      { name: 'Issue Register', href: '/auditor-portal/issue-register', icon: FileSpreadsheet, requiredPermissions: ['issue_management:issues:*'], requiredFeature: 'audit_register' },
    ],
  },
  // Reports — Analytics (Metabase) is primary for cross-module authoring;
  // Quick export keeps the native register builder for simple CSVs.
  {
    name: 'Reports',
    icon: BarChart3,
    items: [
      { name: 'Analytics', href: '/reports/analytics', icon: LayoutDashboard, activeMatch: '/reports/analytics', requiredPermissions: ['reports:analytics:*'] },
      { name: 'Quick export', href: '/reports', icon: BarChart3, requiredPermissions: ['reports:reports:*'] },
      { name: 'Saved exports', href: '/reports/saved', icon: Bookmark, requiredPermissions: ['reports:reports:*'] },
    ],
  },
  // Issues moved into "Issue & Incident Management" (top-bar quick action removed in Header.tsx).
  // ComplyChat remains the global AI assistant in the top bar.
  // Administration stays as the pinned bottom popover.
];

export function isGroup(item: NavEntry): item is NavGroup {
  return 'items' in item;
}

export function flattenLeaves(entries: NavEntry[]): NavItem[] {
  const out: NavItem[] = [];
  for (const e of entries) { if (isGroup(e)) out.push(...flattenLeaves(e.items)); else out.push(e); }
  return out;
}

// Pages with no sidebar entry, reached from the top bar or from another page, and the rights each needs
const PAGE_PERMISSIONS: Record<string, string[]> = {
  '/complychat': ['dashboard:ai_insights:view'],                          // Dashboard > ComplyChat
  '/users': ['admin:users:view'],                                         // Administration > User Management
  '/reports/dashboards': ['reports:dashboards:*'],
  '/reports/trends': ['reports:reports:*', 'reports:dashboards:*', 'reports:analytics:*'],
  '/reports/print': ['reports:reports:*'],
};

/** The permissions a page needs (any one of them): its sidebar entry's, else PAGE_PERMISSIONS'. The page guards itself with
 * them and a link to it is shown to them only; an unknown page needs what nobody but an administrator has. */
export function navPermissions(href: string): string[] {
  return PAGE_PERMISSIONS[href] ?? flattenLeaves(navigation).find((item) => item.href === href)?.requiredPermissions ?? [];
}

/** What /auth/me grants, as the sidebar reads it. */
export interface NavAccess {
  isAdmin: boolean;
  /** module:submodule:action ("*:*:*" for an administrator) */
  permissions: string[];
  modules: string[];
  /** the tenant's client-specific modules (/auth/me tenant.features) */
  features: string[];
}

export const NO_ACCESS: NavAccess = { isAdmin: false, permissions: [], modules: [], features: [] };

const normalizePerm = (perm: string): string => {
  const cleaned = perm.trim();
  if (!cleaned) return '';
  return cleaned.includes('.') ? cleaned.replace(/\./g, ':') : cleaned;
};

export function navAccessFromMe(me: any): NavAccess {
  const user = me?.authenticated ? me.user : null;
  if (!user) return NO_ACCESS;
  const permissions: string[] = (Array.isArray(user.permissions) ? user.permissions : [])
    .filter((perm: unknown): perm is string => typeof perm === 'string')
    .map(normalizePerm);
  const explicit: string[] = Array.isArray(user.allowed_modules) ? user.allowed_modules : [];
  const modules = Array.from(new Set([...explicit, ...permissions.map((perm) => perm.split(':')[0]).filter((mod) => !!mod)]));
  return { isAdmin: !!user.is_admin, permissions, modules, features: Array.isArray(me.tenant?.features) ? me.tenant.features : [] };
}

function holds(granted: string[], requiredPerm: string): boolean {
  const required = normalizePerm(requiredPerm);
  if (granted.includes('*:*:*') || granted.includes(required)) return true;
  // "risks:risk_register:*": any permission under that prefix
  if (required.endsWith(':*')) return granted.some((perm) => perm.startsWith(required.slice(0, -1)));
  // "risks:risk_register:view": a covering wildcard
  const parts = required.split(':');
  return parts.length === 3 && (granted.includes(`${parts[0]}:${parts[1]}:*`) || granted.includes(`${parts[0]}:*:*`));
}

/** The entries `access` may see; a group with no visible entry disappears. */
export function visibleNav(entries: NavEntry[], access: NavAccess): NavEntry[] {
  const inModules = (required?: string[]) => !required?.length || access.isAdmin || required.some((mod) => access.modules.includes(mod));
  return entries.reduce<NavEntry[]>((acc, entry) => {
    if (entry.adminOnly && !access.isAdmin) return acc;
    if (!inModules(entry.requiredModules)) return acc;
    if (isGroup(entry)) {
      const items = visibleNav(entry.items, access);
      if (items.length > 0) acc.push({ ...entry, items });
      return acc;
    }
    if (entry.requiredFeature && !access.features.includes(entry.requiredFeature)) return acc;
    if (access.isAdmin || (entry.requiredPermissions ?? []).some((perm) => holds(access.permissions, perm))) acc.push(entry);
    return acc;
  }, []);
}
