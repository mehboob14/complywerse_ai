// Shared types for the Compliance Assessments module.
// Mirrors the data model in the existing assessments pages.

export type ComplianceStatus =
  | 'complied'
  | 'partially_complied'
  | 'not_complied'
  | 'in_progress'
  | 'na';

export type Priority = 'critical' | 'high' | 'medium' | 'low';

export type AssessmentStatus = 'draft' | 'in_progress' | 'in_review' | 'completed';

export interface ControlItem {
  id: number | string;
  item_number: string;
  area_domain: string;
  control_description: string;
  compliance_status: ComplianceStatus;
  priority: Priority | null;
  gaps_identified: string | null;
  proposed_solution: string | null;
  responsible_party: string | null;
  timeline: string | null;
  evidence_reference: string | null;
  remarks: string | null;
  maturity_score: number | null; // 0..5
  risk_rating: 'High' | 'Medium' | 'Low' | null;
  remediation_status: 'Open' | 'In Progress' | 'Closed' | null;
  ai_evidence_recommendation?: string | null; // saved AI recommendation JSON
  evidence_count?: number; // real linked-evidence count
  // SLA / closure dates (drive the dynamic-SLA engine). ISO strings or null.
  created_at?: string | null;
  updated_at?: string | null;
  target_date?: string | null;
  closed_at?: string | null;
}

/** One flat assessment point across the tenant — feeds the closure board. */
export interface SlaPoint {
  id: number | string;
  assessment_id: number | string;
  assessment_name: string;
  assessment_type: string;
  assessment_format: string;
  item_number?: string | null;
  area_domain?: string | null;
  control_description?: string | null;
  priority?: string | null;
  compliance_status?: string | null;
  remediation_status?: string | null;
  timeline?: string | null;
  target_date?: string | null;
  closed_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface EvidenceRow {
  id: number | string;
  name: string;
  ext: string;
  meta: string;
  tone?: 'teal' | 'rose' | 'slate';
}

export interface AiRec {
  summary: string;
  recommendations: { evidence_type: string; description: string; priority: string; example_files?: string[] }[];
}

export interface NewControl {
  item_number?: string;
  area_domain: string;
  control_description: string;
  compliance_status?: string;
  priority?: string;
  responsible_party?: string;
  timeline?: string;
  gaps_identified?: string;
  proposed_solution?: string;
  remarks?: string;
}

export interface TenantUser { id: number | string; label: string; email?: string | null }

export interface ControlPatch {
  control_description?: string;
  compliance_status?: string;
  priority?: string;
  area_domain?: string;
  responsible_party?: string;
  timeline?: string;
  risk_rating?: string;
  maturity_score?: number;
  remediation_status?: string;
  gaps_identified?: string;
  proposed_solution?: string;
  evidence_reference?: string;
  remarks?: string;
}

export interface DetailApi {
  loadEvidence: (assessmentId: number | string, itemId: number | string) => Promise<EvidenceRow[]>;
  uploadEvidence: (assessmentId: number | string, itemId: number | string, file: File) => Promise<void>;
  generateAi: (assessmentId: number | string, itemId: number | string) => Promise<AiRec | null>;
  applyRemediation: (itemId: number | string, text: string) => Promise<void>;
  createControl: (assessmentId: number | string, payload: NewControl) => Promise<void>;
  updateControl: (assessmentId: number | string, itemId: number | string, patch: ControlPatch) => Promise<void>;
  exportReport: (assessment: Assessment) => void;
  /** Refresh an existing assessment from an updated workbook (same structure). */
  reupload: (assessmentId: number | string, file: File) => Promise<{ updated_count?: number; added_count?: number }>;
  /** GRC tenant users, for the Responsible-party dropdown. */
  tenantUsers?: TenantUser[];
}

export interface Assessment {
  id: number | string;
  name: string;
  type: string;          // "Internal Audit", "Maturity Model", ...
  framework: string;     // tab key: internal_audit | maturity | asvs | ...
  status: AssessmentStatus;
  score: number;         // 0..100 overall compliance
  total: number;         // control count
  counts: { complied: number; partial: number; not_complied: number; in_progress: number; na: number };
  assessedPct: number;
  openGaps: number;
  domainCount: number;
  assessor: string;
  due: string;
  source: string;
}

export interface EvidenceFile {
  name: string;
  ext: string;
  meta: string;
  tone?: 'teal' | 'rose' | 'slate';
}
