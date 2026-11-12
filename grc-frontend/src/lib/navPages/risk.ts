// Navigation-registry entries of the Risk Management (ERM) pages (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01, from the pages and the
// links that open them (G6_registry_inventory.md); the group's builder adds `ownHeading: true` to an entry the day its page draws PageHeader variant="page".
// The menu follows the risk lifecycle (ERM redesign, decision 3, 2026-11-11): Overview, Identify, Assess, Treat, Monitor, Report. KRIs and Loss Events (/erm/incidents) moved here
// from Governance and Issue & Incident Management; the KRIs leaf's keywords stay in navRegistry.ts (OF_LEAF). The area's tab strip (erm/layout.tsx) is gone: every page it
// listed has a leaf, except Dependencies, which hangs under the Risk Register. The RCSA strip (erm/rcsa/layout.tsx) is not modelled as `tab`s: nothing draws it from the registry.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'risk-management';
const RCSA = '/erm/rcsa';
const ASSESSMENTS = '/erm/risk-assessments';
// one Assessments entry (ERM redesign, decision 1, 2026-11-11): the Risk Assessments and RCSA pages, once two leaves, hang under it
const HUB = '/erm/assessments';

export const LEAVES: Record<string, RouteExtra> = {
  '/erm': { title: 'Risk Management Overview', keywords: ['Enterprise Risk Management', 'ERM'] },
  '/erm/risks': { keywords: ['Risks', 'Risk dashboard'] },
  [HUB]: { keywords: ['Risk Assessments', 'RCSA', 'Risk workshops', 'Self-assessments', 'Framework IT risk assessments'] },
  '/erm/analytics/bowtie': { keywords: ['Bow-Tie Risk Analysis', 'Bowtie'] },
  '/erm/analytics/scenario': { keywords: ['What-if scenarios'] },
  '/erm/mitigation-actions': { keywords: ['Mitigation Actions', 'Risk treatment'] },
  '/erm/internal-controls': { keywords: ['Internal Controls', 'Risk controls'] },
  '/erm/appetite': { keywords: ['Risk Appetite Management', 'Appetite'] },
  '/erm/incidents': { keywords: ['Incidents', 'Risk incidents', 'Incident register', 'Incident log'] },
  '/erm/reviews': { keywords: ['Reviews', 'Review schedule'] },
  '/erm/reports': { keywords: ['Reports & Analytics', 'ERM reports'] },
  '/erm/analytics': { keywords: ['Advanced Analytics', 'Advanced Risk Analytics'] },
};

export const PAGES: PageSpec[] = [
  // The Internal Controls detail page was merged into the Control Catalog: it forwards to it (its Internal view). The list page is the Treat > Controls leaf.
  { path: '/erm/internal-controls/:id', label: 'Control Catalog', area: AREA, aliasOf: '/controls' },
  { path: '/erm/ai-risk-assessment', label: 'AI Systems Risk Register', area: AREA, aliasOf: `${ASSESSMENTS}/ai-risk-assessment` },

  // ---- Risk Register ----
  { path: '/erm/risks/dashboard', label: 'Risk Register', area: AREA, aliasOf: '/erm/risks' },
  { path: '/erm/risks/list', label: 'Risk Register List', area: AREA, parent: '/erm/risks', hidden: 'opens from the Risk Register view switcher and from the Overview tiles that count open risks', keywords: ['Upload risk register'] },
  { path: '/erm/risks/:id', label: 'Risk', area: AREA, parent: '/erm/risks', hidden: 'opens from a Risk Register row and from the records that link a risk (assets, assessments, evidence, frameworks, exceptions, reports)' },
  { path: '/erm/risks/nca/:id', label: 'NCA risk entry', area: AREA, parent: '/erm/risks', hidden: 'no link opens it: reached by a typed or saved address' },
  // to become the risk record's "Related risks" tab
  { path: '/erm/dependencies', label: 'Risk Dependencies', area: AREA, parent: '/erm/risks', hidden: 'opens from the Risk Register (the Risk dependencies link above its dashboard and list)', keywords: ['Dependencies', 'Cascade analysis', 'Related risks'] },

  // ---- Risk Assessments (risk workshops and framework IT risk), under Assessments ----
  { path: ASSESSMENTS, label: 'Risk Assessments', area: AREA, parent: HUB, hidden: 'opens from an Assessments row (a risk workshop or a framework IT risk assessment) and from the tab strip of its pages', keywords: ['Risk assessment dashboard'] },
  { path: `${ASSESSMENTS}/dashboard`, label: 'Risk Assessments', area: AREA, aliasOf: ASSESSMENTS },
  { path: `${ASSESSMENTS}/list`, label: 'Risk Assessments List', area: AREA, parent: ASSESSMENTS, hidden: 'opens from the Risk Assessments dashboard', keywords: ['Manual risk assessments'] },
  { path: `${ASSESSMENTS}/:id`, label: 'Risk assessment', area: AREA, parent: ASSESSMENTS, hidden: 'opens from a Risk Assessments List row (a manual assessment) and from its analytics page' },
  { path: `${ASSESSMENTS}/:id/analytics`, label: 'Risk assessment analytics', area: AREA, parent: ASSESSMENTS, hidden: 'opens from a risk assessment (its Analytics button)' },
  { path: `${ASSESSMENTS}/ai-risk-assessment`, label: 'AI Systems Risk Register', area: AREA, parent: ASSESSMENTS, hidden: 'opens from the Risk Assessments tab beside it and from the Overdue AI reviews tile of the Overview', keywords: ['AI Risk Assessment'] },
  { path: `${ASSESSMENTS}/framework`, label: 'Framework Risk Assessments', area: AREA, parent: ASSESSMENTS, hidden: 'opens from the Risk Assessments dashboard and from the Blocked framework questions tile of the Overview' },
  { path: `${ASSESSMENTS}/framework/:id`, label: 'Framework risk assessment', area: AREA, parent: `${ASSESSMENTS}/framework`, hidden: 'opens from the Framework Risk Assessments list, from a Risk Assessments List row and from the Auditor Portal risk tab of a framework' },

  // ---- RCSA: the page strip of erm/rcsa/layout.tsx (Dashboard, Campaigns, Assessments, Templates, Imported matrices, Findings, Approvals) ----
  { path: RCSA, label: 'RCSA', area: AREA, parent: HUB, hidden: 'opens from an Assessments row (a self-assessment) and is the first page of the RCSA strip', keywords: ['RCSA Dashboard', 'Risk and control self-assessment'] },
  { path: `${RCSA}/campaigns`, label: 'RCSA Campaigns', area: AREA, parent: RCSA, hidden: 'a page of the RCSA strip' },
  { path: `${RCSA}/campaigns/:id`, label: 'RCSA campaign', area: AREA, parent: `${RCSA}/campaigns`, hidden: 'opens from an RCSA Campaigns row and from the RCSA Dashboard' },
  { path: `${RCSA}/assessments`, label: 'RCSA Assessments', area: AREA, parent: RCSA, hidden: 'a page of the RCSA strip' },
  { path: `${RCSA}/assessments/:id`, label: 'RCSA assessment', area: AREA, parent: `${RCSA}/assessments`, hidden: 'opens from an RCSA Assessments row' },
  { path: `${RCSA}/templates`, label: 'RCSA Templates', area: AREA, parent: RCSA, hidden: 'a page of the RCSA strip' },
  { path: `${RCSA}/templates/:id`, label: 'RCSA template', area: AREA, parent: `${RCSA}/templates`, hidden: 'opens from an RCSA Templates row' },
  { path: `${RCSA}/custom-templates`, label: 'Imported RCSA matrices', area: AREA, parent: RCSA, hidden: 'a page of the RCSA strip' },
  { path: `${RCSA}/custom-templates/:id`, label: 'Imported RCSA matrix', area: AREA, parent: `${RCSA}/custom-templates`, hidden: 'opens from an Imported matrices row' },
  { path: `${RCSA}/findings`, label: 'RCSA Findings', area: AREA, parent: RCSA, hidden: 'a page of the RCSA strip and the RCSA open findings tile of the Overview' },
  { path: `${RCSA}/findings/:id`, label: 'RCSA finding', area: AREA, parent: `${RCSA}/findings`, hidden: 'opens from an RCSA Findings row' },
  { path: `${RCSA}/approvals`, label: 'RCSA Approvals', area: AREA, parent: RCSA, hidden: 'a page of the RCSA strip' },
  { path: `${RCSA}/approvals/:id`, label: 'RCSA approval', area: AREA, parent: `${RCSA}/approvals`, hidden: 'opens from an RCSA Approvals row' },

  // ---- Analytics: the cards of its hub page ----
  { path: '/erm/analytics/heatmap', label: 'Interactive Risk Heat Map', area: AREA, parent: '/erm/analytics', hidden: 'opens from a card of Analytics', keywords: ['Heat map', 'Heatmap'] },
  { path: '/erm/analytics/aggregation', label: 'Risk Aggregation', area: AREA, parent: '/erm/analytics', hidden: 'opens from a card of Analytics' },
  { path: '/erm/analytics/kri-triggers', label: 'Automated KRI Triggers', area: AREA, parent: '/erm/analytics', hidden: 'opens from a card of Analytics', keywords: ['KRI alerts'] },
];
