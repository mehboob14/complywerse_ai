export interface Tenant {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Permission {
  id: string;
  name: string;
  description: string;
  resource: string;
  action: string;
}

export interface Role {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  permissions: Permission[];
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  tenant_id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_active: boolean;
  roles: Role[];
  created_at: string;
  updated_at: string;
}

export interface Framework {
  id: string;
  tenant_id: string;
  name: string;
  short_code?: string;
  version: string;
  description: string;
  source: string;
  regulator?: string;
  jurisdiction?: string;
  region?: string;
  effective_date: string;
  is_mandatory?: boolean;
  enforcement_type?: string;
  is_active?: boolean;
  is_custom?: boolean;
  domain_count?: number;
  control_count?: number;
  domains: Domain[];
  created_at: string;
  updated_at: string;
}

export interface Domain {
  id: string;
  framework_id: string;
  name: string;
  description: string;
  order_index: number;
  control_objectives: ControlObjective[];
}

export interface ControlObjective {
  id: string;
  domain_id: string;
  reference_code: string;
  name: string;
  description: string;
  guidance: string;
  controls: Control[];
}

export interface Control {
  id: string;
  control_objective_id: string;
  reference_code: string;
  name: string;
  description: string;
  implementation_guidance: string;
  testing_procedures: string;
  control_type: 'preventive' | 'detective' | 'corrective';
  automation_status: 'manual' | 'semi-automated' | 'fully-automated';
  owner_id: string;
  sub_controls: SubControl[];
  created_at: string;
  updated_at: string;
}

export interface SubControl {
  id: string;
  control_id: string;
  reference_code: string;
  name: string;
  description: string;
  testing_procedures: string;
}

export interface NormalizedControl {
  id: string;
  tenant_id: string;
  internal_id: string;
  name: string;
  description: string;
  category: string;
  implementation_status: 'not_implemented' | 'partial' | 'implemented';
  mappings: ControlMapping[];
  created_at: string;
  updated_at: string;
}

export interface ControlMapping {
  id: string;
  normalized_control_id: string;
  framework_control_id: string;
  mapping_type: 'direct' | 'partial' | 'related';
  notes: string;
  created_at: string;
}

export interface Evidence {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  evidence_type: string;
  file_path: string;
  file_hash: string;
  collection_date: string;
  expiry_date: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  uploaded_by: string;
  versions: EvidenceVersion[];
  ai_assessments: EvidenceAIAssessment[];
  created_at: string;
  updated_at: string;
}

export interface EvidenceVersion {
  id: string;
  evidence_id: string;
  version_number: number;
  file_path: string;
  file_hash: string;
  changes_summary: string;
  uploaded_by: string;
  created_at: string;
}

export interface EvidenceAIAssessment {
  id: string;
  evidence_id: string;
  assessment_type: string;
  confidence_score: number;
  findings: Record<string, unknown>;
  recommendations: string[];
  created_at: string;
}

export type RiskCategory = 'strategic' | 'operational' | 'financial' | 'compliance' | 'technology' | 'third_party' | 'project_change' | 'internal';
export type RiskStatus = 'open' | 'in_treatment' | 'mitigated' | 'accepted' | 'closed';

export interface RiskMitigationAction {
  id: number;
  risk_id: number;
  title: string;
  description?: string;
  action_type: 'mitigate' | 'transfer' | 'avoid' | 'accept';
  status: 'open' | 'in_progress' | 'completed' | 'overdue' | 'cancelled';
  priority: 'critical' | 'high' | 'medium' | 'low';
  owner_id?: number;
  owner?: { id: number; email: string; full_name?: string };
  due_date?: string;
  completed_at?: string;
  expected_residual_reduction?: number;
  actual_residual_reduction?: number;
  evidence_id?: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface RiskAuditFindingLink {
  id: number;
  risk_id: number;
  issue_id: number;
  notes?: string;
  created_at: string;
  issue?: GovernanceIssue;
}

export interface LikelihoodImpactScale {
  id: number;
  tenant_id: number;
  scale_type: 'likelihood' | 'impact';
  level: number;
  label: string;
  description?: string;
  score_value: number;
  color?: string;
  is_default: boolean;
  created_at: string;
}

export interface GovernanceIssue {
  id: number;
  tenant_id: number;
  title: string;
  description?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  source?: string;
  assignee_id?: number;
  due_date?: string;
  resolution?: string;
  created_at: string;
  updated_at: string;
}

export interface Risk {
  id: number;
  tenant_id: number;
  title: string;
  description?: string;
  risk_category: RiskCategory;
  risk_sub_category?: string;
  register_type?: string;
  business_owner_id?: number;
  business_owner?: { id: number; email: string; full_name?: string };
  affected_department_ids?: number[];
  closure_status?: 'pending_closure' | 'closed' | null;
  closed_at?: string;
  closed_by?: number;
  closure_notes?: string;
  inherent_likelihood?: number;
  inherent_impact?: number;
  inherent_score?: number;
  residual_likelihood?: number;
  residual_impact?: number;
  residual_score?: number;
  risk_appetite?: string;
  status: RiskStatus;
  treatment_plan?: string;
  owner_id?: number;
  owner_name?: string;
  due_date?: string;
  review_date?: string;
  gap_finding_id?: number;
  mitigation_actions?: RiskMitigationAction[];
  audit_finding_links?: RiskAuditFindingLink[];
  created_at: string;
  updated_at: string;
}

export interface RiskDetail extends Risk {
  linked_controls: Array<{id: number; control_id: number; code: string; name: string}>;
  linked_framework_controls: Array<{id: number; framework_control_id: number; code: string; name: string; mitigation_effectiveness?: string; notes?: string; control_ref?: string; title?: string}>;
  linked_assets: Array<{id: number; asset_id: number; name: string; asset_type: string}>;
  linked_evidence: Array<{id: number; evidence_id: number; name: string; status: string}>;
  linked_governance: Array<{id: number; governance_objective_id: number; name: string; impact_level: string}>;
}

export interface RiskDashboard {
  total_risks: number;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
  by_score_range: {critical: number; high: number; medium: number; low: number};
  avg_inherent_score: number;
  avg_residual_score: number;
  open_risks: number;
  risks_needing_review: number;
}

export interface HeatmapCell {
  likelihood: number;
  impact: number;
  count: number;
  risks: Array<{id: number; title: string; score: number}>;
}

export interface GovernanceObjective {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  category: string;
  owner_id: string;
  target_date: string;
  status: 'draft' | 'active' | 'completed' | 'cancelled';
  kpis: Record<string, unknown>[];
  created_at: string;
  updated_at: string;
}

export interface Exception {
  id: string;
  tenant_id: string;
  control_id: string;
  title: string;
  description: string;
  justification: string;
  risk_accepted: boolean;
  approved_by: string;
  approval_date: string;
  expiry_date: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  created_at: string;
  updated_at: string;
}

export interface Issue {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  source: string;
  assignee_id: string;
  due_date: string;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  resolution: string;
  created_at: string;
  updated_at: string;
}

export interface Document {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  document_type: string;
  file_path: string;
  status: 'draft' | 'review' | 'approved' | 'archived';
  owner_id: string;
  versions: DocumentVersion[];
  created_at: string;
  updated_at: string;
}

export interface DocumentVersion {
  id: string;
  document_id: string;
  version_number: string;
  file_path: string;
  changes_summary: string;
  created_by: string;
  created_at: string;
}

export type AssetType = 'application' | 'infrastructure' | 'data' | 'cloud' | 'third_party';

export interface ITAsset {
  id: number;
  tenant_id: number;
  name: string;
  description?: string;
  asset_type: AssetType;
  owner_id?: number;
  owner_name?: string;
  custodian?: string;
  host_name?: string;
  ip_address?: string;
  criticality: 'low' | 'medium' | 'high' | 'critical';
  confidentiality_rating?: number;
  integrity_rating?: number;
  availability_rating?: number;
  valuation?: number;
  vendor?: string;
  location?: string;
  status: 'active' | 'inactive' | 'decommissioned';
  cde_environment?: boolean;
  created_at: string;
}

export interface AssetDetail extends ITAsset {
  linked_controls: Array<{id: number; code: string; title: string}>;
  linked_framework_controls: Array<{id: number; control_ref: string; title: string; framework_name: string}>;
  linked_risks: Array<{id: number; title: string; risk_score: number}>;
  linked_evidence: Array<{id: number; name: string; status: string}>;
  risk_assessments: Array<{id: number; risk_score: number; coverage_percentage: number; assessment_date: string}>;
  coverage_percentage?: number;
}

export interface CertificationJourney {
  id: number;
  tenant_id: number;
  framework_id?: number | null;
  uploaded_framework_id?: number | null;
  framework?: Framework;
  framework_name?: string;
  framework_classification?: 'certification' | 'compliance';
  framework_type?: string;
  framework_overview?: {
    classification: 'certification' | 'compliance';
    purpose?: string | null;
    scope?: string | null;
    objectives?: string[];
    target_audience?: string | null;
    classification_reasoning?: string | null;
    regulatory_authority?: string | null;
    adoption_approach?: string[];
  };
  name: string;
  target_date?: string;
  started_at: string;
  completed_at?: string;
  status: 'not_started' | 'in_progress' | 'completed' | 'on_hold';
  current_phase: number;
  notes?: string;
  progress?: ProgressSummary;
}

export interface ControlImplementation {
  id: number;
  journey_id: number;
  framework_control_id: number;
  framework_control?: FrameworkControl;
  status: 'not_started' | 'in_progress' | 'implemented' | 'verified' | 'not_applicable';
  implementation_notes?: string;
  implementation_date?: string;
  verified_date?: string;
  is_applicable: boolean;
  priority: number;
  evidence_attachments?: ImplementationEvidence[];
}

export interface ImplementationEvidence {
  id: number;
  implementation_id: number;
  file_name?: string;
  file_path?: string;
  uploaded_at: string;
  ai_confidence_score?: number;
  ai_assessment_status?: string;
  ai_assessment_notes?: string;
  ai_matched_controls?: number[];
  review_status: 'pending' | 'approved' | 'rejected';
  review_notes?: string;
}

export interface ProgressSummary {
  total_controls: number;
  implemented_count: number;
  verified_count: number;
  in_progress_count: number;
  not_started_count: number;
  not_applicable_count: number;
  completion_percentage: number;
  with_evidence_count: number;
  fully_evidenced_count: number;
  approved_evidence_controls: number;
  evidence_coverage_percentage: number;
  readiness_percentage: number;
  by_domain: { domain_id: number | string; domain_name: string; total: number; completed: number; in_progress: number; not_started: number }[];
  by_status?: Record<string, number>;
}

export interface GapAnalysis {
  missing_evidence: { control_id: number; control_code: string; control_name: string }[];
  not_implemented: { control_id: number; control_code: string; control_name: string; priority: number }[];
  pending_verification: { control_id: number; control_code: string; control_name: string }[];
}

export interface FrameworkControl {
  id: number;
  code: string;
  name: string;
  statement?: string;
  control_objective?: string;
  is_mandatory: boolean;
  risk_category?: string;
  evidence_type?: string;
  objective?: { id: number; code: string; name: string; domain?: { id: number; code: string; name: string } };
}

export interface EvidenceRequirement {
  type: string;
  title: string;
  description: string;
  is_required?: boolean;
  artifact_examples?: string[];
  review_frequency?: string;
}

export interface SubControlWithEvidence {
  id: number;
  code: string;
  name: string;
  description: string;
  parent_section?: string;
  evidence_recommendations: string[];
  evidence_requirements?: EvidenceRequirement[];
  ai_matching_keywords?: string[];
  sub_controls?: SubControlWithEvidence[];
}

export interface ControlEvidence {
  id: number;
  file_name?: string;
  file_size?: number;
  uploaded_at: string;
  ai_confidence_score?: number;
  review_status: 'pending' | 'approved' | 'rejected';
  ai_assessment_status?: 'completed' | 'processing' | 'pending_assessment' | 'pending_ocr' | 'pending';
  ai_assessment_summary?: string;
}

export interface CertificationControl {
  id: number;
  journey_id: number;
  framework_control_id: number;
  parsed_control_id?: number;
  control_code: string;
  original_control_code?: string;
  system_control_code?: string;
  control_name: string;
  control_statement: string;
  control_statement_full?: string;
  domain_id: number;
  domain_code: string;
  domain_name: string;
  objective_code?: string;
  objective_name?: string;
  status: string;
  implementation_notes?: string;
  implementation_date?: string;
  verified_date?: string;
  is_applicable: boolean;
  priority: number;
  sub_controls: SubControlWithEvidence[];
  evidence_requirements: EvidenceRequirement[];
  evidence_recommendations?: string[];
  evidence: ControlEvidence[];
  evidence_count: number;
  required_evidence_count: number;
  approved_evidence_count?: number;
  evidence_coverage?: number;
  status_source?: string;
}

// Advanced ERM Types
export type KRIMetricType = 'percentage' | 'count' | 'currency' | 'ratio' | 'score' | 'custom';
export type KRIThresholdDirection = 'higher_is_better' | 'lower_is_better';
export type KRIFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
export type KRIStatus = 'green' | 'amber' | 'red' | 'unknown';

export interface RiskKRI {
  id: number;
  risk_id: number;
  name: string;
  description?: string;
  metric_type: KRIMetricType;
  unit?: string;
  green_threshold?: number;
  amber_threshold?: number;
  threshold_direction: KRIThresholdDirection;
  frequency: KRIFrequency;
  data_source?: string;
  owner_id?: number;
  current_value?: number;
  last_measured_at?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  current_status?: KRIStatus;
  risk_title?: string;
  measurements?: RiskKRIMeasurement[];
}

export interface RiskKRIMeasurement {
  id: number;
  kri_id: number;
  value: number;
  status: KRIStatus;
  measured_at: string;
  measured_by?: number;
  notes?: string;
}

export interface RiskKRICreate {
  risk_id: number;
  name: string;
  description?: string;
  metric_type: KRIMetricType;
  unit?: string;
  green_threshold?: number;
  amber_threshold?: number;
  threshold_direction?: KRIThresholdDirection;
  frequency?: KRIFrequency;
  data_source?: string;
  owner_id?: number;
}

export interface RiskKRIUpdate {
  name?: string;
  description?: string;
  metric_type?: KRIMetricType;
  unit?: string;
  green_threshold?: number;
  amber_threshold?: number;
  threshold_direction?: KRIThresholdDirection;
  frequency?: KRIFrequency;
  data_source?: string;
  owner_id?: number;
  is_active?: boolean;
}

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'open' | 'investigating' | 'mitigating' | 'resolved' | 'closed';

export interface RiskIncident {
  id: number;
  tenant_id: number;
  risk_id?: number;
  risk_title?: string;
  title: string;
  description?: string;
  incident_date: string;
  discovered_date?: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  financial_impact?: number;
  operational_impact?: string;
  root_cause?: string;
  corrective_actions?: string;
  lessons_learned?: string;
  reported_by?: number;
  assigned_to?: number;
  resolved_at?: string;
  created_at: string;
  updated_at: string;
}

export interface RiskIncidentCreate {
  risk_id?: number;
  title: string;
  description?: string;
  incident_date: string;
  severity: IncidentSeverity;
  financial_impact?: number;
  operational_impact?: string;
  root_cause?: string;
  corrective_actions?: string;
  assigned_to?: number;
}

export interface RiskIncidentUpdate {
  title?: string;
  description?: string;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  financial_impact?: number;
  operational_impact?: string;
  root_cause?: string;
  corrective_actions?: string;
  lessons_learned?: string;
  assigned_to?: number;
}

export type ReviewCycle = 'monthly' | 'quarterly' | 'semi_annual' | 'annual';
export type ReviewType = 'periodic' | 'triggered' | 'ad_hoc' | 'audit';
export type ReviewStatus = 'pending' | 'in_review' | 'completed' | 'skipped' | 'overdue';

export interface RiskReview {
  id: number;
  risk_id: number;
  risk_title?: string;
  review_cycle: ReviewCycle;
  review_type: ReviewType;
  status: ReviewStatus;
  due_date: string;
  started_at?: string;
  completed_at?: string;
  reviewer_id?: number;
  findings?: string;
  recommendations?: string;
  previous_inherent_score?: number;
  previous_residual_score?: number;
  new_inherent_score?: number;
  new_residual_score?: number;
  created_at: string;
  updated_at: string;
}

export interface RiskReviewCreate {
  risk_id: number;
  review_cycle?: ReviewCycle;
  review_type?: ReviewType;
  due_date: string;
  reviewer_id?: number;
}

export interface RiskReviewUpdate {
  status?: ReviewStatus;
  findings?: string;
  recommendations?: string;
  new_inherent_score?: number;
  new_residual_score?: number;
}

export type DependencyType = 'causes' | 'caused_by' | 'related' | 'amplifies' | 'mitigates';

export interface RiskDependency {
  id: number;
  source_risk_id: number;
  target_risk_id: number;
  dependency_type: DependencyType;
  strength: number;
  description?: string;
  source_risk_title?: string;
  target_risk_title?: string;
  created_at: string;
}

export interface RiskDependencyCreate {
  source_risk_id: number;
  target_risk_id: number;
  dependency_type: DependencyType;
  strength?: number;
  description?: string;
}

export interface CascadeAnalysis {
  risk_id: number;
  risk_title: string;
  direct_impacts: Array<{id: number; title: string; type: string; strength: number}>;
  indirect_impacts: Array<{id: number; title: string; path: number[]; cumulative_strength: number}>;
  total_cascade_score: number;
}

export type ReportType = 'executive' | 'board' | 'department' | 'audit' | 'trend' | 'custom';
export type ReportFormat = 'pdf' | 'xlsx' | 'json';
export type ReportStatus = 'draft' | 'generating' | 'ready' | 'failed';

export interface RiskReport {
  id: number;
  tenant_id: number;
  name: string;
  description?: string;
  report_type: ReportType;
  format: ReportFormat;
  status: ReportStatus;
  parameters?: Record<string, unknown>;
  file_path?: string;
  generated_at?: string;
  generated_by?: number;
  created_at: string;
}

export interface RiskReportCreate {
  name: string;
  description?: string;
  report_type: ReportType;
  format?: ReportFormat;
  parameters?: Record<string, unknown>;
}

export interface ExecutiveDashboard {
  summary: {
    total_risks: number;
    critical_risks: number;
    high_risks: number;
    risks_within_appetite: number;
    risks_exceeding_appetite: number;
    avg_risk_score: number;
    risk_score_trend: number;
  };
  top_risks: Array<{id: number; title: string; score: number; trend: string}>;
  kri_alerts: Array<{id: number; name: string; status: string; value: number}>;
  recent_incidents: Array<{id: number; title: string; severity: string; date: string}>;
  upcoming_reviews: Array<{id: number; risk_title: string; due_date: string}>;
}

export interface BoardReportData {
  period: string;
  risk_profile_summary: {
    total_risks: number;
    by_category: Record<string, number>;
    by_status: Record<string, number>;
    new_risks: number;
    closed_risks: number;
  };
  key_risk_changes: Array<{
    risk_id: number;
    title: string;
    previous_score: number;
    current_score: number;
    change: number;
    reason: string;
  }>;
  control_effectiveness: {
    effective: number;
    partially_effective: number;
    ineffective: number;
  };
  emerging_risks: string[];
  recommendations: string[];
}

export interface DepartmentRiskSummary {
  department_id: number;
  department_name: string;
  total_risks: number;
  by_category: Record<string, number>;
  by_status: Record<string, number>;
  avg_risk_score: number;
  top_risks: Array<{id: number; title: string; score: number}>;
  kri_summary: {green: number; amber: number; red: number};
  pending_reviews: number;
  open_incidents: number;
}

export interface RiskTrendData {
  date: string;
  total_risks: number;
  avg_inherent_score: number;
  avg_residual_score: number;
  open_risks: number;
  critical_risks: number;
}

export interface AggregatedRiskView {
  category: string;
  total_count: number;
  total_inherent_exposure: number;
  total_residual_exposure: number;
  avg_inherent_score: number;
  avg_residual_score: number;
  top_risk: {id: number; title: string; score: number} | null;
}

export interface AppetiteBreach {
  risk_id: number;
  risk_title: string;
  category: string;
  appetite_threshold: number;
  current_score: number;
  breach_percentage: number;
  days_in_breach: number;
}

export interface IncidentDashboard {
  total_incidents: number;
  by_severity: Record<string, number>;
  by_status: Record<string, number>;
  total_financial_impact: number;
  open_incidents: number;
  investigating?: number;
  resolved_this_month?: number;
  avg_resolution_time_days: number;
  recent_incidents: Array<{id: number; title: string; severity: string; status: string}>;
}

export type GovernanceDocumentType = 'policy' | 'procedure' | 'standard' | 'guideline' | 'template' | 'other';
export type GovernanceDocumentStatus = 'draft' | 'pending_review' | 'pending_approval' | 'approved' | 'published' | 'retired' | 'archived';

export interface GovernanceDocument {
  id: number;
  tenant_id: number;
  title: string;
  description?: string;
  document_type: GovernanceDocumentType;
  category?: string;
  owner_id?: number;
  owner_name?: string;
  department?: string;
  status: GovernanceDocumentStatus;
  version_number: string;
  effective_date?: string;
  next_review_date?: string;
  review_frequency_months?: number;
  content?: string;
  file_path?: string;
  is_mandatory: boolean;
  requires_acknowledgment: boolean;
  acknowledgment_count?: number;
  approval_workflow_id?: number;
  created_at: string;
  updated_at: string;
}

export interface GovernanceDocumentVersion {
  id: number;
  document_id: number;
  version_number: string;
  changes_summary?: string;
  content?: string;
  file_path?: string;
  created_by?: number;
  created_by_name?: string;
  approved_by?: number;
  approved_at?: string;
  is_current: boolean;
  created_at: string;
}

export interface DocumentApprovalStep {
  id: number;
  workflow_id: number;
  step_order: number;
  approver_id?: number;
  approver_name?: string;
  approver_role?: string;
  status: 'pending' | 'approved' | 'rejected' | 'skipped';
  comments?: string;
  decided_at?: string;
  due_date?: string;
  document_id?: number;
  document_title?: string;
  created_at: string;
}

export interface GovernanceDashboard {
  total_documents: number;
  by_type: Record<string, number>;
  by_status: Record<string, number>;
  pending_approvals: number;
  overdue_reviews: number;
  upcoming_reviews: number;
  recently_updated: Array<{id: number; title: string; updated_at: string}>;
  expiring_soon: Array<{id: number; title: string; next_review_date: string}>;
}

export interface WorkflowDashboard {
  pending_my_approval: number;
  pending_all: number;
  overdue: number;
  approved_today: number;
  rejected_today: number;
  documents_awaiting_approval: number;
}

export interface PendingApprovalItem {
  step_id: number;
  document_id: number;
  document_title: string;
  document_code?: string;
  doc_type: string;
  step_sequence: number;
  step_name: string;
  requested_at?: string;
  due_date?: string;
  is_overdue: boolean;
  owner_name?: string;
  days_overdue?: number;
}

export interface GovernanceActionReviewItem {
  id: number;
  action_type: string;
  action_description: string;
  entity_type: string;
  entity_id?: number;
  review_status: string;
  action_user_id: number;
  action_user_name?: string;
  action_date: string;
  action_metadata?: Record<string, any>;
  review_notes?: string;
  reviewer_id?: number;
  reviewer_name?: string;
  review_started_at?: string;
  review_completed_at?: string;
  // Additional fields when entity is a governance_document
  document_title?: string;
  document_code?: string;
  doc_type?: string;
  document_status?: string;
}


export type FrameworkUploadStatus = 'pending' | 'processing' | 'text_extracted' | 'parsed' | 'aligned' | 'completed' | 'failed';
export type ParsedControlStatus = 'pending_review' | 'verified' | 'rejected';
export type AssessmentStatus = 'draft' | 'in_progress' | 'completed' | 'archived';
export type AssessmentItemStatus = 'not_started' | 'in_progress' | 'compliant' | 'partially_compliant' | 'non_compliant' | 'not_applicable';

export interface UploadedFramework {
  id: number;
  tenant_id: number;
  filename: string;
  original_filename: string;
  file_type: string;
  file_size: number;
  framework_name?: string;
  framework_version?: string;
  source?: string;
  status: FrameworkUploadStatus;
  extracted_text?: string;
  extracted_text_length?: number;
  control_count?: number;
  alignment_count?: number;
  error_message?: string;
  uploaded_by?: number;
  uploaded_at: string;
  processed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface ParsedFrameworkControl {
  id: number;
  uploaded_framework_id: number;
  control_id: string;
  control_title: string;
  control_description?: string;
  control_category?: string;
  parent_control_id?: string;
  hierarchy_level: number;
  implementation_guidance?: string;
  testing_procedures?: string;
  evidence_requirements?: string;
  control_type?: string;
  is_mandatory: boolean;
  status: ParsedControlStatus;
  confidence_score?: number;
  verified_by?: number;
  verified_at?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface ControlEvidenceMapping {
  id: number;
  parsed_control_id: number;
  evidence_type: string;
  evidence_description?: string;
  is_required: boolean;
  sample_evidence?: string;
  created_at: string;
}

export interface FrameworkControlAlignment {
  id: number;
  uploaded_framework_id: number;
  parsed_control_id: number;
  existing_control_id?: number;
  existing_control_code?: string;
  existing_control_name?: string;
  alignment_type: 'exact' | 'partial' | 'related' | 'no_match';
  similarity_score?: number;
  alignment_notes?: string;
  is_verified: boolean;
  verified_by?: number;
  verified_at?: string;
  created_at: string;
  updated_at: string;
  parsed_control?: ParsedFrameworkControl;
}

export interface FrameworkAssessment {
  id: number;
  tenant_id: number;
  uploaded_framework_id: number;
  name: string;
  description?: string;
  status: AssessmentStatus;
  assessment_date?: string;
  due_date?: string;
  assessor_id?: number;
  assessor_name?: string;
  total_controls: number;
  assessed_controls: number;
  compliant_count: number;
  partially_compliant_count: number;
  non_compliant_count: number;
  not_applicable_count: number;
  completion_percentage: number;
  overall_score?: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  uploaded_framework?: UploadedFramework;
}

export interface AssessmentItem {
  id: number;
  assessment_id: number;
  parsed_control_id: number;
  status: AssessmentItemStatus;
  compliance_notes?: string;
  gap_description?: string;
  remediation_plan?: string;
  remediation_due_date?: string;
  remediation_owner_id?: number;
  remediation_owner_name?: string;
  evidence_count: number;
  assessed_by?: number;
  assessed_at?: string;
  created_at: string;
  updated_at: string;
  parsed_control?: ParsedFrameworkControl;
}

export interface AssessmentEvidence {
  id: number;
  assessment_item_id: number;
  filename: string;
  original_filename: string;
  file_type: string;
  file_size: number;
  description?: string;
  uploaded_by?: number;
  uploaded_at: string;
  created_at: string;
}

export interface AssessmentRemediation {
  id: number;
  assessment_item_id: number;
  title: string;
  description?: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'open' | 'in_progress' | 'completed' | 'cancelled';
  owner_id?: number;
  owner_name?: string;
  due_date?: string;
  completed_at?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}
