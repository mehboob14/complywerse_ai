// Navigation-registry entries of the Compliance overview and Assessments (Overview, All assessments, Types, the assessment page, statements) pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
// The three Assessments pages (Overview, All assessments, Types) share ONE head, "Assessments", and a strip of tabs under it (assessments/_tabs, page-local navigation, like Business Continuity), and they
// are the three sidebar leaves of the group since Stage 4. The older leaves (Cyber Security, NCA, Digital Operations Maturity, DPIA / PIA, Saudi PDPL) are server or client forwards (assessments/_forward):
// Cyber Security and NCA keep a page and an entry; the three type addresses are served by /assessments/:framework, whose entry stands for them.
// Query-driven views are not pages: the register keeps its filters in the address (?category= ?type= ?status= ?quick= ...), Types its tab in ?tab=.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'compliance-management';

export const LEAVES: Record<string, RouteExtra> = {
  '/compliance': { title: 'Compliance Overview', keywords: ['Compliance', 'Compliance dashboard'], ownHeading: true },
  '/assessments': { title: 'Assessments', keywords: ['Assessment board', 'Assessments overview'], ownHeading: true },
  '/assessments/register': { ownHeading: true, keywords: ['Assessment register', 'Waiting for me', 'Pending approvals'] },
  '/assessments/types': { ownHeading: true, keywords: ['Assessment types', 'Upload a workbook', 'NIST library', 'Questionnaires', 'DOM', 'Digital operations', 'Digital Operations Maturity', 'DPIA', 'PIA', 'DPIA / PIA', 'Data protection impact assessment', 'Privacy impact assessment', 'PDPL', 'Saudi PDPL', 'Personal Data Protection Law'] },
};

export const PAGES: PageSpec[] = [
  // The old type pages (the former DPIA / PIA, Saudi PDPL and Digital Operations Maturity menu entries were three addresses of this one): a forward to the assessment, to Types or to the register of the kind.
  { path: '/assessments/:framework', label: 'Framework assessments', area: AREA, parent: '/assessments', hidden: 'an old address that forwards to the assessment of that kind, to Types or to All assessments; the former DPIA / PIA, Saudi PDPL and Digital Operations Maturity menu entries, bookmarks and the KPI report link of the Performance Overview carry it' },
  { path: '/compliance/assessments', label: 'Assessment Control Center', area: AREA, parent: '/compliance', hidden: 'an old address that forwards to Types, where the workbooks are uploaded; back links, evidence items and bookmarks carry it', keywords: ['Compliance assessments'] },
  // ONE page for every assessment (assess-workspace): the board's in-place detail, /compliance/assessments/:id and /cyber-security/assessments/:id forward to it. /assessments/a/nca is the organization's NCA workspace.
  { path: '/assessments/a/:id', label: 'Assessment', area: AREA, parent: '/assessments', hidden: 'opens from an assessment on All assessments, the Overview, Types, from Needs my action, an evidence item and a report row', ownHeading: true, keywords: ['Assessment workspace', 'NCA workspace'] },
  { path: '/compliance/assessments/:id', label: 'Assessment', area: AREA, parent: '/compliance/assessments', hidden: 'an old address that forwards to the assessment workspace; stored links, emails and bookmarks carry it' },
  { path: '/compliance/assessments/approvals', label: 'Pending Approvals', area: AREA, parent: '/compliance/assessments', hidden: 'an old address that forwards to the Waiting for me view of All assessments; the Pending approvals menu in the top bar and the inbox carry it', keywords: ['Assessment approvals'] },
  { path: '/compliance/statements', label: 'Statements', area: AREA, parent: '/compliance', hidden: 'opens from the strip under the Compliance Overview heading, the Governance Overview (Statements) and the Documents page', ownHeading: true },
  // The Cyber Security hub (forwarded to Overview, the register of a type, or Types > NIST library) and its pages: the questionnaire of a type, and the old address of an assessment.
  { path: '/cyber-security', label: 'Cyber Security', area: AREA, parent: '/assessments', hidden: 'an old address that forwards to the Assessments Overview, the register of a type or Types, by its ?tab=; stored links, emails and bookmarks carry it', keywords: ['Cybersecurity', 'Application security', 'Security operations maturity'] },
  { path: '/nca', label: 'NCA', area: AREA, parent: '/assessments', hidden: 'an old address that forwards to All assessments filtered to NCA, to the assessment of the NCA workbook or to Types; stored links, emails and bookmarks carry it', keywords: ['National Cybersecurity Authority', 'DCC', 'Audit plan'] },
  { path: '/cyber-security/questionnaires/:format', label: 'Assessment type', area: AREA, parent: '/assessments/types', hidden: 'opens from an assessment type on Types', keywords: ['Questionnaire'] },
  { path: '/cyber-security/assessments/:id', label: 'Cyber Security assessment', area: AREA, parent: '/cyber-security', hidden: 'an old address that forwards to the assessment workspace; stored links, emails and bookmarks carry it' },
];
