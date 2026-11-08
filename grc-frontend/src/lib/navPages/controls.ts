// Navigation-registry entries of the Controls Automation pages (/automation/*) and of the Control Catalog, Control Library and Control Assurance pages (/controls/*, /control-library/*), which the
// sidebar does not list: the Compliance overview's cards and the strip of those pages (Catalog | Library | Assurance) open them (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01.
// The sidebar lights the Compliance Overview for the Catalog / Library pages and the Controls Automation Overview for its standalone pages (navAccess activeMatch).
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AUTOMATION = 'controls-automation';
const COMPLIANCE = 'compliance-management';
const COMMON = '/automation/soc2-controls';
const LIBRARY = '/control-library';
const NO_LINK = 'no link opens it: reached by a typed or saved address';

export const LEAVES: Record<string, RouteExtra> = {
  // both draw the kit's page head (PageHeader variant="page"): the Overview is the worklist cockpit, Common Controls the facet explorer (soc2-controls/_explorer)
  '/automation/overview': { title: 'Controls Automation Overview', keywords: ['Common controls overview', 'Controls Automation'], ownHeading: true },
  [COMMON]: { keywords: ['SOC 2 controls', 'SCF controls', 'Secure Controls Framework', 'Control scope'], ownHeading: true },
};

export const PAGES: PageSpec[] = [
  // ---- Controls Automation ----
  // the control workspace (soc2-controls/[code]/_workspace/ControlHeader draws the kit head; its title is the control's own name, as a committee's or a project's)
  { path: `${COMMON}/:code`, label: 'Control', area: AUTOMATION, parent: COMMON, hidden: 'opens from a Controls row and from the records that link a control (evidence, documents, work, reports)', ownHeading: true },
  { path: `${COMMON}/new`, label: 'New custom control', area: AUTOMATION, parent: COMMON, hidden: 'opens from Common Controls (New control)', ownHeading: true },
  // Controls | Coverage | Mapping review: one strip on the three pages (soc2-controls/_explorer/ControlsStrip)
  { path: `${COMMON}/coverage`, label: 'Requirement coverage', area: AUTOMATION, parent: COMMON, hidden: 'opens from the strip of the Controls pages and from the Controls Automation Overview (Frameworks)', ownHeading: true },
  { path: `${COMMON}/review`, label: 'Mapping review', area: AUTOMATION, parent: COMMON, hidden: 'opens from the strip of the Controls pages and from the Controls Automation Overview (Mapping reviews)', ownHeading: true },
  // Audit periods (the page was "Assurance", nothing linked to it): periods, the frozen Statement of Applicability and its download. The Controls Automation menu should link it as a leaf "Audit periods".
  { path: '/automation/assurance', label: 'Audit periods', area: AUTOMATION, parent: '/automation/overview', hidden: 'no menu entry yet: the Controls Automation menu is to link it as "Audit periods"', ownHeading: true, keywords: ['Assurance', 'Statement of Applicability', 'SoA', 'Audit period'] },
  // Automated Checks was a developer page nothing linked to; the address forwards to Common Controls (a control's tests are on the control, the connections on the Connections page).
  { path: '/automation/checks', label: 'Automated Checks', area: AUTOMATION, parent: '/automation/overview', hidden: `${NO_LINK}: it forwards to Common Controls` },
  { path: '/automation/scope', label: 'Common Controls', area: AUTOMATION, aliasOf: COMMON },

  // ---- Control Catalog, Control Library and Control Assurance: the three surfaces of components/dashboard/ControlSurfaceTabs (Catalog | Library | Assurance), cards of the Compliance overview. Each draws the kit's page head. ----
  { path: '/controls', label: 'Control Catalog', area: COMPLIANCE, parent: '/compliance', ownHeading: true, hidden: 'opens from the Compliance overview (Controls card), the strip of the Control Library pages and the Frameworks pages (View requirements)', keywords: ['Controls', 'Internal controls'] },
  { path: '/controls/configure-frameworks', label: 'Configure Frameworks', area: COMPLIANCE, parent: '/controls', ownHeading: true, hidden: 'opens from the Control Catalog' },
  // the Workbench and the Overview were a second way into the Catalog that only linked to each other; the addresses forward to the Catalog with their query string
  { path: '/controls/overview', label: 'Controls Overview', area: COMPLIANCE, parent: '/controls', hidden: `${NO_LINK}: it forwards to the Control Catalog` },
  { path: '/controls/workbench', label: 'Controls Workbench', area: COMPLIANCE, parent: '/controls', hidden: `${NO_LINK}: it forwards to the Control Catalog` },
  { path: LIBRARY, label: 'Control Library', area: COMPLIANCE, parent: '/compliance', ownHeading: true, hidden: 'opens from the Compliance overview (Control Library card), the Performance Overview cards and the strip of the Control Catalog pages', keywords: ['Unified Control Library', 'Normalized Controls', 'Control library'] },
  { path: `${LIBRARY}/assurance`, label: 'Control Assurance', area: COMPLIANCE, parent: '/compliance', ownHeading: true, hidden: 'opens from the Performance Overview (Control Testing & Assurance card) and the strip of the Control Catalog pages', keywords: ['Control Testing & Assurance', 'Control assurance'] },
  { path: `${LIBRARY}/:id`, label: 'Control domain', area: COMPLIANCE, parent: LIBRARY, ownHeading: true, hidden: 'opens from a Control Library row and from the risks, assets and reports that link a control', keywords: ['Normalized control'] },
  { path: `${LIBRARY}/review`, label: 'Master List Review', area: COMPLIANCE, parent: LIBRARY, ownHeading: true, hidden: 'opens from the Control Library' },
  // six Library pages that no link opened (a framework comparison, a coverage matrix, evidence suggestions, gap analysis, a new-framework pipeline, templates): the addresses forward to the Library
  { path: `${LIBRARY}/compare`, label: 'Framework Comparison', area: COMPLIANCE, parent: LIBRARY, hidden: `${NO_LINK}: it forwards to the Control Library` },
  { path: `${LIBRARY}/coverage`, label: 'Compliance Coverage Matrix', area: COMPLIANCE, parent: LIBRARY, hidden: `${NO_LINK}: it forwards to the Control Library` },
  { path: `${LIBRARY}/evidence`, label: 'Evidence Suggestions & Reuse', area: COMPLIANCE, parent: LIBRARY, hidden: `${NO_LINK}: it forwards to the Control Library` },
  { path: `${LIBRARY}/gaps`, label: 'Gap Analysis', area: COMPLIANCE, parent: LIBRARY, hidden: `${NO_LINK}: it forwards to the Control Library` },
  { path: `${LIBRARY}/pipeline-lab`, label: 'New-Framework Auto-Pipeline', area: COMPLIANCE, parent: LIBRARY, hidden: `${NO_LINK}: it forwards to the Control Library` },
  { path: `${LIBRARY}/templates`, label: 'Framework Templates', area: COMPLIANCE, parent: LIBRARY, hidden: `${NO_LINK}: it forwards to the Control Library` },
];
