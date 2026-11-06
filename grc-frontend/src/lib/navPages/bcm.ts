// Navigation-registry entries of the Business Continuity pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` is on every BCM page: each draws the kit's page head (PageHeader variant="page"), so the top bar names only its section ("Compliance
// Management") and the page's name is not on screen twice. The sidebar leaves keep the names the sidebar gives them (their `label` is read from navAccess.ts);
// the Overview's `title` is the label made self-sufficient ("Overview" is read out of its menu group), and it is the Overview's page heading.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

export const LEAVES: Record<string, RouteExtra> = {
  '/bcm': { title: 'Business Continuity Overview', ownHeading: true },
  '/bcm/plans': { ownHeading: true },
  '/bcm/drills': { ownHeading: true },
};

export const PAGES: PageSpec[] = [
  { path: '/bcm/plans/:id', label: 'Continuity plan', area: 'compliance-management', parent: '/bcm/plans', hidden: 'opens from a plan row, a Reports row or a plan link', ownHeading: true },
  { path: '/bcm/drills/:id', label: 'Drill', area: 'compliance-management', parent: '/bcm/drills', hidden: 'opens from a drill row, a Reports row, the Overview lists or a plan', ownHeading: true },
];
