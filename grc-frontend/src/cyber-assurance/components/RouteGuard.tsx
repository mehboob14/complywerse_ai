'use client';

import { usePathname } from 'next/navigation';
import PermissionGuard from '@/cyber-assurance/components/ui/PermissionGuard';

// Per-route authorization. The Sidebar only HIDES nav items a user lacks permission for; it does
// NOT stop direct-URL access. Without this guard a helpdesk-only end user could type /risk-posture,
// /assets/60, etc. and see the whole security posture. This maps the current path to the SAME
// required permission the nav uses and renders PermissionGuard's 403 block when the user lacks it.
// Longest-prefix match wins so /assets/60 resolves to the /assets rule.
const ROUTE_PERMS: { prefix: string; perms: string[] }[] = [
  { prefix: '/asset-discovery', perms: ['assets:asset_inventory:*'] },
  { prefix: '/assets', perms: ['assets:asset_inventory:*'] },
  { prefix: '/licenses', perms: ['assets:asset_inventory:*'] },
  { prefix: '/risk-posture', perms: ['erm:risks:*'] },
  { prefix: '/vulnerabilities', perms: ['vulnerabilities:vulnerability_register:*'] },
  { prefix: '/advisories', perms: ['vulnerabilities:vulnerability_register:*'] },
  { prefix: '/pentest', perms: ['vulnerabilities:vulnerability_register:*'] },
  { prefix: '/reports', perms: ['assets:asset_inventory:*'] },
  // Help Desk — three areas (coordinated with the Help Desk session's nav perms). Longest-prefix
  // wins, so /helpdesk/admin and /helpdesk/portal override the /helpdesk agent-console catch-all:
  // requesters are walled from the agent console, agents from the admin area.
  { prefix: '/helpdesk/admin', perms: ['helpdesk:settings:manage'] },
  { prefix: '/helpdesk/portal', perms: ['helpdesk:requests:view_own', 'helpdesk:requests:create'] },
  { prefix: '/helpdesk', perms: ['helpdesk:tickets:view'] },
];

function requiredFor(pathname: string): string[] | null {
  const match = ROUTE_PERMS
    .filter(({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return match ? match.perms : null;
}

export default function RouteGuard({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() || '';
  const perms = requiredFor(pathname);
  if (!perms) return <>{children}</>;
  return <PermissionGuard required={perms}>{children}</PermissionGuard>;
}
