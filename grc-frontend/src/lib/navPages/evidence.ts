// Navigation-registry entries of the Evidence Management pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'compliance-management';

export const LEAVES: Record<string, RouteExtra> = {
  '/evidence': { ownHeading: true },
};

export const PAGES: PageSpec[] = [
  // R-REG (2026-11-01) declared the three pages of the Evidence-details builder, without `ownHeading` (none draws the kit head yet): that builder adds the flag and confirms each label and sentence.
  { path: '/evidence/:id', label: 'Evidence item', area: AREA, parent: '/evidence', hidden: 'opens from an evidence row and from the records that link evidence (common controls, assessments, statements, risks, frameworks, the Auditor Portal, reports)' },
  { path: '/evidence/audit-packages', label: 'Audit Package Builder', area: AREA, parent: '/evidence', hidden: 'opens only from a row of the audit packages report in the Reports builder; no page of Evidence Management links it', keywords: ['Audit packages'] },
  { path: '/evidence/coverage', label: 'Evidence Coverage Dashboard', area: AREA, parent: '/evidence', hidden: 'no link opens it: reached by a typed or saved address', keywords: ['Evidence coverage'] },
  // The requirements catalogue. No link in the app opens it (checked 2026-11-01: no href or push names it): it is reached by a typed or bookmarked address. The sidebar's
  // Evidence Management leaf carries `activeMatch: '/evidence-requirements'` (navAccess.ts) so the page lights the entry it hangs under; the page draws the kit head, so the
  // top bar names only "Compliance Management".
  { path: '/evidence-requirements', label: 'Evidence requirements', area: AREA, parent: '/evidence', hidden: 'no link opens it: reached by a typed or bookmarked address', ownHeading: true },
];
