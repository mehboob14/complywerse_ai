// Navigation-registry entries of the Performance Overview (the dashboard) pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

// /dashboard is the sidebar leaf "Performance Overview" (navAccess.ts: `dashboard:overview:*`). Its page draws the kit's head with that name, so the top bar says nothing
// (the section is the page's own name: sectionOfEntry returns ''). The page has no sub-pages and no tabs.
export const LEAVES: Record<string, RouteExtra> = {
  '/dashboard': { ownHeading: true },
};

export const PAGES: PageSpec[] = [
];
