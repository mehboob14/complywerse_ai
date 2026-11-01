// Navigation-registry entries of the Frameworks pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

// Uncomment an entry when its page moves to the kit; the builder confirms (or corrects) each label, parent and `hidden` sentence against the code.
export const LEAVES: Record<string, RouteExtra> = {
  // '/frameworks/manage': { ownHeading: true },
};

export const PAGES: PageSpec[] = [
  // { path: '/frameworks/:id', label: 'Framework', area: 'compliance-management', parent: '/frameworks/manage', hidden: 'opens from the Frameworks list', ownHeading: true },
  // { path: '/frameworks/overview/:id', label: 'Framework overview', area: 'compliance-management', parent: '/frameworks/manage', hidden: 'opens from the Frameworks list', ownHeading: true },
];
