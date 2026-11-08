// Navigation-registry entries of the Risk Management (ERM) pages (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01, from the pages and the
// links that open them (G6_registry_inventory.md); the group's builder adds `ownHeading: true` to an entry the day its page draws PageHeader variant="page".
// KRIs (/erm/kris) is a sidebar leaf of the Governance group and Incidents (/erm/incidents) of Issue & Incident Management: their entries are in navRegistry.ts and issues.ts.
// The area's own tab strip (erm/layout.tsx: Risk Register, Appetite, Mitigation Actions, Reviews, Dependencies) and the RCSA strip (erm/rcsa/layout.tsx) are not
// modelled as `tab`s: nothing draws them from the registry, and the Work panel lists the area's pages (pagesForArea). The Overview leaf lights for the strip's pages (navAccess activeMatch).
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'risk-management';
const RCSA = '/erm/rcsa';
const ASSESSMENTS = '/erm/risk-assessments';
const STRIP = 'opens from the Risk Management tab strip';

export const LEAVES: Record<string, RouteExtra> = {
  '/erm': { title: 'Risk Management Overview', keywords: ['Enterprise Risk Management', 'ERM'], ownHeading: true },
  '/erm/risks': { keywords: ['Risks', 'Risk dashboard', 'Risk insights', 'Risk matrix', 'Heat map'], ownHeading: true },
  '/erm/risk-assessments': { keywords: ['Risk assessment dashboard'] },
  '/erm/rcsa': { keywords: ['RCSA Dashboard', 'Risk and control self-assessment'] },
  // Advanced Analytics is ONE page with a strip of tools (G9 monitoring): each tool keeps its address and draws the shared frame, whose head is the kit's page head.
  '/erm/analytics': { keywords: ['Advanced Risk Analytics', 'Heat map', 'Heatmap'], ownHeading: true },
  '/erm/analytics/bowtie': { keywords: ['Bow-Tie Risk Analysis', 'Bowtie'], ownHeading: true },
  '/erm/analytics/scenario': { keywords: ['What-if scenarios'], ownHeading: true },
  '/erm/kris': { ownHeading: true },
};

export const PAGES: PageSpec[] = [
  // ---- the Overview's pages: its tab strip and its tiles ----
  { path: '/erm/appetite', label: 'Risk Appetite', area: AREA, parent: '/erm', hidden: `${STRIP} (Appetite) and from the Appetite breaches tile of the Overview`, keywords: ['Appetite', 'Risk appetite', 'Risk appetite management', 'Tolerance'], ownHeading: true },
  { path: '/erm/mitigation-actions', label: 'Mitigation Actions', area: AREA, parent: '/erm', hidden: `${STRIP} and from the Overdue mitigation actions tile of the Overview`, ownHeading: true },
  { path: '/erm/reviews', label: 'Risk Reviews', area: AREA, parent: '/erm', hidden: `${STRIP} (Reviews) and from the Overdue risk reviews tile of the Overview`, keywords: ['Reviews', 'Review schedule'], ownHeading: true },
  // Dependencies became a tool of Advanced Analytics: the old address forwards to it.
  { path: '/erm/dependencies', label: 'Risk Dependencies', area: AREA, aliasOf: '/erm/analytics/dependencies' },
  { path: '/erm/reports', label: 'Reports & Analytics', area: AREA, parent: '/erm', hidden: 'no link opens it: reached by a typed or saved address (the Overview lights for it)', keywords: ['ERM reports'], ownHeading: true },
  { path: '/erm/framework-controls/:id', label: 'Framework control', area: AREA, parent: '/erm', hidden: 'no link opens it: reached by a typed or saved address (the Overview lights for it)' },
  // The Internal Controls pages were merged into the Control Catalog: both forward to it (its Internal view).
  { path: '/erm/internal-controls', label: 'Control Catalog', area: AREA, aliasOf: '/controls' },
  { path: '/erm/internal-controls/:id', label: 'Control Catalog', area: AREA, aliasOf: '/controls' },
  { path: '/erm/ai-risk-assessment', label: 'AI Risk Assessment', area: AREA, aliasOf: `${ASSESSMENTS}/ai-risk-assessment` },

  // ---- Risk Register ----
  { path: '/erm/risks/dashboard', label: 'Risk Register', area: AREA, aliasOf: '/erm/risks' },
  // The old register page forwards to the register (parameters kept: ?new=1, ?upload=1, ?edit=<id>, ?register_type=<name>); the old dashboard is its Insights view.
  { path: '/erm/risks/list', label: 'Risk Register', area: AREA, aliasOf: '/erm/risks' },
  { path: '/erm/risks/:id', label: 'Risk', area: AREA, parent: '/erm/risks', hidden: 'opens from a Risk Register row and from the records that link a risk (assets, assessments, evidence, frameworks, exceptions, reports)', ownHeading: true },
  { path: '/erm/risks/nca/:id', label: 'NCA risk entry', area: AREA, parent: '/erm/risks', hidden: 'no link opens it: reached by a typed or saved address' },

  // ---- Risk Assessments ----
  { path: `${ASSESSMENTS}/dashboard`, label: 'Risk Assessments', area: AREA, aliasOf: ASSESSMENTS },
  { path: `${ASSESSMENTS}/list`, label: 'Risk Assessments List', area: AREA, parent: ASSESSMENTS, hidden: 'opens from the Risk Assessments dashboard', keywords: ['Manual risk assessments'] },
  { path: `${ASSESSMENTS}/:id`, label: 'Risk assessment', area: AREA, parent: ASSESSMENTS, hidden: 'opens from a Risk Assessments List row (a manual assessment) and from its analytics page' },
  { path: `${ASSESSMENTS}/:id/analytics`, label: 'Risk assessment analytics', area: AREA, parent: ASSESSMENTS, hidden: 'opens from a risk assessment (its Analytics button)' },
  { path: `${ASSESSMENTS}/ai-risk-assessment`, label: 'AI Risk Assessment', area: AREA, parent: ASSESSMENTS, hidden: 'opens from the Risk Assessments tab beside it and from the Overdue AI reviews tile of the Overview' },
  { path: `${ASSESSMENTS}/framework`, label: 'Framework Risk Assessments', area: AREA, parent: ASSESSMENTS, hidden: 'opens from the Risk Assessments dashboard and from the Blocked framework questions tile of the Overview' },
  { path: `${ASSESSMENTS}/framework/:id`, label: 'Framework risk assessment', area: AREA, parent: `${ASSESSMENTS}/framework`, hidden: 'opens from the Framework Risk Assessments list, from a Risk Assessments List row and from the Auditor Portal risk tab of a framework' },

  // ---- RCSA: the page strip of erm/rcsa/layout.tsx (Dashboard, Campaigns, Assessments, Templates, Custom Templates, Findings, Approvals) ----
  { path: `${RCSA}/campaigns`, label: 'RCSA Campaigns', area: AREA, parent: RCSA, hidden: 'a page of the RCSA strip' },
  { path: `${RCSA}/campaigns/:id`, label: 'RCSA campaign', area: AREA, parent: `${RCSA}/campaigns`, hidden: 'opens from an RCSA Campaigns row and from the RCSA Dashboard' },
  { path: `${RCSA}/assessments`, label: 'RCSA Assessments', area: AREA, parent: RCSA, hidden: 'a page of the RCSA strip' },
  { path: `${RCSA}/assessments/:id`, label: 'RCSA assessment', area: AREA, parent: `${RCSA}/assessments`, hidden: 'opens from an RCSA Assessments row' },
  { path: `${RCSA}/templates`, label: 'RCSA Templates', area: AREA, parent: RCSA, hidden: 'a page of the RCSA strip' },
  { path: `${RCSA}/templates/:id`, label: 'RCSA template', area: AREA, parent: `${RCSA}/templates`, hidden: 'opens from an RCSA Templates row' },
  { path: `${RCSA}/custom-templates`, label: 'Custom RCSA Templates', area: AREA, parent: RCSA, hidden: 'a page of the RCSA strip' },
  { path: `${RCSA}/custom-templates/:id`, label: 'Custom RCSA template', area: AREA, parent: `${RCSA}/custom-templates`, hidden: 'opens from a Custom RCSA Templates row' },
  { path: `${RCSA}/findings`, label: 'RCSA Findings', area: AREA, parent: RCSA, hidden: 'a page of the RCSA strip and the RCSA open findings tile of the Overview' },
  { path: `${RCSA}/findings/:id`, label: 'RCSA finding', area: AREA, parent: `${RCSA}/findings`, hidden: 'opens from an RCSA Findings row' },
  { path: `${RCSA}/approvals`, label: 'RCSA Approvals', area: AREA, parent: RCSA, hidden: 'a page of the RCSA strip' },
  { path: `${RCSA}/approvals/:id`, label: 'RCSA approval', area: AREA, parent: `${RCSA}/approvals`, hidden: 'opens from an RCSA Approvals row' },

  // ---- Advanced Analytics: the tools of its strip (the hub page with its cards is gone; /erm/analytics is the Heat map) ----
  { path: '/erm/analytics/heatmap', label: 'Advanced Analytics', area: AREA, aliasOf: '/erm/analytics' },
  { path: '/erm/analytics/aggregation', label: 'Risk Aggregation', area: AREA, parent: '/erm/analytics', hidden: 'a tool of Advanced Analytics (its strip)', keywords: ['Aggregation', 'Risk totals'], ownHeading: true },
  { path: '/erm/analytics/kri-triggers', label: 'KRI Triggers', area: AREA, parent: '/erm/analytics', hidden: 'a tool of Advanced Analytics (its strip) and where the KRI register links the KRIs that are past a threshold', keywords: ['KRI alerts', 'Automated KRI Triggers'], ownHeading: true },
  { path: '/erm/analytics/dependencies', label: 'Risk Dependencies', area: AREA, parent: '/erm/analytics', hidden: 'a tool of Advanced Analytics (its strip); the old Dependencies address forwards here', keywords: ['Dependencies', 'Cascade analysis'], ownHeading: true },
];
