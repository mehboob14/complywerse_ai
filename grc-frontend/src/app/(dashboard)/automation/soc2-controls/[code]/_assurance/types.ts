// Shapes returned by /automation/common/controls/{scf_id}/assurance[...].
// Mirrors backend/grc/modules/automation/assurance.py.

export type ArtifactState = 'satisfied' | 'pending_review' | 'failing' | 'stale' | 'missing';
export type EvidenceState = 'approved' | 'pending' | 'stale' | 'rejected';
export type CollectionMethod = 'automated' | 'manual' | 'hybrid';

export interface AssuranceEvidence {
  mapping_id: number;
  evidence_id: number;
  artifact_key: string | null;
  name: string;
  file_name: string | null;
  file_type: string | null;
  evidence_type: string | null;
  status: string | null;
  state: EvidenceState;
  expired: boolean;
  expiry_date: string | null;
  collection_date: string | null;
  uploaded_at: string | null;
  coverage_type: string | null;
  created_by_ai: boolean;
  clause_reference: string | null;
  /** A workbench test sample — unlinked from its procedure, not from here. */
  locked: boolean;
}

export interface AssuranceArtifact {
  key: string;
  name: string;
  description: string;
  collection_method: CollectionMethod;
  required_by: string[];
  /** The requirements that ask for it, e.g. "PCI DSS 6.3.2". Empty for the consolidated set. */
  references?: string[];
  filetype: string | null;
  /** policy | procedure | register | log | report | configuration | record | … */
  type?: string;
  mandatory: boolean;
  state: ArtifactState;
  evidence: AssuranceEvidence[];
}

export interface AutomatedResult {
  check_id: string;
  connector: string;
  ao_id: string | null;
  resource: string | null;
  status: string;
  severity: string | null;
  population_size: number | null;
  tested_size: number | null;
  truncated: boolean;
  detail: string | null;
  collected_at: string | null;
  expires_at: string | null;
  expired: boolean;
}

export interface WorkItem {
  work_item_id: number;
  implementation_status: string | null;
  design_effectiveness: string | null;
  operating_effectiveness: string | null;
  last_tested_at: string | null;
  next_test_date: string | null;
  frequency: string | null;
  priority: string | null;
  is_key_control: boolean;
}

export type StepResult = 'pass' | 'exception' | 'not_applicable';
export type TestResult = 'effective' | 'partially_effective' | 'ineffective';

export interface ProcedureFile {
  id: number;
  evidence_id: number | null;
  file_name: string | null;
  review_status: string;
  uploaded_by: string | null;
  uploaded_at: string | null;
}

export interface Procedure {
  id: number;
  seq: number;
  procedure_type: string | null;
  description: string;
  expected_result: string | null;
  frequency: string | null;
  sample_size: string | null;
  /** scf_objective | ai | template | manual */
  source: string | null;
  ao_ids: string[];
  result: StepResult | null;
  result_note: string | null;
  /** The Controls catalog's checklist tick. */
  is_checked: boolean;
  tested_by: string | null;
  tested_at: string | null;
  files: ProcedureFile[];
}

export interface TestSample {
  id: number;
  seq: number;
  item_ref: string | null;
  procedure_id: number | null;
  result: StepResult | null;
  note: string | null;
  evidence_id: number | null;
  tested_by: string | null;
  tested_at: string | null;
}

export interface TestRecord {
  id: number;
  test_type: 'design' | 'operating';
  status: 'in_progress' | 'completed' | 'reviewed';
  result: TestResult | null;
  test_date: string | null;
  period_start: string | null;
  period_end: string | null;
  tester_id: number | null;
  tester: string | null;
  reviewer_id: number | null;
  reviewer: string | null;
  reviewed_at: string | null;
  locked: boolean;
  independent_review: boolean | null;
  frequency: string | null;
  population_size: number | null;
  population_description: string | null;
  selection_method: string | null;
  sample_seed: number | null;
  tolerable_exceptions: number;
  sample_size: number | null;
  exceptions_found: number | null;
  conclusion_rationale: string | null;
  findings: string | null;
  recommendations: string | null;
  management_response: string | null;
  suggested_result: TestResult | null;
  samples: TestSample[];
}

/** A NIST SP 800-53A procedure an SCF objective cites. Public domain, so shown in full. */
export interface NistProcedure {
  /** The 800-53A label SCF cites, e.g. AC-02a.[01] or SA-08_ODP[01]. */
  ref: string;
  control: string;
  title: string;
  /** objective: NIST states it; odp: an organization-defined parameter; control: label not in this release. */
  match: 'objective' | 'odp' | 'control';
  objective: string | null;
  methods: Partial<Record<'EXAMINE' | 'INTERVIEW' | 'TEST', string[]>>;
}

export interface TestingRecord {
  procedures: Procedure[];
  control_files: ProcedureFile[];
  tests: TestRecord[];
  sampling?: {
    key_control: boolean;
    frequencies: { value: string; label: string }[];
    sizes: Record<string, number | null>;
  };
  designation?: string;
  /** SCF objective id -> the 800-53A procedures its origin cites. */
  nist?: Record<string, NistProcedure[]>;
  nist_source?: { title: string; version: string; url: string } | null;
}

export interface Readiness {
  total: number;
  satisfied: number;
  pending_review: number;
  failing: number;
  stale: number;
  missing: number;
}

export interface AssurancePayload {
  scf_id: string;
  normalized_control_id: number;
  work_item: WorkItem;
  /** CDPAS 6.5: satisfactory | partial | deficient | not_assessed … */
  designation: string;
  last_assessed_at: string | null;
  artifacts: AssuranceArtifact[];
  readiness: Readiness;
  evidence: AssuranceEvidence[];
  automated: { state: 'passing' | 'failing' | 'expired' | 'none'; results: AutomatedResult[] };
}

export interface Suggestion {
  evidence_id: number;
  score: number;
  signal: 'same_artifact' | 'crosswalk' | 'text';
  reasons: string[];
  name: string;
  file_name: string | null;
  evidence_type: string | null;
  status: string | null;
  already_on_control: boolean;
}

/** SCF assessment objectives, verbatim from the control detail payload. */
export interface Objective {
  ao_id: string;
  seq: number;
  objective: string;
  pptdf: string | null;
  rigor: string | null;
}
