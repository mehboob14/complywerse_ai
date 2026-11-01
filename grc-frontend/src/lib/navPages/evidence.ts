// Navigation-registry entries of the Evidence Management pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

// Uncomment an entry when its page moves to the kit; the builder confirms (or corrects) each label, parent and `hidden` sentence against the code.
export const LEAVES: Record<string, RouteExtra> = {
  // '/evidence': { ownHeading: true },
};

export const PAGES: PageSpec[] = [
  // { path: '/evidence/:id', label: 'Evidence item', area: 'compliance-management', parent: '/evidence', hidden: 'opens from an evidence row', ownHeading: true },
  // { path: '/evidence/audit-packages', label: 'Audit packages', area: 'compliance-management', parent: '/evidence', hidden: 'opens from Evidence Management', ownHeading: true },
  // { path: '/evidence/coverage', label: 'Evidence coverage', area: 'compliance-management', parent: '/evidence', hidden: 'opens from Evidence Management', ownHeading: true },
  // { path: '/evidence-requirements', label: 'Evidence requirements', area: 'compliance-management', parent: '/evidence', hidden: 'opens from Evidence Management', ownHeading: true },
];
