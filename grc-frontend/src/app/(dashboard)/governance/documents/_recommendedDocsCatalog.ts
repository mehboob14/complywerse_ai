/**
 * Recommended Governance Documents catalogue.
 *
 * 36 high-value GRC artefacts a regulated bank typically maintains. Each
 * entry provides the title, a banking-SME-grade prompt brief that becomes
 * the AI draft's "description" field, the suggested `doc_type` so the
 * scaffold matches the artefact's nature, and a category for grouping.
 *
 * Picking an entry here pre-fills the AI Draft modal — the user can tweak
 * frameworks / parent doc / description before hitting Generate, but the
 * brief is already enterprise-banking-grade out of the box.
 */

import type { LucideIcon } from 'lucide-react';
import {
  Shield, ShieldAlert, Activity, FileSpreadsheet, AlertOctagon,
  AlertTriangle, ClipboardCheck, ClipboardList, BarChart3,
  TrendingUp, FileWarning, Map, Layers, Network, FileSearch,
  FileBarChart, Gauge, BookOpen, Users, FileCheck, Bell,
  Building, GitBranch, FlaskConical, Library, FileText, Target,
  Bug, Workflow, Wrench, Lock, Database, Package, Search,
} from 'lucide-react';

export type RecommendedDocType = 'policy' | 'standard' | 'procedure' | 'guideline';

export interface RecommendedDoc {
  /** Title the AI-draft modal pre-fills */
  title: string;
  /** Doc type — drives which scaffold is used and the SME craft block */
  doc_type: RecommendedDocType;
  /** Category bucket — drives grouping in the picker */
  category: RecommendedCategory;
  /** Lucide icon for the card */
  icon: LucideIcon;
  /** A short, scannable hint shown on the card under the title */
  blurb: string;
  /** Full prompt brief seeded into the AI draft `description` field */
  description: string;
}

export type RecommendedCategory =
  | 'Risk Management'
  | 'Compliance & Audit'
  | 'Issues & Incidents'
  | 'Governance'
  | 'Regulatory & Mapping'
  | 'Controls & Security'
  | 'Third Party'
  | 'KPIs & KRIs';

export const RECOMMENDED_CATEGORIES: { id: RecommendedCategory; tint: string }[] = [
  { id: 'Risk Management',     tint: 'bg-rose-50 text-rose-700 border-rose-200' },
  { id: 'Compliance & Audit',  tint: 'bg-blue-50 text-blue-700 border-blue-200' },
  { id: 'Issues & Incidents',  tint: 'bg-amber-50 text-amber-700 border-amber-200' },
  { id: 'Governance',          tint: 'bg-violet-50 text-violet-700 border-violet-200' },
  { id: 'Regulatory & Mapping',tint: 'bg-sky-50 text-sky-700 border-sky-200' },
  { id: 'Controls & Security', tint: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { id: 'Third Party',         tint: 'bg-orange-50 text-orange-700 border-orange-200' },
  { id: 'KPIs & KRIs',         tint: 'bg-teal-50 text-teal-700 border-teal-200' },
];

export const RECOMMENDED_DOCS: RecommendedDoc[] = [
  // ── Risk Management ────────────────────────────────────────────────────────
  {
    title: 'Cyber Risk Register Procedure',
    doc_type: 'procedure',
    category: 'Risk Management',
    icon: ShieldAlert,
    blurb: 'Identify, score, and track cyber risks end-to-end',
    description:
      'Operational procedure for maintaining the Cyber Risk Register: how risks are identified (threat intel, vuln scans, incidents, audits), classified (Basel II event type), scored (inherent/residual using the Bank\'s 5x5 likelihood × impact scale), assigned to risk owners, monitored via KRIs, and reviewed quarterly. Include the closure / acceptance / transfer workflow, the four-eyes approval for high/critical risks, and the integration touchpoints with the Risk Management Committee.',
  },
  {
    title: 'Enterprise Risk Register Standard',
    doc_type: 'standard',
    category: 'Risk Management',
    icon: FileSpreadsheet,
    blurb: 'Mandatory schema for the Bank-wide ERM register',
    description:
      'Mandatory standard defining the structure of the Bank-wide Enterprise Risk Register: required fields (risk ID format, Basel category, business line, owner, inherent/residual scoring, mitigating controls, KRIs, target dates), data types and validation rules, refresh cadence, retention (10 years), and access controls. Include the field-level definitions and the quality-checks the Operational Risk function runs each quarter.',
  },
  {
    title: 'Strategic Risk Register Procedure',
    doc_type: 'procedure',
    category: 'Risk Management',
    icon: Target,
    blurb: 'Board-level strategic risk capture and review',
    description:
      'Procedure for maintaining the Strategic Risk Register at Board level: triggers (strategic plan refresh, M&A, regulatory change, market shock), the EXCO / Board Risk Management Committee review cadence, the scoring methodology distinct from operational risk (longer horizon, qualitative impact), and the linkage to ICAAP and the Risk Appetite Statement.',
  },
  {
    title: 'Risk Exposure Summary Panel Standard',
    doc_type: 'standard',
    category: 'Risk Management',
    icon: BarChart3,
    blurb: 'Aggregated view of inherent + residual exposure',
    description:
      'Standard defining the Risk Exposure Summary panel: the aggregation methodology (which dimensions roll up — business line, geography, Basel category), the reporting cadence to ERMC / Board, the calculation formulas for aggregate inherent vs residual exposure, the data sources and refresh expectations, and the formal sign-off path before publication.',
  },
  {
    title: 'Risk Trend Analysis Procedure',
    doc_type: 'procedure',
    category: 'Risk Management',
    icon: TrendingUp,
    blurb: 'How to detect and report risk trend shifts',
    description:
      'Operational procedure for performing monthly Risk Trend Analysis: data sources, the statistical methods used (moving averages, Z-score for outliers, year-on-year deltas), threshold breaches that trigger escalation, the report template, the Risk Management Committee review, and the closure / action-tracking loop.',
  },
  {
    title: 'Residual Risk Calculation Standard',
    doc_type: 'standard',
    category: 'Risk Management',
    icon: Gauge,
    blurb: 'Formula for residual after control effectiveness',
    description:
      'Mandatory standard defining how Residual Risk is calculated from Inherent Risk and Control Effectiveness: the formula (with worked examples), the control-effectiveness rating scale and its evidence requirements, override authorities (who can manually adjust and the audit trail), and the recalculation triggers (control failure, audit finding, scheme change).',
  },
  {
    title: 'Inherent vs Residual Risk Methodology',
    doc_type: 'standard',
    category: 'Risk Management',
    icon: Layers,
    blurb: 'Definitions, scoring, and the gap interpretation',
    description:
      'Methodology standard defining Inherent vs Residual Risk: precise definitions, the 5x5 scoring matrix (likelihood × impact bands), what each band means in monetary / operational / reputational terms, how the gap between inherent and residual indicates control coverage adequacy, and the documentation that must accompany each rating.',
  },
  {
    title: 'Risk Heatmap Generation Procedure',
    doc_type: 'procedure',
    category: 'Risk Management',
    icon: Map,
    blurb: 'How to produce the Board Risk Heatmap',
    description:
      'Operational procedure for producing the quarterly Risk Heatmap for the Board Risk Management Committee: the data extraction queries, the aggregation rules, the visual standards (colour bands, threshold lines, top-N callouts), reviewer sign-off, distribution control, and the retention of every published heatmap version.',
  },
  {
    title: 'Risk Impact Scoring Model Standard',
    doc_type: 'standard',
    category: 'Risk Management',
    icon: FlaskConical,
    blurb: 'Quantitative + qualitative impact scoring rules',
    description:
      'Mandatory standard defining the Risk Impact Scoring Model: the dimensions scored (financial, operational, regulatory, reputational, customer), the score bands (1–5) with anchor values in local currency and SLA terms, the weighting between dimensions, the rules for picking the highest-band dimension as the overall impact, and the calibration exercise the Risk Function runs annually.',
  },
  {
    title: 'Scenario Analysis Procedure',
    doc_type: 'procedure',
    category: 'Risk Management',
    icon: Workflow,
    blurb: 'Stress-testing and what-if scenario workshops',
    description:
      'Procedure for running Scenario Analysis workshops: selecting plausible-but-severe scenarios, the participant roles (First / Second / Third Line), data inputs, the qualitative + quantitative outputs, the report template, presentation to ERMC, and integration into the ICAAP narrative.',
  },

  // ── Compliance & Audit ─────────────────────────────────────────────────────
  {
    title: 'Compliance Testing Procedure',
    doc_type: 'procedure',
    category: 'Compliance & Audit',
    icon: ClipboardCheck,
    blurb: 'How First-Line compliance testing is performed',
    description:
      'Procedure for performing First-Line Compliance Testing: scope selection (risk-based), sampling methodology and sample-size formula, the test scripts per regulatory obligation, evidence collection requirements, defect logging into the issue tracker, the closure workflow, and the quarterly QA review by the Compliance Function.',
  },
  {
    title: 'Compliance Testing Log Standard',
    doc_type: 'standard',
    category: 'Compliance & Audit',
    icon: FileSpreadsheet,
    blurb: 'Mandatory fields and retention for the testing log',
    description:
      'Standard defining the Compliance Testing Log: required fields (test ID, regulation reference, scope, sample size, tester, date, result, defects raised, evidence pointer), the retention period (10 years), access controls, data validation rules, and the monthly reconciliation against the Compliance Plan.',
  },
  {
    title: 'Compliance Dashboard Procedure',
    doc_type: 'procedure',
    category: 'Compliance & Audit',
    icon: BarChart3,
    blurb: 'KPIs surfaced to the Compliance Committee',
    description:
      'Procedure for maintaining the Compliance Dashboard: the KPIs / KRIs surfaced (testing completion %, defect closure aging, regulatory breach count, attestation completion), data sources, refresh cadence, the Compliance Committee review, and the escalation path for red metrics.',
  },
  {
    title: 'Audit Findings Register Procedure',
    doc_type: 'procedure',
    category: 'Compliance & Audit',
    icon: FileSearch,
    blurb: 'Capture, track, and close all audit findings',
    description:
      'Procedure for the Audit Findings Register: how findings are captured from Internal Audit, External Audit, regulator inspections, and self-identified gaps; the rating scheme; assignment to remediation owners; the four-eyes verification of closure; the Audit Committee reporting; and the retention requirement.',
  },
  {
    title: 'Risk-Based Audit Scoring Standard',
    doc_type: 'standard',
    category: 'Compliance & Audit',
    icon: FileBarChart,
    blurb: 'How auditable universe is scored and prioritised',
    description:
      'Standard defining the Risk-Based Audit Scoring Model used by Internal Audit to prioritise the audit universe: the dimensions scored (inherent risk, control maturity, time-since-last-audit, regulatory exposure, recent issues), weights, the cycle (annual plan + interim refresh), governance approval, and the documentation Internal Audit must retain for each scored entity.',
  },
  {
    title: 'Evidence Collection Procedure',
    doc_type: 'procedure',
    category: 'Compliance & Audit',
    icon: Database,
    blurb: 'Standardised evidence capture for control testing',
    description:
      'Procedure for collecting and preserving control-testing evidence: acceptable evidence types per control category, naming conventions, chain-of-custody when evidence leaves source systems, the central evidence repository, retention by record type (7–10 years), and the periodic integrity check.',
  },

  // ── Issues & Incidents ─────────────────────────────────────────────────────
  {
    title: 'Corrective Action Register Procedure',
    doc_type: 'procedure',
    category: 'Issues & Incidents',
    icon: Wrench,
    blurb: 'CAPA lifecycle from logging to closure',
    description:
      'Procedure for the Corrective Action Register: how CAPAs are logged (linked to a parent finding / incident / risk), root-cause analysis methodology (5 Whys / Ishikawa), assignment, owner approval, milestone tracking, effectiveness review post-implementation, and the formal closure sign-off.',
  },
  {
    title: 'Issue & Incident Dashboard Procedure',
    doc_type: 'procedure',
    category: 'Issues & Incidents',
    icon: AlertOctagon,
    blurb: 'Unified view of open issues + active incidents',
    description:
      'Procedure for maintaining the Issue & Incident Dashboard: the KPIs (open count by severity, aging, SLA breach %, closure rate), data sources (issue tracker + incident tracker), refresh cadence, reviewer (Operational Risk Committee), escalation thresholds, and the published distribution.',
  },
  {
    title: 'Issue Closure Tracker Procedure',
    doc_type: 'procedure',
    category: 'Issues & Incidents',
    icon: ClipboardList,
    blurb: 'Verify closure quality before SLA exit',
    description:
      'Procedure for the Issue Closure Tracker: the closure criteria per issue type, the evidence the closer must attach, the independent verifier role (different from the owner), the four-eyes sign-off, the SLA clock-stop rules, and the QA sampling done by Operational Risk.',
  },
  {
    title: 'Issue Severity Matrix Standard',
    doc_type: 'standard',
    category: 'Issues & Incidents',
    icon: AlertTriangle,
    blurb: 'Severity bands with concrete escalation triggers',
    description:
      'Mandatory standard defining the Issue Severity Matrix: the bands (Critical / High / Medium / Low) with anchor criteria (customer impact, financial impact, regulator visibility, system availability), the SLA per band (resolution + customer comms + regulator notification windows), the escalation chain by band, and the recalibration cadence.',
  },
  {
    title: 'Enterprise Issue Log Procedure',
    doc_type: 'procedure',
    category: 'Issues & Incidents',
    icon: FileWarning,
    blurb: 'Single Bank-wide issue capture pipeline',
    description:
      'Procedure for the Enterprise Issue Log — the single Bank-wide log that aggregates issues from compliance testing, internal audit, external audit, regulator inspections, incident management, and self-identification. Cover the intake form, deduplication rules, the assignment workflow, the executive reporting, and the data retention.',
  },
  {
    title: 'Issue Aging Reporting Procedure',
    doc_type: 'procedure',
    category: 'Issues & Incidents',
    icon: Bell,
    blurb: 'Aging buckets and escalation triggers',
    description:
      'Procedure for the monthly Issue Aging report: how aging buckets are defined (≤30 days, 31–60, 61–90, >90 by severity), the escalation thresholds, the report template, the recipients (ERMC, BU heads, Internal Audit), and the action expected per breach.',
  },

  // ── Governance ─────────────────────────────────────────────────────────────
  {
    title: 'Delegation of Authority Policy',
    doc_type: 'policy',
    category: 'Governance',
    icon: Users,
    blurb: 'Approval-authority matrix for material decisions',
    description:
      'Board-endorsed policy defining the Delegation of Authority across the Bank: the approval bands by decision type (lending, expense, system change, hiring, vendor onboarding, exception, public statement), the named authorising roles per band, sub-delegation rules, the four-eyes requirement above thresholds, and the periodic review by the Board.',
  },
  {
    title: 'Governance Decision Log Procedure',
    doc_type: 'procedure',
    category: 'Governance',
    icon: BookOpen,
    blurb: 'Authoritative record of Board/EXCO decisions',
    description:
      'Procedure for maintaining the Governance Decision Log: which forums log into it (Board, EXCO, RMC, ITSC, ISSC), required fields per entry (decision ID, date, forum, motion, decision text, voting result, dissents, follow-up actions), retention (permanent for Board decisions), access controls, and the quarterly reconciliation against minutes.',
  },
  {
    title: 'Governance RACI Matrix Standard',
    doc_type: 'standard',
    category: 'Governance',
    icon: Network,
    blurb: 'Responsibility map for every governance artefact',
    description:
      'Standard defining the Governance RACI Matrix: the conventions used (Responsible / Accountable / Consulted / Informed), the granularity (per artefact: policy / standard / register / log / dashboard), the named roles, the refresh cadence, and the publication / acknowledgement workflow.',
  },
  {
    title: 'Policy Attestation Procedure',
    doc_type: 'procedure',
    category: 'Governance',
    icon: FileCheck,
    blurb: 'Annual / event-driven attestation campaigns',
    description:
      'Procedure for running Policy Attestation campaigns: scoping (which roles attest to which policies), the campaign schedule (annual mandatory + event-driven), the reminder cadence, escalation for non-completion, the evidence retention, and the HR consequence framework for non-attestation.',
  },
  {
    title: 'Policy Repository Index Standard',
    doc_type: 'standard',
    category: 'Governance',
    icon: Library,
    blurb: 'Canonical structure and indexing of all policies',
    description:
      'Mandatory standard defining how the central Policy Repository is structured: the document hierarchy (Policy → Standard → Procedure → Guideline), the naming convention, version-control rules, the metadata required on every document (owner, approval authority, effective date, next review date, classification), and the indexing / search expectations.',
  },

  // ── Regulatory & Mapping ───────────────────────────────────────────────────
  {
    title: 'Regulatory Change Log Procedure',
    doc_type: 'procedure',
    category: 'Regulatory & Mapping',
    icon: GitBranch,
    blurb: 'From regulator publication to Bank-wide rollout',
    description:
      'End-to-end procedure for the Regulatory Change Log: how regulatory publications are intercepted (sources, named feed-watchers), impact assessment (which products / functions are affected), gap analysis vs existing policies, the implementation plan with milestones, the Compliance Committee sign-off, and the closure with evidence of operational readiness before the effective date.',
  },
  {
    title: 'Risk-to-Control Mapping Standard',
    doc_type: 'standard',
    category: 'Regulatory & Mapping',
    icon: Network,
    blurb: 'Authoritative map: risks → mitigating controls',
    description:
      'Standard defining how each risk in the register is mapped to its mitigating controls: the mapping data structure (M:N), the evidence required to claim a control mitigates a risk, the control-effectiveness rating that flows into residual-risk calculation, the refresh trigger when either side changes, and the QA review by the Risk Function.',
  },

  // ── Controls & Security ────────────────────────────────────────────────────
  {
    title: 'Patch Management Procedure',
    doc_type: 'procedure',
    category: 'Controls & Security',
    icon: Wrench,
    blurb: 'Patch lifecycle with severity-based SLAs',
    description:
      'Operational procedure for Patch Management: vulnerability intake (vendor advisories + scanners + threat intel), criticality assessment, the SLAs by severity (Critical: 14 days, High: 30, Medium: 60, Low: 90), the CAB approval path, the four-eyes change implementation, the post-implementation verification, the exception process for unpatchable systems with compensating controls, and the monthly Patch Compliance reporting.',
  },
  {
    title: 'Security Maturity Assessment Procedure',
    doc_type: 'procedure',
    category: 'Controls & Security',
    icon: Shield,
    blurb: 'Periodic capability assessment vs target state',
    description:
      'Procedure for the annual Security Maturity Assessment: the framework used (NIST CSF / CMMI / locally defined), the dimensions scored, the data collection (interviews, evidence sampling, automated scans), the scoring rubric, the target-state setting by the ISSC, the gap-remediation roadmap, and the reporting to the Board Risk Committee.',
  },

  // ── Third Party ────────────────────────────────────────────────────────────
  {
    title: 'Third-Party Risk Scoring Standard',
    doc_type: 'standard',
    category: 'Third Party',
    icon: Building,
    blurb: 'Tiering vendors by inherent + residual risk',
    description:
      'Mandatory standard for scoring third-party risk: the dimensions (data classification handled, criticality of service, concentration, financial health, regulatory regime, geographic exposure), the tier definitions (Critical / Significant / Standard / Low), the due-diligence depth per tier, the contract clauses required per tier, and the reassessment cadence.',
  },

  // ── KPIs & KRIs ────────────────────────────────────────────────────────────
  {
    title: 'KPI / KRI Monitoring Procedure',
    doc_type: 'procedure',
    category: 'KPIs & KRIs',
    icon: Activity,
    blurb: 'Calibration, monitoring, and threshold breaches',
    description:
      'Procedure for ongoing KPI and KRI monitoring: data sources, refresh cadence per indicator, threshold calibration (green / amber / red), the breach-handling workflow (immediate alerts, root-cause analysis, remediation plan), the periodic recalibration exercise, and the executive reporting via the Risk Management Committee.',
  },
  {
    title: 'KPI / KRI Mapping Standard',
    doc_type: 'standard',
    category: 'KPIs & KRIs',
    icon: Map,
    blurb: 'Map indicators to risks, controls, processes',
    description:
      'Standard defining how every KPI / KRI is mapped to its parent risk, the controls whose effectiveness it monitors, and the business process it instruments. Include the mandatory metadata (owner, data source, calculation formula, refresh cadence, thresholds, escalation rules) and the QA review by the Operational Risk function.',
  },
  {
    title: 'KPI / KRI Builder Guideline',
    doc_type: 'guideline',
    category: 'KPIs & KRIs',
    icon: Package,
    blurb: 'How to design a useful, auditable indicator',
    description:
      'Practical guideline for designing new KPIs / KRIs: when to choose a leading vs lagging indicator, the SMART criteria, common anti-patterns (vanity metrics, indicators that drive perverse behaviour), worked examples per risk category, the calibration approach for thresholds, and the documentation template the owner must complete before publication.',
  },
];
