// Navigation-registry entries of the Third-Party Vendor Risk pages (see navPages/index.ts for the contract). Written by R-REG, 2026-11-01.
// The sidebar has ONE leaf (/vendor-risk, the Overview); the module draws its own 8-entry rail inside the page (vendor-risk/_lib/railModel.ts, D50) and the shell will lift that rail
// into itself, so the rail is modelled here: the four rail entries that group pages are tab strips (`tab.area` 'vendor-vendors' | 'vendor-monitoring' | 'vendor-insights' | 'vendor-setup',
// same tabs and order as RAIL; vendorRegistry.test.ts holds them equal), the three single entries (Intake, Findings, Questionnaires) and the Overview's drill-downs hang under the leaf.
// A tab's `label` is its page's heading (the sidebar-style name); `shortLabel` is the text the rail's strip shows when that differs.
// Public pages of the module (the supplier's questionnaire and the examiner link, vendor-risk/questionnaires/[token] and examiner/[token]) are outside the shell and not entries.
import type { PageSpec, RouteExtra } from '../navRegistry.ts';

const AREA = 'third-party-vendor-risk';
const V = '/vendor-risk';
const RAIL = 'a page of the Third-party risk rail';

export const LEAVES: Record<string, RouteExtra> = {
  [V]: { title: 'Third-Party Vendor Risk Overview', keywords: ['TPRM', 'Vendor risk', 'Suppliers', 'Third-party risk'] },
};

export const PAGES: PageSpec[] = [
  // ---- the Overview's drill-downs (cards of the Overview page) ----
  { path: `${V}/attention`, label: 'Needs attention', area: AREA, parent: V, hidden: 'opens from the Needs attention card of the Overview', keywords: ['Attention queue'] },
  { path: `${V}/actions`, label: 'Planned actions', area: AREA, parent: V, hidden: 'opens from the Planned actions card of the Overview' },
  // The two pages removed from the rail (D50) still forward to the Overview.
  { path: `${V}/procurement`, label: 'Third-Party Vendor Risk', area: AREA, aliasOf: V },
  { path: `${V}/shadow-saas`, label: 'Third-Party Vendor Risk', area: AREA, aliasOf: V },

  // ---- single rail entries ----
  { path: `${V}/intake`, label: 'Intake', area: AREA, parent: V, hidden: `${RAIL} (Intake); the module header's Request vendor button opens it with the request dialog`, keywords: ['Vendor requests', 'Request vendor'] },
  { path: `${V}/intake/:id`, label: 'Vendor request', area: AREA, parent: `${V}/intake`, hidden: 'opens from an Intake card and from the request dialog once a request is filed' },
  { path: `${V}/findings`, label: 'Findings', area: AREA, parent: V, hidden: `${RAIL} (Findings) and from the vendor tiles of the Risk Management Overview`, keywords: ['Vendor findings', 'Remediation'] },
  { path: `${V}/questionnaires`, label: 'Questionnaires', area: AREA, parent: V, hidden: `${RAIL} (Questionnaires)`, keywords: ['Questionnaire templates', 'Due diligence'] },
  { path: `${V}/questionnaires/:token/builder`, label: 'Questionnaire builder', area: AREA, parent: `${V}/questionnaires`, hidden: 'opens from a questionnaire (Edit or New) in Questionnaires' },

  // ---- Vendors: the Register and its tabs ----
  { path: `${V}/vendors`, label: 'Vendors', shortLabel: 'Register', area: AREA, parent: V, tab: { area: 'vendor-vendors', id: 'register', order: 1 }, keywords: ['Vendor register', 'Suppliers'] },
  { path: `${V}/assessments`, label: 'Vendor Assessments', shortLabel: 'Assessments', area: AREA, parent: `${V}/vendors`, tab: { area: 'vendor-vendors', id: 'assessments', order: 2 } },
  { path: `${V}/contracts`, label: 'Contracts', area: AREA, parent: `${V}/vendors`, tab: { area: 'vendor-vendors', id: 'contracts', order: 3 } },
  { path: `${V}/reviews`, label: 'Yearly check-ins', shortLabel: 'Check-ins', area: AREA, parent: `${V}/vendors`, tab: { area: 'vendor-vendors', id: 'check-ins', order: 4 }, keywords: ['Vendor reviews', 'Annual reviews'] },
  { path: `${V}/vendors/:id`, label: 'Vendor', area: AREA, parent: `${V}/vendors`, hidden: 'opens from a Register row and from the vendor name on most pages of the module and of the Auditor Portal' },
  { path: `${V}/vendors/:id/summary`, label: 'Vendor summary report', area: AREA, parent: `${V}/vendors`, hidden: 'opens from the vendor record\'s menu ("Summary report")' },
  { path: `${V}/assessments/:id`, label: 'Vendor assessment', area: AREA, parent: `${V}/assessments`, hidden: 'opens from a questionnaire sent to a vendor and from a vendor\'s assessment dialog' },

  // ---- Monitoring and its tabs ----
  { path: `${V}/monitoring`, label: 'Monitoring Signals', shortLabel: 'Signals', area: AREA, parent: V, tab: { area: 'vendor-monitoring', id: 'signals', order: 1 }, keywords: ['Monitoring', 'Continuous monitoring'] },
  { path: `${V}/alerts`, label: 'Breach alerts', area: AREA, parent: `${V}/monitoring`, tab: { area: 'vendor-monitoring', id: 'alerts', order: 2 } },
  { path: `${V}/security`, label: 'Security ratings', area: AREA, parent: `${V}/monitoring`, tab: { area: 'vendor-monitoring', id: 'security', order: 3 } },
  { path: `${V}/technology`, label: 'Technology', area: AREA, parent: `${V}/monitoring`, tab: { area: 'vendor-monitoring', id: 'technology', order: 4 }, keywords: ['Vendor technology', 'Technology stack'] },
  { path: `${V}/concentration`, label: 'Concentration', area: AREA, parent: `${V}/monitoring`, tab: { area: 'vendor-monitoring', id: 'concentration', order: 5 }, keywords: ['Concentration risk', 'Subprocessors'] },

  // ---- Insights and its tabs ----
  { path: `${V}/risk-360`, label: 'Risk 360°', area: AREA, parent: V, tab: { area: 'vendor-insights', id: 'risk-360', order: 1 }, keywords: ['Risk 360', 'Insights'] },
  { path: `${V}/comply-analysis`, label: 'Loss quantification', area: AREA, parent: `${V}/risk-360`, tab: { area: 'vendor-insights', id: 'comply-analysis', order: 2 }, keywords: ['Comply analysis', 'Comply analyses', 'FAIR'] },
  { path: `${V}/reports`, label: 'Reports', area: AREA, parent: `${V}/risk-360`, tab: { area: 'vendor-insights', id: 'reports', order: 3 }, keywords: ['Vendor reports'] },
  { path: `${V}/exchange`, label: 'Shared assessments', area: AREA, parent: `${V}/risk-360`, tab: { area: 'vendor-insights', id: 'exchange', order: 4 }, keywords: ['Vendor Exchange', 'Exchange'] },
  { path: `${V}/comply-analysis/:id`, label: 'Loss quantification', area: AREA, parent: `${V}/comply-analysis`, hidden: 'opens from a row of Loss quantification' },
  { path: `${V}/reports/:id`, label: 'Vendor report', area: AREA, parent: `${V}/reports`, hidden: 'opens from a kept report in Reports, and straight after one is generated' },

  // ---- Setup and its tabs ----
  { path: `${V}/roster`, label: 'Roster', area: AREA, parent: V, tab: { area: 'vendor-setup', id: 'roster', order: 1 }, keywords: ['Reviewers', 'Vendor roster'] },
  { path: `${V}/policy`, label: 'Policy', area: AREA, parent: `${V}/roster`, tab: { area: 'vendor-setup', id: 'policy', order: 2 }, keywords: ['Vendor policy', 'Alert rules', 'Tiers'] },
  { path: `${V}/settings`, label: 'Third-party risk settings', shortLabel: 'Settings', area: AREA, parent: `${V}/roster`, tab: { area: 'vendor-setup', id: 'settings', order: 3 }, keywords: ['Vendor settings'] },
  { path: `${V}/settings/emails`, label: 'Emails', area: AREA, parent: `${V}/settings`, hidden: 'opens from Third-party risk settings (the emails link)', keywords: ['Vendor emails'] },
  // The alert rules moved into the Policy page (its #alert-rules section); the old address forwards there.
  { path: `${V}/settings/alert-rules`, label: 'Policy', area: AREA, aliasOf: `${V}/policy` },
];
