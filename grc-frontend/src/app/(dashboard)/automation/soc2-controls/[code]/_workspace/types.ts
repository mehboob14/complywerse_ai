// Shapes of the control workspace: the assurance reads (backend/grc/modules/automation/assurance.py) and the control itself (automation/router.py).
import type { CustomControlProfile } from '@/lib/api';
import type { ApplicabilityBlock } from './applicabilityModel';

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

// ── the control itself (GET /automation/common/controls/{id}) ────────────────────────────────────────────────────────────────────────

export type BindingSource = 'covers' | 'soc2_fallback' | 'none';

export interface LinkedCheck {
  plugin_key: string;
  id: number | null;
  title: string | null;
  severity: string | null;
  seeded: boolean;
  source?: string;
  covers?: string[] | Record<string, string[]>;
  last_run: { status: string; started_at?: string | null; result_summary?: string | null } | null;
}

export interface ReqItem {
  code: string; reference: string; title: string | null; text: string | null; domain: string | null; resolved: boolean;
  /** how the code was matched: `exact` is code identity; `parent` / `child` are inferences across a granularity difference */
  match_mode: string; confidence: number | null;
}
export interface ReqGroup {
  framework: string; label: string; version: string | null; provenance: string; confidence: number | null; pivot_via: string | null;
  count: number; unresolved: number; match_modes: string[]; inferred_count: number; items: ReqItem[];
}

export interface Coverage {
  state: 'covered' | 'connect_one' | 'unbound' | 'manual';
  satisfied_by: string[];
  provider_count: number;
}

export interface TestExplanation {
  checks: string; rule: string | null; reads: string; call: string | null; fields: string[]; fails_when: string | null; excludes: string | null; when_empty: string | null;
  steps?: { label: string; text: string; code?: string | null }[];
  why?: string | null; fix?: string | null;
}
export interface TestReach { binding?: string | null; covers?: string[]; soc2?: string[] }
export interface ProviderTest extends TestReach {
  id: string; title: string; explain: TestExplanation | null;
  result: { status: string; detail: string | null; population: number | null; tested: number | null; failing_items: string[]; checked_at: string | null } | null;
}
export interface TestGroup {
  category: string; connected: boolean; status: string;
  providers: { provider: string; label: string; connected: boolean; checks: LinkedCheck[]; tests?: ProviderTest[] }[];
}

export interface ControlDetail {
  control_id: string;
  title: string;
  category?: string | null;
  domain?: string | null;
  sub_type?: string | null;
  checks?: LinkedCheck[];
  checks_count?: number;
  overall_status?: string;
  is_material?: boolean;
  conformity_cadence?: string | null;
  scope_id?: number | null;
  scope_frameworks?: { key: string; label: string }[];
  description?: string | null;
  control_question?: string | null;
  custom?: boolean;
  implements_scf_ids?: string[];
  bound_check_ids?: string[];
  binding_source?: BindingSource;
  binding_via?: string[];
  test_groups?: TestGroup[];
  related?: {
    family: { control_id: string; title: string | null }[];
    by_requirements: { control_id: string; title: string | null; shared: number; score: number | null; requirements?: string[] }[];
  };
  artifacts?: unknown[];
  objectives?: Objective[];
  objectives_note?: string | null;
  coverage?: Coverage;
  assurance_mode?: 'automated' | 'manual' | 'hybrid';
  implementation?: {
    target_maturity: string | null;
    maturity_levels: Record<string, string>;
    solutions: Record<string, string>;
    conformity_cadence: string | null;
    pptdf: string | null;
    maturity_from?: string | null;
    objective?: string | null;
    guidance?: string | null;
    testing_guidance?: string | null;
    authored?: boolean;
  };
  evidence?: {
    automated_count?: number;
    manual_count?: number;
    required?: { key: string; name: string; collection_method: 'automated' | 'hybrid' | 'manual' }[];
    consolidated?: { name: string; collection_method: 'automated' | 'hybrid' | 'manual' }[] | null;
    manual?: { name: string | null }[];
  };
  requirement_groups: ReqGroup[];
  requirement_count: number;
  framework_count: number;
  release: string;
  owner_user_id?: number | null;
  owner_name?: string | null;
  reviewer_user_id?: number | null;
  assigned_user_ids?: number[] | null;
  next_due_at?: string | null;
  ownership_status?: string | null;
  designation?: string | null;
  cmm_actual?: number | null;
  cmm_target?: number | null;
  cmm_target_default?: number;
  inheritance_type?: string | null;
  exception_id?: number | null;
  alternative_scf_id?: string | null;
  provider_vendor_id?: number | null;
  applicability?: ApplicabilityBlock;
  profile?: CustomControlProfile | null;
  link_counts?: Record<string, number>;
  implements_titles?: Record<string, string | null>;
  priority?: string | null;
  is_key_control?: boolean;
  implementation_status?: string | null;
  design_effectiveness?: string | null;
  operating_effectiveness?: string | null;
  last_tested_at?: string | null;
  next_test_date?: string | null;
}

/** The test plan (GET .../test-plan). */
export interface PlanCheck {
  provider: string; label: string; category?: string | null; id: string; title: string;
  explain: TestExplanation | null; connected: boolean; state: 'passing' | 'failing' | 'expired' | null;
}
export interface PlanMethod { type: 'examine' | 'interview' | 'test'; label: string; items: string[] }
export interface PlanNist { control: string; title?: string | null; methods: PlanMethod[]; refs: { ref: string; match: string; objective?: string | null }[] }
export interface PlanTest {
  ao_id: string; seq?: number | null; objective: string; pptdf?: string | null; rigor?: string | null;
  applies: boolean; not_applicable_reason: string | null;
  automated: PlanCheck[]; nist: PlanNist[];
  standard: { type: string; description: string; expected: string } | null;
}
export interface TestPlanData {
  scf_id: string;
  applicability: { state: 'applies' | 'not_applicable' | 'inherited' | 'alternative' | 'unscoped'; reason: string; source?: string | null; obligation_label?: string | null; exception: boolean };
  summary: { total: number; applies: number; not_applicable: number; automated: number; nist: number; standard: number };
  tests: PlanTest[];
  automated: PlanCheck[];
  scope: { has_facilities: boolean; processes_personal_data: boolean };
  nist_source: { title?: string | null; version?: string | null; url?: string | null } | null;
}
