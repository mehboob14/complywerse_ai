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
  // The requirements catalogue (written, NOT enabled). No link in the app opens it (checked 2026-11-01: no href or push names it): it is reached by a typed or bookmarked address.
  // navRegistry.test.ts needs three things of a page like that: a `parent`, and that the page lights the menu entry it hangs under, and a menu entry for its root. The
  // sidebar's Evidence Management leaf (navAccess.ts, not this group's file) has no `activeMatch` for /evidence-requirements, so with `parent: '/evidence'` the test
  // "the active menu entry agrees with the trail" fails, and with no parent two more fail. To enable it: add `activeMatch: '/evidence-requirements'` to that leaf in
  // navAccess.ts, then uncomment this line (the page already draws the kit head, so the top bar will name only "Compliance Management"):
  // { path: '/evidence-requirements', label: 'Evidence requirements', area: 'compliance-management', parent: '/evidence', hidden: 'no link opens it: reached by a typed or bookmarked address', ownHeading: true },
];
