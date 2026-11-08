// Navigation-registry entries of the Evidence Management pages (see navPages/index.ts for the contract). The sidebar's Evidence Management leaf (`/evidence`) opens the Library; the other
// pages are tabs of the strip under its head (Library, Insights, Requirements, Audit packages, Settings), which is page-local navigation (evidence/_tabs), not a registry tab strip, so
// each page here says where it opens from. `ownHeading: true` goes on a page that draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'compliance-management';

export const LEAVES: Record<string, RouteExtra> = {
  '/evidence': { ownHeading: true },
};

export const PAGES: PageSpec[] = [
  // The record page: the kit's head names the file, so the top bar names only the section.
  { path: '/evidence/:id', label: 'Evidence item', area: AREA, parent: '/evidence', hidden: 'opens from an evidence row and from the records that link evidence (common controls, assessments, statements, risks, frameworks, the Auditor Portal, reports)', ownHeading: true },
  { path: '/evidence/audit-packages', label: 'Audit packages', area: AREA, parent: '/evidence', hidden: 'a tab of the Evidence Management page; the audit packages report in Reports opens it too', keywords: ['Audit package builder'], ownHeading: true },
  // The old Evidence Coverage Dashboard: it forwards to the Insights tab, where coverage by framework is a card.
  { path: '/evidence/coverage', label: 'Evidence Coverage Dashboard', area: AREA, parent: '/evidence', hidden: 'forwards to the Insights tab of Evidence Management; an old link or bookmark lands there', keywords: ['Evidence coverage'] },
  // What each control of a framework asks you to show. A tab of the Evidence Management page; the sidebar leaf carries `activeMatch: '/evidence-requirements'` so the page lights its entry.
  { path: '/evidence-requirements', label: 'Evidence requirements', area: AREA, parent: '/evidence', hidden: 'a tab of the Evidence Management page', ownHeading: true },
];
