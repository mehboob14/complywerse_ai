// What the record page reads, as the server sends it (GET /evidence-mgmt/items/{id}, .../links/{id}/controls, .../cross-links/{id}/all-links, .../ai/{id}/latest-assessment,
// .../clause-mappings, .../ai-link-status). Types only: the models next to this file are pure and `node --test` reads them.
import type { ReviewBrief } from '../../_review.tsx';

export interface EvidenceVersion { id: number; version_number: number; changes: string | null; created_by: number | null; created_at: string | null }

export interface AssessmentBrief {
  id: number;
  relevance_score: number | null;
  adequacy_score: number | null;
  confidence_score: number | null;
  audit_readiness: number | null;
  content_summary: string | null;
  recommendations?: string[] | null;
  gap_analysis: { detected_controls?: string[]; compliance_frameworks?: string[]; gaps?: string[]; recommendations?: string[] } | null;
  assessed_at: string | null;
}

export interface EvidenceDetail {
  id: number;
  name: string;
  description: string | null;
  file_path: string | null;
  file_name: string | null;
  file_type: string | null;
  version: number;
  uploaded_by: number | null;
  uploader_name: string | null;
  owner_id: number | null;
  owner_name: string | null;
  uploaded_at: string | null;
  status: string;
  ocr_status: string;
  ocr_processed_at: string | null;
  evidence_type: string | null;
  collection_date: string | null;
  validity_period_days: number | null;
  expiry_date: string | null;
  is_stale: boolean;
  /** past its validity, worked out by the server when it read the file */
  lapsed?: boolean;
  source_system: string | null;
  content_summary: string | null;
  quality_score: number | null;
  ai_review?: ReviewBrief | null;
  submitted_by: number | null;
  submitted_at: string | null;
  reviewed_by: number | null;
  reviewed_at: string | null;
  review_comments: string | null;
  approved_by: number | null;
  approved_at: string | null;
  versions: EvidenceVersion[];
  latest_assessment: AssessmentBrief | null;
  custom_values?: Record<string, unknown> | null;
}

export interface ClauseMapping {
  framework_name: string;
  control_id: string;
  clause_reference: string;
  control_title: string;
  matching_rationale: string;
  confidence: number;
  coverage_type: string;
}

export interface LatestAssessment {
  id: number;
  evidence_id: number;
  relevance_score: number | null;
  adequacy_score: number | null;
  confidence_score: number | null;
  audit_readiness: number | null;
  content_summary: string | null;
  compliance_gaps: string[];
  recommendations: string[];
  assessed_at: string;
}

export interface AiLinkStatus { evidence_id: number; linked_controls: Record<string, { mapping_id: number; control_id: string; original_reference: string; framework_name: string }>; total_linked: number }

/** One group of `all-links`: the server's total and the links. */
export interface LinkGroup<L> { total: number; links: L[] }

export interface AllLinks {
  evidence_id: number;
  risks?: LinkGroup<{ id: number; risk_id: number; risk: { title: string; status: string; inherent_score: number | null; residual_score: number | null } | null }>;
  assets?: LinkGroup<{ id: number; asset_id: number; link_type: string; asset: { name: string; asset_type: string; criticality: string } | null }>;
  incidents?: LinkGroup<{ id: number; incident_id: number; link_type: string | null; incident: { title: string; severity: string; status: string } | null }>;
  policy_statements?: LinkGroup<{
    id: number; policy_statement_id: number; link_type: string | null;
    policy_statement: { statement_code: string; statement_summary: string | null; document_id?: number | null; document_title?: string | null; source_section?: string | null } | null;
  }>;
  assessments?: LinkGroup<{ id: number; assessment_id: number | null; assessment_name: string | null; item_number: string | null; area_domain: string | null; control_description: string | null; link_status: string }>;
  audit_observations?: LinkGroup<{ id: number; kind: string; record_id: number; link_type: string | null; code: string | null; title: string | null; status: string | null; priority: string | null; source: string | null }>;
  total_links?: number;
}

/** The framework requirements a common control fulfils, in the frameworks the organisation is assessed against. */
export interface FulfilledRequirements { key: string; label: string; codes: string[] }

export interface MappedControl {
  id: number;
  clause_reference?: string | null;
  coverage_type?: string | null;
  is_locked?: boolean;
  // `scf_id` is the id people know ("IAC-01"); `code` is the table's own ("SCF-IAC-01")
  normalized_control?: { id: number; code: string; name: string; scf_id?: string | null; requirements?: FulfilledRequirements[] } | null;
  framework_control?: { id: number; code: string; name: string } | null;
  parsed_control?: { id: number; control_id: string; title: string } | null;
}

export interface ControlsResponse {
  evidence_id: number;
  total_mappings: number;
  normalized_controls: MappedControl[];
  by_framework: Array<{ framework_id: number; framework_name: string; framework_code: string; controls: MappedControl[] }>;
  /** mappings that no longer resolve to a control: counted in total_mappings, so listed too */
  unresolved?: Array<{ id: number; control_code?: string | null; framework_name?: string | null; clause_reference?: string | null; coverage_type?: string | null; is_locked?: boolean }>;
}
