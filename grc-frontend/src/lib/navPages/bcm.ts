// Navigation-registry entries of the Business Continuity pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` is on every BCM page: each draws the kit's page head (PageHeader variant="page"), so the top bar names only its section ("Compliance
// Management") and the page's name is not on screen twice. The four list pages (Overview, Plans, Drills, Findings) share one head, "Business Continuity", and a strip of tabs under it
// (bcm/_tabs, page-local navigation). The sidebar still has three leaves (their `label` is read from navAccess.ts); the parent collapses them into ONE leaf "Business Continuity" at
// /bcm: then the entries of /bcm/plans and /bcm/drills move from LEAVES to PAGES as the /bcm/findings entry already is (label "Plans" / "Drills", parent '/bcm', hidden: a tab).
// The Overview's `title` is "Business Continuity": it is the Overview's page heading.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {
  '/bcm': { title: 'Business Continuity', ownHeading: true },
  '/bcm/plans': { ownHeading: true },
  '/bcm/drills': { ownHeading: true },
};

export const PAGES: PageSpec[] = [
  { path: '/bcm/findings', label: 'Findings', area: 'compliance-management', parent: '/bcm', hidden: 'a tab of Business Continuity: every finding of every drill, with who fixes it and by when', ownHeading: true, permissions: ['bcm:findings:*'] },
  { path: '/bcm/plans/:id', label: 'Continuity plan', area: 'compliance-management', parent: '/bcm/plans', hidden: 'opens from a plan row, a Reports row or a plan link', ownHeading: true },
  { path: '/bcm/drills/:id', label: 'Drill', area: 'compliance-management', parent: '/bcm/drills', hidden: 'opens from a drill row, a Reports row, the Overview lists or a plan', ownHeading: true },
];
