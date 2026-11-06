// Navigation-registry entries of the Compliance overview and Assessments (Cyber Security hub, NCA, Digital Operations Maturity, DPIA, PDPL, statements) pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
// R-REG (2026-11-01) declared every page of these folders, without `ownHeading` (none draws the kit head yet); the leaves' `ownHeading` lines stay commented until the page moves,
// and the builder confirms (or corrects) each label, parent and `hidden` sentence against the page.
// Query-driven views are not pages: the Cyber Security and NCA hubs keep their tab in ?tab=, and an assessment type is /assessments/<framework>.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'compliance-management';

export const LEAVES: Record<string, RouteExtra> = {
  // '/compliance': { ownHeading: true },
  // '/assessments': { ownHeading: true },
  // '/cyber-security': { ownHeading: true },
  // '/nca': { ownHeading: true },
  // '/assessments/digital_ops_maturity': { ownHeading: true },
  // '/assessments/dpia': { ownHeading: true },
  // '/assessments/pdpl': { ownHeading: true },
  '/compliance': { title: 'Compliance Overview', keywords: ['Compliance', 'Compliance dashboard'] },
  '/assessments': { title: 'Assessments Overview', keywords: ['Assessment board'] },
  '/cyber-security': { keywords: ['Cybersecurity', 'Application security', 'Security operations maturity'] },
  '/nca': { keywords: ['National Cybersecurity Authority', 'DCC', 'Audit plan'] },
  '/assessments/digital_ops_maturity': { keywords: ['DOM', 'Digital operations'] },
  '/assessments/dpia': { keywords: ['DPIA', 'PIA', 'Data protection impact assessment', 'Privacy impact assessment'] },
  '/assessments/pdpl': { keywords: ['PDPL', 'Personal Data Protection Law'] },
};

export const PAGES: PageSpec[] = [
  // One page serves every assessment type: the sidebar's DPIA / PIA, Saudi PDPL and Digital Operations Maturity entries are three addresses of it (entries of the sidebar, not pages).
  { path: '/assessments/:framework', label: 'Framework assessments', area: AREA, parent: '/assessments', hidden: 'opens from the Assessments entries of the sidebar and from the Cyber Security KPI report link of the Performance Overview' },
  { path: '/compliance/assessments', label: 'Assessment Control Center', area: AREA, parent: '/compliance', hidden: 'opens from the back links of an assessment and of Pending Approvals, and from an evidence item', keywords: ['Compliance assessments'] },
  { path: '/compliance/assessments/:id', label: 'Assessment', area: AREA, parent: '/compliance/assessments', hidden: 'opens from a Pending Approvals row, an evidence item, a report row and the inline assessment panel' },
  { path: '/compliance/assessments/approvals', label: 'Pending Approvals', area: AREA, parent: '/compliance/assessments', hidden: 'opens from the Pending approvals menu in the top bar and from an evidence item', keywords: ['Assessment approvals'] },
  { path: '/compliance/statements', label: 'Statements', area: AREA, parent: '/compliance', hidden: 'opens from the Governance Overview (Statements) and from the Documents page' },
  // The Cyber Security hub's own pages (D55): one page per assessment type, and the workspace of one assessment of a type.
  { path: '/cyber-security/questionnaires/:format', label: 'Assessment type', area: AREA, parent: '/cyber-security', hidden: 'opens from an assessment type on the Cyber Security hub', keywords: ['Questionnaire'] },
  { path: '/cyber-security/assessments/:id', label: 'Cyber Security assessment', area: AREA, parent: '/cyber-security', hidden: 'opens from an assessment on its type page and on the Cyber Security hub' },
];
