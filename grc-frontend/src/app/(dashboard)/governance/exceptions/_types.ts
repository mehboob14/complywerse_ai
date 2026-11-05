// The shapes the Exceptions page reads, and the query keys its writes refresh. Types only (and the lists of keys): what the server sends is
// policy_exception_router._exception_to_dict, and, for what D62 adds (risks, controls, the implementation, assets, the two hierarchy views, AI drafts),
// modules/governance/routers/exception_workflow.py with exception_risks.py, exception_controls.py, exception_assets.py, exception_hierarchy.py, exception_ai.py.
import type { ExceptionFields } from './_logic';

export interface LinkedAsset { id: number; name: string; asset_type?: string; criticality?: string }

export interface ExceptionItem extends ExceptionFields {
  id: number;
  document_id: number | null;
  justification: string;
  risk_assessment: string;
  compensating_controls: string;
  effective_date: string | null;
  updated_at: string | null;
  rejection_reason?: string;
  approval_comments?: string;
  approved_by_name?: string;
  approver_name?: string;
  approved_at?: string;
  revocation_reason?: string;
  revoker_name?: string;
  /** what the person may do with it, from the server (it refuses the rest) */
  can_edit?: boolean;
  can_delete?: boolean;
  can_decide?: boolean;
  linked_asset_ids?: number[];
  linked_assets?: LinkedAsset[];
  promoted_risk_id?: number | null;
  /** its own department, and the names from the top department down to the one it is raised for (its own, else its policy's) */
  department_id?: number | null;
  /** its type: a value of the organisation's list, and its name (a type taken off the list is still named) */
  exception_type?: string | null;
  exception_type_label?: string | null;
  department_path?: string[];
  /** the department comes from its policy: none was chosen for the exception itself */
  department_inherited?: boolean;
  /** the latest run of the approval rule it was submitted under (any status); null when no rule applied: the older flow, anyone allowed to approve decides */
  approval?: ExceptionApproval | null;
  /** it waits under a rule and the person may take it back to a draft */
  can_withdraw?: boolean;
  /** what the document it is about is (policy, standard, procedure, guideline...), and its code when the person may open it */
  document_type?: string | null;
  document_code?: string | null;
  /** what refusing it would mean for the business: the requester's words (AI may draft them) */
  business_impact?: string | null;
  /** the real potential risks recorded by the people asked, and the compensating controls recorded by the implementer */
  risks_count?: number;
  controls_count?: number;
  /** after the last approval of a rule that has an implementer; null: nothing to implement */
  implementation?: Implementation | null;
  /** the assets with who put each there and when; linked_asset_ids / linked_assets stay the membership */
  asset_links?: AssetLink[];
  /** the person may put assets on it (the requester, someone who may edit exceptions, the implementer while it is open) */
  can_add_assets?: boolean;
  /** only in 'Waiting for me': it waits for the person's decision, or for them to implement it */
  waiting_kind?: 'decision' | 'implementation';
}

// What the server sends of an approval (modules/governance/exception_approvals.py: _run_view, history). Said in words by _approval.ts.
export type RunStatus = 'open' | 'approved' | 'rejected' | 'changes_requested' | 'withdrawn';
export type StepState = 'waiting' | 'active' | 'done';
export interface ApprovalSlot { label: string; answered: boolean; by: string[]; people: string[] }
export interface ApprovalStep {
  position: number; name: string; kind: 'review' | 'approval'; order: 'together' | 'in_turn'; rule: 'all' | 'any' | 'at_least'; min_count: number | null;
  due_days: number | null; allow_reject: boolean; allow_changes: boolean; state: StepState; activated_at: string | null; due_at: string | null;
  completed_at: string | null; overdue: boolean; slots: ApprovalSlot[]; progress: { required: number; answered: number };
}
export interface ApprovalDecision {
  step_position: number; step_name: string; user_id?: number; user_name: string | null; decision: 'approve' | 'reject' | 'changes'; comment: string | null; decided_at: string | null;
}
/** What the person asking may do at the open step (null: they are not asked now). */
export interface MyStep {
  position: number; name: string; kind: 'review' | 'approval'; can_reject: boolean; can_ask_changes: boolean;
  /** what the person has recorded at this step: an approval needs a risk or 'none identified' (the server answers 400 without) */
  assessment: MyAssessment;
}
export interface MyAssessment { recorded: boolean; none_identified: boolean; count: number }
export interface ExceptionApproval {
  run_id: number; round: number; status: RunStatus; rule: { id: number | null; name: string }; department_id: number | null; current_step: number | null;
  steps: ApprovalStep[]; asked: { id: number; name: string }[]; stalled: boolean; my_step: MyStep | null; started_at: string | null; finished_at: string | null;
  decisions: ApprovalDecision[];
}
export interface ApprovalRound {
  round: number; status: RunStatus; rule_name: string; started_at: string | null; started_by: string | null; finished_at: string | null; decisions: ApprovalDecision[];
}
/** GET .../{id}/approval: every round, and the one that counts now. */
export interface ApprovalHistory { rounds: ApprovalRound[]; current: ExceptionApproval | null }

export interface ExceptionAnalytics {
  avg_posture: number | null;
  open: number;
  overdue: number;
  resolved: number;
  closed_on_time_pct: number | null;
  aging_buckets: Record<string, number>;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  total: number;
}

export interface PolicyOption { id: number; title: string; document_code?: string; doc_type?: string }
export interface AssetOption { id: number; name: string; asset_type?: string; criticality?: string }
export interface ExceptionComment { id: number; comment: string; user_name: string; created_at: string }
export interface ExceptionCandidate { document_id: number; document_title?: string; suggested_title: string; rationale: string; suggested_priority: string; source?: string }

// ─── The assets: one list, with who put each there ──────────────────────────────────────────────────────────────────────────────
export interface AssetLink {
  asset_id: number; name: string; asset_type?: string; criticality?: string;
  added_by: { id: number; name: string } | null; stage: 'request' | 'implementation'; step_name: string | null; added_at: string | null;
  /** the person may take it off: what they added, or anything when they may edit exceptions */
  can_remove: boolean;
}

// ─── The implementation: after the last approval, when the rule has an implementer ──────────────────────────────────────────────────
export type ImplementationState = 'waiting' | 'in_progress' | 'done' | 'cancelled';
export interface Implementation {
  state: ImplementationState; name: string; asked: { id: number; name: string }[]; due_at: string | null; overdue: boolean;
  opened_at: string | null; completed_at: string | null; completed_by_name: string | null; note: string | null;
  /** open, and nobody who can act is left */
  stalled: boolean;
  /** the person is one of the people asked and it is open */
  my_turn: boolean; can_complete: boolean;
  controls_count: number; risks_count: number; uncovered_count: number;
}

// ─── Potential risks ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Rating = 'low' | 'medium' | 'high' | 'critical';
export interface PotentialRisk {
  id: number; round: number | null; step_position: number | null; step_name: string | null; step_kind: 'review' | 'approval' | null;
  recorded_by: { id: number; name: string };
  /** null on a row that says the person found none */
  title: string | null; description: string | null;
  likelihood: number | null; impact: number | null; score: number | null; rating: Rating | null; rating_label: string | null;
  /** the organisation's own word for the level, when it has set its scales */
  likelihood_label: string | null; impact_label: string | null;
  none_identified: boolean; register_risk_id: number | null; source: 'manual' | 'ai'; created_at: string | null;
  /** recorded by the person asking; and they can still change or remove it (their step is the open one) */
  mine: boolean; can_edit: boolean;
}
/** Where the person records now: the open step they are asked at (without a rule, the plain approval). null: they are not asked. */
export interface RisksTurn { round: number | null; step_position: number | null; step_name: string | null; kind: 'review' | 'approval'; recorded: boolean; none_identified: boolean }
/** `scales`: the organisation's own words for the levels (keys are the levels as text; empty when it set none), so the form can name them for a reviewer who has no right to the Risk Management module's own list. */
export interface RisksAnswer { risks: PotentialRisk[]; my_turn: RisksTurn | null; scales?: { likelihood: Record<string, string>; impact: Record<string, string> } }
export interface RiskInput { title?: string; description?: string; likelihood?: number | null; impact?: number | null; none_identified?: boolean; source?: 'manual' | 'ai' }

// ─── Compensating controls ──────────────────────────────────────────────────────────────────────────────────────────────────────
export type ControlEvidence = { kind: 'link'; url: string; label: string } | { kind: 'evidence'; evidence_id: number; label: string };
export interface CompensatingControl {
  id: number; title: string; description: string | null; risk_ids: number[]; asset_ids: number[];
  owner: { id: number; name: string } | null; due_date: string | null; status: 'planned' | 'in_place'; evidence: ControlEvidence[];
  created_by: { id: number; name: string } | null; source: 'manual' | 'ai'; created_at: string | null;
  /** the person is one of the people asked to implement it, and it is open */
  can_edit: boolean;
}
export interface ControlsAnswer { controls: CompensatingControl[]; implementation: Implementation | null; uncovered_risks: { id: number; title: string | null }[] }
/** What POST / PUT take: evidence is a link, or an item of the Evidence library (the server checks both). */
export interface ControlInput {
  title?: string; description?: string; risk_ids?: number[]; asset_ids?: number[]; owner_id?: number | null; due_date?: string | null;
  status?: 'planned' | 'in_place'; evidence?: Array<{ kind: 'link'; url: string; label?: string } | { kind: 'evidence'; evidence_id: number; label?: string }>; source?: 'manual' | 'ai';
}

// ─── The two hierarchy views ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface Counts { total: number; open: number; approved: number; expiring: number; to_implement: number }
/** One unit of the tree that has exceptions; counts and `own` as the server says: a row counts its unit and everything under it, `own` is the ones raised for it itself. */
export interface UnitRow {
  department_id: number; name: string; path: string[]; level: number; level_label: string; depth: number; is_active: boolean; own: number; counts: Counts;
}
export interface ByUnitAnswer { units: UnitRow[]; no_unit: { own: number; counts: Counts }; totals: Counts }
export interface DocumentException {
  id: number; title: string; status: string; priority: string | null; expiry_date: string | null; exception_type_label: string | null;
  waiting_kind: 'decision' | 'implementation' | null;
}
/** A document that has exceptions; title and code are null (and document_id too) when the person may not open it, and document_id is null for exceptions about no document. */
export interface DocumentGroup { document_id: number | null; title: string | null; doc_type: string | null; code: string | null; counts: Counts; exceptions: DocumentException[] }
export interface UnitDocuments { department_id: number; name: string; path: string[]; depth: number; is_active: boolean; counts: Counts; documents: DocumentGroup[] }
export interface ByDocumentAnswer { units: UnitDocuments[]; no_unit: DocumentGroup[]; total: number }

// ─── AI drafts (nothing is saved by the call; 503 when AI is not configured, 502 when its answer was unusable) ───────────────────
export interface AiDraftAnswer { justification: string; business_impact: string; source: 'ai' }
export interface AiScheduleAnswer { priority: Rating; effective_date: string; expiry_date: string; rationale: string }
export interface AiAssetsAnswer { assets: Array<{ id: number; name: string; asset_type?: string; criticality?: string; reason: string }> }
export interface AiRisksAnswer { summary: string; risks: Array<{ title: string; description: string; likelihood: number; impact: number }> }
export interface AiControlsAnswer { controls: Array<{ title: string; description: string; risk_ids: number[]; asset_ids: number[] }> }

/**
 * What a change to an exception refreshes: the list, and the summary (as it always did), and now the analytics too. The analytics hold the counts the
 * page reads the true total from and the three cards; they were not refreshed by a change and the app keeps a query fresh for a minute, so the cards
 * and the total would have stayed behind what the person had just done.
 */
export const LIST_KEYS: ReadonlyArray<readonly unknown[]> = [['policy-exceptions'], ['policy-exceptions-summary'], ['policy-exceptions-analytics']];

/** The query keys of what D62 adds. All start with 'policy-exceptions', so every change that refreshes LIST_KEYS refreshes them too. */
export const BY_UNIT_KEY = ['policy-exceptions', 'by-unit'] as const;
export const BY_DOCUMENT_KEY = ['policy-exceptions', 'by-document'] as const;
export const risksKey = (id: number) => ['policy-exceptions', 'risks', id] as const;
export const controlsKey = (id: number) => ['policy-exceptions', 'controls', id] as const;
