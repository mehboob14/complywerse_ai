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

export enum RiskCategory {
  STRATEGIC = 'strategic',
  OPERATIONAL = 'operational',
  FINANCIAL = 'financial',
  COMPLIANCE = 'compliance',
  REPUTATIONAL = 'reputational',
  TECHNOLOGY = 'technology',
  CYBERSECURITY = 'cybersecurity',
}

export interface Risk {
  id: string;
  tenant_id: string;
  title: string;
  description: string;
  category: RiskCategory;
  likelihood: number;
  impact: number;
  inherent_risk_score: number;
  residual_risk_score: number;
  risk_owner_id: string;
  status: 'identified' | 'assessed' | 'mitigated' | 'accepted' | 'closed';
  treatment_plan: string;
  target_date: string;
  created_at: string;
  updated_at: string;
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

export enum AssetType {
  SERVER = 'server',
  WORKSTATION = 'workstation',
  NETWORK_DEVICE = 'network_device',
  APPLICATION = 'application',
  DATABASE = 'database',
  CLOUD_SERVICE = 'cloud_service',
  IOT_DEVICE = 'iot_device',
}

export interface ITAsset {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  asset_type: AssetType;
  asset_tag: string;
  ip_address: string;
  hostname: string;
  owner_id: string;
  department: string;
  location: string;
  criticality: 'low' | 'medium' | 'high' | 'critical';
  status: 'active' | 'inactive' | 'decommissioned';
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CertificationJourney {
  id: number;
  tenant_id: number;
  framework_id: number;
  framework?: Framework;
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
  implemented: number;
  verified: number;
  in_progress: number;
  not_started: number;
  not_applicable: number;
  completion_percentage: number;
  by_domain: { domain_id: number; domain_name: string; total: number; completed: number }[];
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
  is_mandatory: boolean;
  objective?: { id: number; code: string; name: string; domain?: { id: number; code: string; name: string } };
}

export interface SubControlWithEvidence {
  id: number;
  code: string;
  name: string;
  description: string;
  evidence_recommendations: string[];
  ai_matching_keywords: string[];
}

export interface ControlEvidence {
  id: number;
  file_name?: string;
  file_size?: number;
  uploaded_at: string;
  ai_confidence_score?: number;
  review_status: 'pending' | 'approved' | 'rejected';
}

export interface CertificationControl {
  id: number;
  journey_id: number;
  framework_control_id: number;
  control_code: string;
  control_name: string;
  control_statement: string;
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
  evidence: ControlEvidence[];
  evidence_count: number;
  required_evidence_count: number;
}
