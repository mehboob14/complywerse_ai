// Navigation-registry entries of the Controls Automation pages (/automation/*) and of the Control Catalog and Control Library pages (/controls/*, /control-library/*), which the
// sidebar does not list: the Compliance overview's cards and the Control Catalog's tabs open them (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01.
// The sidebar lights the Compliance Overview for the Catalog / Library pages and the Controls Automation Overview for its standalone pages (navAccess activeMatch).
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AUTOMATION = 'controls-automation';
const COMPLIANCE = 'compliance-management';
const COMMON = '/automation/soc2-controls';
const LIBRARY = '/control-library';
const NO_LINK = 'no link opens it: reached by a typed or saved address';

export const LEAVES: Record<string, RouteExtra> = {
  '/automation/overview': { title: 'Controls Automation Overview', keywords: ['Common controls overview', 'Controls Automation'] },
  [COMMON]: { keywords: ['SOC 2 controls', 'SCF controls', 'Secure Controls Framework', 'Control scope'] },
};

export const PAGES: PageSpec[] = [
  // ---- Controls Automation ----
  { path: `${COMMON}/:code`, label: 'Common control', area: AUTOMATION, parent: COMMON, hidden: 'opens from a Common Controls row and from the records that link a control (evidence, documents, work, reports)' },
  { path: `${COMMON}/new`, label: 'New custom control', area: AUTOMATION, parent: COMMON, hidden: 'opens from Common Controls (New custom control)' },
  { path: `${COMMON}/coverage`, label: 'Requirement coverage', area: AUTOMATION, parent: COMMON, hidden: 'opens from the Controls Automation Overview (the coverage button and card) and from Common Controls' },
  { path: `${COMMON}/review`, label: 'Mapping review', area: AUTOMATION, parent: COMMON, hidden: 'opens from the Controls Automation Overview (the mapping review button and card) and from Common Controls' },
  // Checks and assurance live on each control; their standalone pages still work (navAccess.ts). The scope page forwards to Common Controls, where the scope is configured.
  { path: '/automation/assurance', label: 'Assurance', area: AUTOMATION, parent: '/automation/overview', hidden: `${NO_LINK} (assurance lives on each control)` },
  { path: '/automation/checks', label: 'Automated Checks', area: AUTOMATION, parent: '/automation/overview', hidden: `${NO_LINK} (checks live on each control)` },
  { path: '/automation/scope', label: 'Common Controls', area: AUTOMATION, aliasOf: COMMON },

  // ---- Control Catalog and Normalized Controls: the two (and Assurance) tabs of ControlSurfaceTabs, cards of the Compliance overview ----
  { path: '/controls', label: 'Control Catalog', area: COMPLIANCE, parent: '/compliance', hidden: 'opens from the Compliance overview (Controls card), the Control Library tabs and the Frameworks pages', keywords: ['Controls', 'Internal controls'] },
  { path: '/controls/configure-frameworks', label: 'Configure Frameworks', area: COMPLIANCE, parent: '/controls', hidden: 'opens from the Control Catalog' },
  { path: '/controls/overview', label: 'Controls Overview', area: COMPLIANCE, parent: '/controls', hidden: NO_LINK },
  { path: '/controls/workbench', label: 'Controls Workbench', area: COMPLIANCE, parent: '/controls', hidden: NO_LINK },
  { path: LIBRARY, label: 'Unified Control Library', area: COMPLIANCE, parent: '/compliance', hidden: 'opens from the Compliance overview (Control Library card), the Performance Overview cards and the Control Catalog tabs (Normalized Controls)', keywords: ['Normalized Controls', 'Control library'] },
  { path: `${LIBRARY}/assurance`, label: 'Control Testing & Assurance', area: COMPLIANCE, parent: '/compliance', hidden: 'opens from the Performance Overview (Control Testing & Assurance card) and the Control Catalog tabs (Assurance)', keywords: ['Control assurance'] },
  { path: `${LIBRARY}/:id`, label: 'Normalized control', area: COMPLIANCE, parent: LIBRARY, hidden: 'opens from a Unified Control Library row and from the risks, assets and reports that link a control' },
  { path: `${LIBRARY}/review`, label: 'Master List Review', area: COMPLIANCE, parent: LIBRARY, hidden: 'opens from the Unified Control Library' },
  { path: `${LIBRARY}/compare`, label: 'Framework Comparison', area: COMPLIANCE, parent: LIBRARY, hidden: NO_LINK },
  { path: `${LIBRARY}/coverage`, label: 'Compliance Coverage Matrix', area: COMPLIANCE, parent: LIBRARY, hidden: NO_LINK },
  { path: `${LIBRARY}/evidence`, label: 'Evidence Suggestions & Reuse', area: COMPLIANCE, parent: LIBRARY, hidden: NO_LINK },
  { path: `${LIBRARY}/gaps`, label: 'Gap Analysis', area: COMPLIANCE, parent: LIBRARY, hidden: NO_LINK },
  { path: `${LIBRARY}/pipeline-lab`, label: 'New-Framework Auto-Pipeline', area: COMPLIANCE, parent: LIBRARY, hidden: NO_LINK },
  { path: `${LIBRARY}/templates`, label: 'Framework Templates', area: COMPLIANCE, parent: LIBRARY, hidden: NO_LINK },
];
