// Navigation-registry entries of the Compliance overview and Assessments (Cyber Security hub, NCA, Digital Operations Maturity, DPIA, PDPL, statements) pages (see navPages/index.ts for the contract). Owned by the builder of this group; nobody else edits it.
// `ownHeading: true` goes on a page the moment it draws the kit's page head (PageHeader variant="page"): the top bar then names only its section.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

// Uncomment an entry when its page moves to the kit; the builder confirms (or corrects) each label, parent and `hidden` sentence against the code.
export const LEAVES: Record<string, RouteExtra> = {
  // '/compliance': { ownHeading: true },
  // '/assessments': { ownHeading: true },
  // '/cyber-security': { ownHeading: true },
  // '/nca': { ownHeading: true },
  // '/assessments/digital_ops_maturity': { ownHeading: true },
  // '/assessments/dpia': { ownHeading: true },
  // '/assessments/pdpl': { ownHeading: true },
};

export const PAGES: PageSpec[] = [
  // { path: '/compliance/assessments', label: 'Assessment Control Center', area: 'compliance-management', parent: '/assessments', hidden: 'opens from Assessments', ownHeading: true },
  // { path: '/compliance/assessments/:id', label: 'Assessment', area: 'compliance-management', parent: '/compliance/assessments', hidden: 'opens from an assessment row', ownHeading: true },
  // { path: '/compliance/assessments/approvals', label: 'Pending approvals', area: 'compliance-management', parent: '/compliance/assessments', hidden: 'opens from the Assessment Control Center', ownHeading: true },
  // { path: '/compliance/statements', label: 'Statements', area: 'compliance-management', parent: '/compliance', hidden: 'opens from the Compliance overview', ownHeading: true },
];
