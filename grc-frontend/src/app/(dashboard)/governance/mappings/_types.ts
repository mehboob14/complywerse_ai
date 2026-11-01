// The shapes the Mappings page reads (GET /governance/documents, /governance/mappings/document/{id}[/coverage], the gap-analysis recommendations, the ERM
// internal controls). Unchanged from the single-file page this was split out of; types only, so the pure model and the components can share them.

export interface DocumentItem {
  id: number;
  document_code: string | null;
  title: string;
  doc_type: string;
  status: string;
}

export interface ControlLink {
  id: number;
  internal_control_id: number;
  normalized_control_id: number;
  control_code: string | null;
  control_name: string | null;
  link_type: string;
  notes: string | null;
  created_at: string | null;
}

export interface InternalControl {
  id: number;
  control_id: string;
  name: string;
  description?: string;
  category?: string;
  sub_category?: string;
  source_document_id?: number | null;
}

export interface RecStatement {
  id: number;
  statement_code: string | null;
  snippet: string | null;
}

export interface RecommendedControl {
  control_kind: string; // normalized | framework | parsed | internal
  control_code: string | null;
  control_title: string | null;
  framework_name: string | null;
  domain: string | null;
  coverage_type: string | null;
  link_source: string | null; // ai | derived | gap
  max_confidence: number | null;
  statement_count: number;
  control_ref_id: number | null;
  clause_reference: string | null;
  description: string | null;
  is_linked: boolean;
  statements: RecStatement[];
  uploaded_framework_id?: number | null;
  rationale?: string | null;
  /** Present when sourced from gap-analysis recommended-controls. */
  finding_id?: number | null;
  source?: 'mapping' | 'gap';
  compliance_status?: string | null;
  gap_description?: string | null;
  missing_requirement?: string | null;
  remediation?: string | null;
  risk_severity?: string | null;
}

export interface GapRecommendedFinding {
  finding_id: number;
  clause_reference: string | null;
  clause_title: string | null;
  clause_requirement_text?: string | null;
  compliance_status: string;
  gap_description?: string | null;
  missing_requirement?: string | null;
  remediation_recommendation?: string | null;
  ai_reasoning?: string | null;
  confidence_score?: number | null;
  risk_severity?: string | null;
  framework_name: string | null;
  uploaded_framework_id: number | null;
  controls: Array<{
    kind: string;
    id: number;
    code: string | null;
    title: string | null;
    match_reason: string;
    already_linked: boolean;
    framework_name?: string | null;
    description?: string | null;
    domain?: string | null;
  }>;
}

type ScopeEntry = { id: number; name: string };
/** The frameworks a document is mapped against: the applicable and linked ones it was created with, and any added on its Mappings view. */
export type FrameworkScope = { applicable: ScopeEntry[]; linked: ScopeEntry[]; extra: ScopeEntry[] };

export interface DocumentMappings {
  document_id: number;
  document_title: string;
  control_links: ControlLink[];
  risk_links: unknown[];
  regulatory_links: unknown[];
  asset_links: unknown[];
  recommended_controls?: RecommendedControl[];
  // The framework scope (applicable ∪ linked ∪ added on the Mappings tab) the
  // backend filtered the recommendations to. Empty → no frameworks set.
  framework_scope_ids?: number[];
  framework_scope?: FrameworkScope;
}

// Full statement text keyed by statement id, for the mapping-detail popup.
export type StatementTextMap = Map<number, { code: string | null; text: string }>;

// Per-framework coverage (mapped/missing + the missing "gap" clauses), used to
// enrich the per-framework groups. From GET /governance/mappings/document/{id}/coverage.
export interface CoverageFramework {
  framework_id: number;
  framework_name: string;
  total_controls: number;
  mapped_count: number;
  missing_count: number;
  coverage_pct: number;
  missing_controls: Array<{ id: number; reference: string; title: string; domain: string | null }>;
}

/** Who may do what on the page, as `page.tsx` reads it (the two mapping rights, or `canEdit` in a document's own view, and the ERM right the control list needs). */
export interface MappingRights {
  canCreate: boolean;
  canDelete: boolean;
  /** may read the internal (ERM) controls: the control list is only asked for then */
  canErm: boolean;
  /** the rights are still being read: "may not" is not known yet */
  permissionsLoading: boolean;
}
