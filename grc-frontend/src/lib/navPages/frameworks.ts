// Navigation-registry entries of the Frameworks pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
// R-REG (2026-11-01) declared every page of the folder, without `ownHeading` (none draws the kit head yet): the group's builder adds the flag to the entries below
// and to the leaf, and confirms (or corrects) each label, parent and `hidden` sentence against the page.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'compliance-management';
const MANAGE = '/frameworks/manage';

// The sidebar's Frameworks leaf is the Manage Frameworks page; it lights for every page under /frameworks (navAccess activeMatch).
export const LEAVES: Record<string, RouteExtra> = {
  // '/frameworks/manage': { ownHeading: true },
  [MANAGE]: { keywords: ['Manage Frameworks', 'Framework library', 'Certification journeys'] },
};

export const PAGES: PageSpec[] = [
  // The Dashboard tab beside Manage Frameworks (FrameworksTabs); the page head of both tabs is "Compliance Frameworks".
  { path: '/frameworks', label: 'Compliance Frameworks', area: AREA, parent: MANAGE, hidden: 'the Dashboard tab beside Manage Frameworks, and the Frameworks card of the Compliance overview', keywords: ['Frameworks dashboard', 'Compliance posture'] },
  { path: '/frameworks/:id', label: 'Framework', area: AREA, parent: MANAGE, hidden: 'opens from a Manage Frameworks row and from the framework cards of the Frameworks dashboard' },
  { path: '/frameworks/overview/:id', label: 'Framework overview', area: AREA, parent: MANAGE, hidden: 'opens from a framework of the library in Manage Frameworks and from the Start a journey picker' },
];
