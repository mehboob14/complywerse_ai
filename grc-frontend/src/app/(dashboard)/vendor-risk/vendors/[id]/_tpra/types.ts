// Shared TypeScript types for the productionized TPRA 11-stage lifecycle UI.
// Mirror the backend serializers in grc/modules/vendor_risk/tpra/api.py.

export type StageStatus = 'not_started' | 'in_progress' | 'blocked' | 'complete' | 'skipped';
export type Tier = 'critical' | 'high' | 'medium' | 'low';
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface StageMeta {
  key: string;
  order: number;
  label: string;
  phase: string;
  gate: boolean;
}

export interface GateResult {
  passed: boolean;
  blockers: string[];
  is_gate?: boolean;
}

export interface StageInstance {
  id: number;
  stage_key: string;
  stage_order: number;
  is_gate: boolean;
  status: StageStatus;
  started_at: string | null;
  completed_at: string | null;
  assigned_roles: Array<{ role?: string; user_id?: number }>;
  exit_criteria_result: { passed?: boolean; blockers?: string[] };
  gate_decision: { decision?: string; by?: number | null; at?: string; rationale?: string | null };
  skipped_reason: string | null;
  row_version: number;
}

export interface DomainScore {
  posture: number;
  inherent: number;
  residual: number;
  rating: string;
  answered: number;
  total: number;
}

export interface TpraAssessment {
  id: number;
  vendor_id: number;
  version_no: number;
  supersedes_id: number | null;
  lifecycle_status: string;
  current_stage: string;
  inherent_tier: string | null;
  inherent_score: number | null;
  residual_rating: string | null;
  residual_score: number | null;
  domain_scores: Record<string, DomainScore>;
  status: string;
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface LifecycleResponse {
  vendor_id: number;
  assessment: TpraAssessment | null;
  stages: StageInstance[];
  current: string | null;
  gate: GateResult | null;
}

export interface Finding {
  id: number;
  assessment_id: number;
  vendor_id: number;
  domain: string;
  severity: Severity | string;
  title: string | null;
  description: string | null;
  status: string;
  is_critical_control_fail: boolean;
  source_response_id: number | null;
  linked_risk_id: number | null;
  row_version: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Remediation {
  id: number;
  finding_id: number;
  title: string | null;
  plan: string | null;
  treatment_type: string;
  owner_id: number | null;
  due_date: string | null;
  status: string;
  completed_at: string | null;
  row_version: number;
}

export interface Acceptance {
  id: number;
  finding_id: number;
  rationale: string | null;
  accepted_by: number | null;
  accepted_at: string | null;
  expiry: string | null;
  status: string;
  row_version: number;
}

export interface FindingDetail {
  finding: Finding;
  remediations: Remediation[];
  acceptances: Acceptance[];
}

export interface Contract {
  id: number;
  vendor_id: number;
  assessment_id: number | null;
  contract_type: string;
  title: string | null;
  terms: string | null;
  document_id: number | null;
  effective_date: string | null;
  renewal_date: string | null;
  expiry_date: string | null;
  status: string;
  row_version: number;
}

export interface Obligation {
  id: number;
  contract_id: number;
  obligation: string;
  control_ref: string | null;
  finding_id: number | null;
  renewal_date: string | null;
  status: string;
  row_version: number;
}

export interface Approval {
  id: number;
  assessment_id: number;
  decision: string;
  conditions: string[];
  recommendation: string | null;
  rationale: string | null;
  approver_id: number | null;
  residual_rating: string | null;
  created_at: string;
}

export interface MonitoringSignal {
  id: number;
  vendor_id: number;
  signal_type: string;
  severity: string;
  source: string | null;
  title: string | null;
  detail: string | null;
  occurred_at: string | null;
  triggered_reassessment: boolean;
  triggered_assessment_id: number | null;
  acknowledged: boolean;
  row_version: number;
}

export interface AdvanceResult {
  advanced: boolean;
  from: string;
  to?: string;
  blockers: string[];
}
