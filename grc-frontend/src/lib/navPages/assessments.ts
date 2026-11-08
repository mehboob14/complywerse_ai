// Navigation-registry entries of the Compliance overview and Assessments (Overview, All assessments, Types, the assessment page, statements) pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
// The three Assessments pages (Overview, All assessments, Types) share ONE head, "Assessments", and a strip of tabs under it (assessments/_tabs, page-local navigation, like Business Continuity). The sidebar
// still has the older leaves (Overview, Cyber Security, NCA, Digital Operations Maturity, DPIA / PIA, Saudi PDPL); the parent replaces them with three: Overview (/assessments), All assessments
// (/assessments/register) and Types (/assessments/types). The older leaves' addresses are server or client forwards now (assessments/_forward) and stay in the registry until the menu is edited.
// Query-driven views are not pages: the register keeps its filters in the address (?category= ?type= ?status= ?quick= ...), Types its tab in ?tab=.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'compliance-management';

export const LEAVES: Record<string, RouteExtra> = {
  '/compliance': { title: 'Compliance Overview', keywords: ['Compliance', 'Compliance dashboard'], ownHeading: true },
  '/assessments': { title: 'Assessments', keywords: ['Assessment board', 'Assessments overview'], ownHeading: true },
  '/cyber-security': { keywords: ['Cybersecurity', 'Application security', 'Security operations maturity'] },
  '/nca': { keywords: ['National Cybersecurity Authority', 'DCC', 'Audit plan'] },
  '/assessments/digital_ops_maturity': { keywords: ['DOM', 'Digital operations'] },
  '/assessments/dpia': { keywords: ['DPIA', 'PIA', 'Data protection impact assessment', 'Privacy impact assessment'] },
  '/assessments/pdpl': { keywords: ['PDPL', 'Personal Data Protection Law'] },
};

export const PAGES: PageSpec[] = [
  // The register and the catalogue of kinds: the parent adds them to the sidebar (Overview / All assessments / Types); until then they open from the strip of tabs under the Assessments head.
  { path: '/assessments/register', label: 'All assessments', area: AREA, parent: '/assessments', hidden: 'a tab of Assessments: every assessment of the organization, with filters, a board by status and an export', ownHeading: true, keywords: ['Assessment register', 'Waiting for me', 'Pending approvals'] },
  { path: '/assessments/types', label: 'Types', area: AREA, parent: '/assessments', hidden: 'a tab of Assessments: every kind of assessment, with Start, Upload and what each needs', ownHeading: true, keywords: ['Assessment types', 'Upload a workbook', 'NIST library', 'Questionnaires'] },
  // The old type pages (the sidebar's DPIA / PIA, Saudi PDPL and Digital Operations Maturity entries are three addresses of this one): a forward to the assessment, to Types or to the register of the kind.
  { path: '/assessments/:framework', label: 'Framework assessments', area: AREA, parent: '/assessments', hidden: 'an old address that forwards to the assessment of that kind, to Types or to All assessments; the sidebar\'s DPIA / PIA, Saudi PDPL and Digital Operations Maturity entries and the KPI report link of the Performance Overview carry it' },
  { path: '/compliance/assessments', label: 'Assessment Control Center', area: AREA, parent: '/compliance', hidden: 'an old address that forwards to Types, where the workbooks are uploaded; back links, evidence items and bookmarks carry it', keywords: ['Compliance assessments'] },
  // ONE page for every assessment (assess-workspace): the board's in-place detail, /compliance/assessments/:id and /cyber-security/assessments/:id forward to it. /assessments/a/nca is the organization's NCA workspace.
  { path: '/assessments/a/:id', label: 'Assessment', area: AREA, parent: '/assessments', hidden: 'opens from an assessment on All assessments, the Overview, Types, from Needs my action, an evidence item and a report row', ownHeading: true, keywords: ['Assessment workspace', 'NCA workspace'] },
  { path: '/compliance/assessments/:id', label: 'Assessment', area: AREA, parent: '/compliance/assessments', hidden: 'an old address that forwards to the assessment workspace; stored links, emails and bookmarks carry it' },
  { path: '/compliance/assessments/approvals', label: 'Pending Approvals', area: AREA, parent: '/compliance/assessments', hidden: 'an old address that forwards to the Waiting for me view of All assessments; the Pending approvals menu in the top bar and the inbox carry it', keywords: ['Assessment approvals'] },
  { path: '/compliance/statements', label: 'Statements', area: AREA, parent: '/compliance', hidden: 'opens from the strip under the Compliance Overview heading, the Governance Overview (Statements) and the Documents page', ownHeading: true },
  // The Cyber Security hub (forwarded to Overview, the register of a type, or Types > NIST library) and its pages: the questionnaire of a type, and the old address of an assessment.
  { path: '/cyber-security/questionnaires/:format', label: 'Assessment type', area: AREA, parent: '/cyber-security', hidden: 'opens from an assessment type on Types (the parent moves it under Types when the Cyber Security leaf goes)', keywords: ['Questionnaire'] },
  { path: '/cyber-security/assessments/:id', label: 'Cyber Security assessment', area: AREA, parent: '/cyber-security', hidden: 'an old address that forwards to the assessment workspace; stored links, emails and bookmarks carry it' },
];
