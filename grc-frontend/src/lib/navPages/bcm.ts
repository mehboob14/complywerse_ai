// Navigation-registry entries of the Business Continuity pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

// Uncomment an entry when its page moves to the kit; the builder confirms (or corrects) each label, parent and `hidden` sentence against the code.
export const LEAVES: Record<string, RouteExtra> = {
  // '/bcm': { ownHeading: true },
  // '/bcm/plans': { ownHeading: true },
  // '/bcm/drills': { ownHeading: true },
};

export const PAGES: PageSpec[] = [
  // { path: '/bcm/plans/:id', label: 'Continuity plan', area: 'compliance-management', parent: '/bcm/plans', hidden: 'opens from a plan row', ownHeading: true },
  // { path: '/bcm/drills/:id', label: 'Drill', area: 'compliance-management', parent: '/bcm/drills', hidden: 'opens from a drill row', ownHeading: true },
];
