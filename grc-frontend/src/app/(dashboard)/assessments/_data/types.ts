// The shapes the Assessments Overview, the register and the Types page read from `/compliance/assessments` (`backend/grc/routers/compliance_assessments_router.py`; the contract is
// `ux-revamp-reports/G11_assess-backend_plan.md` section 4). Types only, so the pure models import them with `import type`.

/** A row of `GET /compliance/assessments?limit=1000&summary=0&all_formats=1`. */
export interface ListRow {
  id: number;
  name: string;
  assessment_type: string | null;
  assessment_format: string;
  /** the server's group: Cyber Security, NCA, Digital Operations, Privacy & Data, Audit, Other */
  category: string;
  source: string | null;
  file_name: string | null;
  status: string | null;
  due_date: string | null;
  assessor: string | null;
  overall_score: number | null;
  total_items: number | null;
  complied_count: number | null;
  partially_complied_count: number | null;
  not_complied_count: number | null;
  in_progress_count: number | null;
  na_count: number | null;
  scope_model: 'asset' | 'process' | 'system' | null;
  phase: 'scoping' | 'in_progress' | null;
  owner_id: number | null;
  owner_name: string | null;
  primary_asset_id: number | null;
  primary_asset_name: string | null;
  started_at: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface ListAnswer { assessments: ListRow[]; total: number }

export interface SlaCounts { gaps?: number; closed?: number; open?: number; overdue?: number }

/** One assessment of `GET /overview`: what the board scored (only the keys this area reads). */
export interface BoardEntry {
  id: number;
  name: string;
  format: string;
  family: string;
  status: string | null;
  n_items: number;
  /** 0 to 100; null when nothing is answered yet */
  content: number | null;
  /** 0 to 100; null when there is no gap to remediate */
  sla: number | null;
  sla_counts?: SlaCounts;
}

export interface BoardCategory { category: string; score: number | null; sla: number | null; count: number; assessments: BoardEntry[] }

/** `GET /overview` (no id): the board. */
export interface Board {
  as_of: string;
  performance: { score: number | null; grade: string | null; assessments: number };
  sla: { score: number | null; gaps: number; closed: number; open: number; overdue: number };
  attention: { overdue_gaps: number; open_gaps: number; not_started: number; unmapped_formats?: number };
  categories: BoardCategory[];
}

/** One open control assigned to the person (`GET /my-work` -> assigned_items). */
export interface MyItem {
  item_id: number;
  item_number: string | null;
  domain: string | null;
  description: string;
  compliance_status: string;
  priority: string | null;
  remediation_status: string | null;
  due: string | null;
  overdue: boolean;
  via: 'user' | 'team';
  assessment_id: number;
  assessment_name: string;
  assessment_format: string;
  category: string;
}

/** A draft the person owns that is still being scoped (`GET /my-work` -> scoping). */
export interface MyDraft {
  id: number;
  name: string;
  assessment_format: string;
  category: string;
  primary_asset_id: number | null;
  primary_asset_name: string | null;
  created_at: string | null;
  updated_at: string | null;
}

/** Evidence waiting at a tier the person approves (`GET /my-work` -> approvals; the `pending-approvals` row without its trail). */
export interface MyApproval {
  id: number;
  evidence_id: number | null;
  evidence_name: string | null;
  evidence_file_name: string | null;
  assessment_id: number | null;
  assessment_name: string | null;
  assessment_format: string | null;
  item_id: number | null;
  item_number: string | null;
  control_description: string | null;
  current_tier: number | null;
  status: string;
  can_approve: boolean;
  addressed_to_me: boolean;
  submitted_by_name: string | null;
  submitted_at: string | null;
}

export interface MyWork {
  as_of: string;
  counts: { assigned: number; overdue: number; to_scope: number; to_approve: number; can_decide: number };
  assigned_items: MyItem[];
  scoping: MyDraft[];
  approvals: MyApproval[];
}

/** One point of `GET /points` (a control of an assessment the board counts), with the fields the closure clock reads: the same ones a control of the workspace carries. */
export interface Point {
  id: number;
  assessment_id: number;
  assessment_name?: string;
  assessment_format?: string;
  item_number?: string | null;
  area_domain?: string | null;
  control_description?: string | null;
  priority?: string | null;
  compliance_status?: string | null;
  remediation_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  target_date?: string | null;
  closed_at?: string | null;
  timeline?: string | null;
}

/** `GET /sla-policy`. */
export interface Policy {
  critical_days: number;
  high_days: number;
  medium_days: number;
  low_days: number;
  due_soon_days: number;
  score_closed_ontime?: number;
  score_closed_late?: number;
  score_on_track?: number;
  score_due_soon?: number;
  score_overdue?: number;
  score_no_date?: number;
}

/** `GET /templates`: the questionnaires of the Cyber Security types (only the keys this area reads). */
export interface Template {
  assessment_format: string;
  label: string;
  questionnaire: { assessment_id: number | null; name: string; items: number } | null;
  scoping: number;
  in_progress: number;
}
