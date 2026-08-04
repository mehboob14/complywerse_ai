// Static metadata + style helpers for the TPRA lifecycle UI.
import type { StageStatus } from './types';

export interface StageRaci {
  R: string[]; // Responsible
  A: string[]; // Accountable
  C: string[]; // Consulted
  I: string[]; // Informed
}

export interface StageMetaDef {
  key: string;
  order: number;
  label: string;
  phase: string;
  gate: boolean;
  objective: string;
  inputs: string[];        // what this stage consumes from upstream
  activities: string[];    // key activities performed in the stage
  raci: StageRaci;         // full Responsible/Accountable/Consulted/Informed split
  artifacts: string[];     // artifacts produced / managed at this stage
  exitCriteria: string;    // human-facing exit gate (live blockers come from the backend)
  domains: string[];       // risk-domain keys most in play (keys of DOMAIN_LABELS)
  // Legacy convenience fields (derived) — kept so older consumers don't break.
  accountable: string[];
  artifact: string;
}

// Canonical risk-domain key order (matches backend TPRA_RISK_DOMAINS / DOMAIN_LABELS).
// Declared here so STAGE_DEFS below can reference the "all domains" set.
const DOMAIN_DEF_KEYS = [
  'cybersecurity', 'data_privacy', 'operational', 'financial', 'compliance',
  'reputational', 'geographic', 'fourth_party', 'esg', 'legal',
];

// Canonical 11 stages — kept in sync with backend stages.STAGE_CONTENT (served by
// GET /vendor-risk/tpra/stages). The backend /stages endpoint is the source of
// truth; this mirrors it so the panels render synchronously without a fetch. The
// `accountable`/`artifact` legacy fields are derived from raci/artifacts below.
const STAGE_DEFS: Array<Omit<StageMetaDef, 'accountable' | 'artifact'>> = [
  {
    key: 'intake', order: 1, label: 'Intake & Scoping', phase: 'Onboarding diligence', gate: false,
    objective: 'Capture the business need and the basic facts about the proposed third party and the service before any work is committed.',
    inputs: ['Business sponsor request', 'Service description & spend estimate', 'Data types and systems the vendor will touch'],
    activities: ['Register the vendor and assign a business owner', 'Define exactly what data and systems are in scope', 'Check for an existing or duplicate relationship', 'Draft an initial data classification'],
    raci: { R: ['Business owner'], A: ['TPRM lead'], C: ['Procurement'], I: ['Security'] },
    artifacts: ['Intake form', 'Vendor record (VND-ID)'],
    exitCriteria: 'A vendor record exists with a named owner, a defined service scope, and a draft data classification.',
    domains: ['cybersecurity', 'data_privacy', 'compliance', 'legal'],
  },
  {
    key: 'tiering', order: 2, label: 'Inherent Risk Tiering', phase: 'Onboarding diligence', gate: true,
    objective: 'Score risk before any controls are considered, to set how deep the assessment goes and how often it repeats.',
    inputs: ['Data sensitivity', 'Business criticality', 'Access level', 'Regulatory & geographic scope', 'Fourth-party reliance'],
    activities: ['Run the inherent-risk questionnaire', 'Compute the tier — Critical, High, Medium or Low', 'Set assessment depth and monitoring cadence to match'],
    raci: { R: ['TPRM analyst'], A: ['TPRM lead'], C: ['Business owner'], I: ['Security', 'Privacy'] },
    artifacts: ['Inherent risk score', 'Tier rating'],
    exitCriteria: 'An approved inherent tier that drives a right-sized assessment path — a Low vendor exits to a light review; Critical triggers full diligence.',
    domains: ['cybersecurity', 'data_privacy', 'operational', 'financial', 'compliance', 'geographic', 'fourth_party'],
  },
  {
    key: 'dd_planning', order: 3, label: 'Due Diligence Planning', phase: 'Onboarding diligence', gate: false,
    objective: 'Choose the right questionnaires, evidence requests, and reviewers for the assigned tier.',
    inputs: ['Inherent tier', 'Service type — cloud, on-prem, processor', 'Data scope'],
    activities: ['Select the questionnaire template(s)', 'Request evidence — SOC 2, ISO 27001, pen test, DPA', 'Assign domain reviewers and set a timeline'],
    raci: { R: ['TPRM analyst'], A: ['TPRM lead'], C: ['Security', 'Privacy', 'Legal'], I: ['Business owner'] },
    artifacts: ['Assessment plan', 'Evidence request list'],
    exitCriteria: 'An assessment plan with reviewer assignments and an evidence request issued to the vendor.',
    domains: ['cybersecurity', 'data_privacy', 'compliance'],
  },
  {
    key: 'questionnaire', order: 4, label: 'Questionnaire & Evidence', phase: 'Onboarding diligence', gate: false,
    objective: "Gather the vendor's attestations and the supporting proof behind them.",
    inputs: ['Issued questionnaires', 'Evidence requests'],
    activities: ['Vendor completes the questionnaire and uploads evidence', 'Analyst validates completeness and chases gaps', 'Review certifications and audit reports against claims'],
    raci: { R: ['Vendor', 'TPRM analyst'], A: ['TPRM lead'], C: ['Security'], I: ['Business owner'] },
    artifacts: ['Completed questionnaire', 'Evidence pack'],
    exitCriteria: 'Complete responses with validated evidence on file — claims are backed by SOC 2 / ISO / pen-test / DPA artifacts.',
    domains: ['cybersecurity', 'data_privacy', 'compliance', 'operational'],
  },
  {
    key: 'scoring', order: 5, label: 'Risk Analysis & Scoring', phase: 'Decision & contracting', gate: false,
    objective: 'Convert responses and evidence into scored findings and a residual risk rating across every domain.',
    inputs: ['Responses', 'Evidence', 'Control framework mapping'],
    activities: ['Map answers to controls and validate against evidence', 'Score control posture per domain', 'Compute overall residual risk after controls'],
    raci: { R: ['Domain reviewers'], A: ['TPRM lead'], C: ['Business owner'], I: ['Risk committee'] },
    artifacts: ['Risk scorecard', 'Findings register'],
    exitCriteria: 'A residual risk rating and a scored findings register spanning all ten domains.',
    domains: DOMAIN_DEF_KEYS,
  },
  {
    key: 'findings', order: 6, label: 'Findings & Remediation', phase: 'Decision & contracting', gate: false,
    objective: 'Drive every gap to closure, into an agreed plan, or to a formally signed-off risk acceptance.',
    inputs: ['Findings register', 'Residual rating'],
    activities: ['Rate each finding by severity', 'Agree remediation plans and target dates', 'Track to closure — or document a risk acceptance with sign-off'],
    raci: { R: ['Vendor', 'TPRM analyst'], A: ['Risk owner'], C: ['Security', 'Legal'], I: ['Business owner'] },
    artifacts: ['Remediation plan', 'Risk acceptance record'],
    exitCriteria: 'All findings are closed, in an active remediation plan, or formally accepted by an accountable owner.',
    domains: ['cybersecurity', 'data_privacy', 'operational', 'compliance'],
  },
  {
    key: 'contracting', order: 7, label: 'Contracting & Controls', phase: 'Decision & contracting', gate: false,
    objective: 'Lock the controls the assessment requires into the binding agreement.',
    inputs: ['Findings', 'Residual risk', 'Regulatory obligations'],
    activities: ['Negotiate the security addendum and DPA', 'Set SLAs, breach-notification windows and right-to-audit', 'Define subprocessor terms and exit / data-return clauses'],
    raci: { R: ['Legal', 'Procurement'], A: ['Legal'], C: ['Security', 'Privacy', 'TPRM'], I: ['Business owner'] },
    artifacts: ['Contract', 'DPA', 'Security addendum', 'SLA'],
    exitCriteria: 'A signed contract whose clauses reflect the risk-based controls identified during diligence.',
    domains: ['legal', 'data_privacy', 'operational', 'compliance'],
  },
  {
    key: 'approval', order: 8, label: 'Approval Decision', phase: 'Decision & contracting', gate: true,
    objective: 'Make an accountable, recorded go / no-go on the residual risk.',
    inputs: ['Risk scorecard', 'Findings status', 'Contract terms'],
    activities: ['Present the case to the approver or risk committee per tier', 'Approve, approve with conditions, defer, or reject', 'Record the decision, its conditions, and the owner'],
    raci: { R: ['TPRM lead'], A: ['Risk committee / exec owner'], C: ['Security', 'Legal'], I: ['Business owner'] },
    artifacts: ['Approval record', 'Conditions list'],
    exitCriteria: 'A recorded decision with any conditions and a named owner accountable for them.',
    domains: DOMAIN_DEF_KEYS,
  },
  {
    key: 'onboarding', order: 9, label: 'Onboarding & Enablement', phase: 'In-life management', gate: false,
    objective: 'Provision access safely and stand up the monitoring that will run for the life of the relationship.',
    inputs: ['Approval decision and conditions'],
    activities: ['Grant least-privilege access and configure integrations', 'Register the vendor in asset and SLA inventories', 'Turn on monitoring feeds'],
    raci: { R: ['IT', 'Security'], A: ['TPRM lead'], C: ['Business owner'], I: ['Procurement'] },
    artifacts: ['Access grants', 'Monitoring config'],
    exitCriteria: 'The vendor is live with monitored, least-privilege access and tracked contractual obligations.',
    domains: ['cybersecurity', 'operational'],
  },
  {
    key: 'monitoring', order: 10, label: 'Continuous Monitoring', phase: 'In-life management', gate: false,
    objective: 'Detect changes in risk between formal reviews so the rating never goes stale.',
    inputs: ['Security ratings feeds', 'Breach & adverse-media monitoring', 'SLA / financial signals', 'Certification expiry'],
    activities: ['Track security ratings, breaches, news and financial health', 'Watch SLA performance and certification renewals', 'Raise an ad-hoc review on any material change'],
    raci: { R: ['TPRM analyst'], A: ['TPRM lead'], C: ['Security'], I: ['Business owner'] },
    artifacts: ['Monitoring dashboard', 'Alert log'],
    exitCriteria: 'Continuous signal coverage where trigger events automatically raise a reassessment.',
    domains: DOMAIN_DEF_KEYS,
  },
  {
    key: 'reassessment', order: 11, label: 'Reassessment & Offboarding', phase: 'In-life management', gate: false,
    objective: 'Re-validate on cadence or on trigger, and exit cleanly at the end of the relationship.',
    inputs: ['Review cadence', 'Trigger events', 'Termination notice'],
    activities: ['Re-run a tier-appropriate assessment on schedule or trigger', 'At exit, revoke all access', 'Confirm data return or destruction and close obligations'],
    raci: { R: ['TPRM analyst'], A: ['TPRM lead'], C: ['Security', 'Legal'], I: ['Business owner'] },
    artifacts: ['Reassessment record', 'Offboarding certificate', 'Data-destruction attestation'],
    exitCriteria: 'Either an updated rating, or a fully offboarded vendor with evidence of access revocation and data destruction.',
    domains: DOMAIN_DEF_KEYS,
  },
];

export const STAGE_META: Record<string, StageMetaDef> = Object.fromEntries(
  STAGE_DEFS.map((s) => [
    s.key,
    {
      ...s,
      // Derive the legacy flat fields so existing consumers keep working.
      accountable: Array.from(new Set([...s.raci.A, ...s.raci.R])),
      artifact: s.artifacts.join(', '),
    },
  ]),
);

export const STAGE_ORDER: string[] = Object.values(STAGE_META)
  .sort((a, b) => a.order - b.order)
  .map((s) => s.key);

export const PHASES = ['Onboarding diligence', 'Decision & contracting', 'In-life management'];

export const DOMAIN_LABELS: Record<string, string> = {
  cybersecurity: 'Cybersecurity',
  data_privacy: 'Data Privacy',
  operational: 'Operational Resilience',
  financial: 'Financial Viability',
  compliance: 'Compliance & Regulatory',
  reputational: 'Reputational',
  geographic: 'Geographic/Geopolitical',
  fourth_party: 'Fourth-Party/Concentration',
  esg: 'ESG & Sustainability',
  legal: 'Legal & Contractual',
};

export const DOMAIN_KEYS = Object.keys(DOMAIN_LABELS);

// ── Named RACI resolution ────────────────────────────────────────────────────
// The RACI labels in STAGE_META are org *functions*, not people. This maps each
// playbook label to a key in the assessment-level team roster (TeamRosterPanel's
// TEAM_ROLES) so a stage's abstract R/A/C/I resolve to the actual assigned users.
// Labels with no owning roster function (e.g. the external "Vendor") map to null
// and render as unassigned. Keys are matched case-insensitively.
export const RACI_LABEL_TO_ROSTER_KEY: Record<string, string | null> = {
  'business owner': 'business_owner',
  'risk owner': 'business_owner',
  'tprm lead': 'tprm_lead',
  'tprm': 'tprm_lead',
  'tprm analyst': 'tprm_analyst',
  'domain reviewers': 'security',
  'security': 'security',
  'privacy': 'privacy',
  'legal': 'legal',
  'procurement': 'procurement',
  'risk committee / exec owner': 'exec_approver',
  'risk committee': 'exec_approver',
  'it': 'it',
};

export function rosterKeyForRaciLabel(label: string): string | null {
  return RACI_LABEL_TO_ROSTER_KEY[label.trim().toLowerCase()] ?? null;
}

// ── Style helpers (match the existing vendor-risk soft-tone tier badges) ─────
export function tierBadge(tier?: string | null): string {
  const styles: Record<string, string> = {
    critical: 'bg-rose-50 text-rose-700 border-rose-200',
    high: 'bg-orange-50 text-orange-700 border-orange-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    low: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  };
  return styles[(tier || '').toLowerCase()] || 'bg-slate-100 text-slate-600 border-slate-200';
}

export function severityBadge(sev?: string | null): string {
  return tierBadge(sev); // severities share the tier palette
}

export function stageStatusStyle(status: StageStatus): { dot: string; text: string; ring: string } {
  switch (status) {
    case 'complete':
      return { dot: 'bg-emerald-500', text: 'text-emerald-700', ring: 'ring-emerald-200' };
    case 'in_progress':
      return { dot: 'bg-primary-500', text: 'text-primary-700', ring: 'ring-primary-300' };
    case 'blocked':
      return { dot: 'bg-rose-500', text: 'text-rose-700', ring: 'ring-rose-200' };
    case 'skipped':
      return { dot: 'bg-slate-400', text: 'text-slate-500', ring: 'ring-slate-200' };
    default:
      return { dot: 'bg-slate-300', text: 'text-slate-400', ring: 'ring-slate-200' };
  }
}

export const FINDING_STATUSES = ['open', 'in_remediation', 'accepted', 'closed'];
export const SEVERITIES = ['critical', 'high', 'medium', 'low'];
export const TREATMENT_TYPES = ['remediate', 'mitigate', 'transfer'];
export const CONTRACT_TYPES = ['master', 'dpa', 'sla', 'security_addendum'];
export const SIGNAL_TYPES = ['security_rating', 'breach', 'adverse_media', 'financial', 'sla', 'cert_expiry'];
export const APPROVAL_DECISIONS = [
  { value: 'approve', label: 'Approve' },
  { value: 'approve_with_conditions', label: 'Approve with conditions' },
  { value: 'defer', label: 'Defer' },
  { value: 'reject', label: 'Reject' },
];

export const RECOMMENDATION_LABEL: Record<string, string> = {
  approve: 'Approve',
  approve_with_conditions: 'Approve with conditions',
  remediate_first: 'Remediate first',
  escalate_or_reject: 'Escalate or reject',
};

export function fmtDate(d?: string | null): string {
  if (!d) return '—';
  try {
    return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return '—';
  }
}
