// Navigation-registry entries of the Access Reviews pages (/compliance/access-reviews/*) and of the four old addresses under /admin that forward to them (see navPages/index.ts for the
// contract). Written by R-REG, 2026-11-01. Entries only: no file of the module is touched (another agent owns it), none draws the kit's page head (PageHeader without variant="page"), so no
// `ownHeading`. The sidebar's Access Reviews leaf lights for every page under it.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'compliance-management';
const AR = '/compliance/access-reviews';

export const LEAVES: Record<string, RouteExtra> = {
  [AR]: { keywords: ['Access review', 'User access review', 'Access certification'] },
};

export const PAGES: PageSpec[] = [
  { path: `${AR}/new`, label: 'New access review', area: AREA, parent: AR, hidden: 'opens from the Access reviews page (New access review) and from a source of Sources' },
  { path: `${AR}/connect`, label: 'Sources', area: AREA, parent: AR, hidden: 'opens from the Access reviews page and from New access review (Connect a source)', keywords: ['Connect a source', 'Access review sources'] },
  { path: `${AR}/rules`, label: 'Rule library', area: AREA, parent: AR, hidden: 'opens from a source in Sources (See the rules)', keywords: ['Access review rules'] },
  { path: `${AR}/:id`, label: 'Access review', area: AREA, parent: AR, hidden: 'opens from the Access reviews page and when a review is created' },
  // The module used to live under Administration: the old addresses forward.
  { path: '/admin/access-reviews', label: 'Access Reviews', area: AREA, aliasOf: AR },
  { path: '/admin/access-reviews/connect', label: 'Sources', area: AREA, aliasOf: `${AR}/connect` },
  { path: '/admin/access-reviews/rules', label: 'Rule library', area: AREA, aliasOf: `${AR}/rules` },
  { path: '/admin/access-reviews/:id', label: 'Access review', area: AREA, aliasOf: `${AR}/:id` },
];
