// The shapes the Policy exceptions page reads, and the query keys its writes refresh. Types only (and one list of keys): what the server sends is
// policy_exception_router._exception_to_dict.
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
export interface MyStep { position: number; name: string; kind: 'review' | 'approval'; can_reject: boolean; can_ask_changes: boolean }
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

/**
 * What a change to an exception refreshes: the list, and the summary (as it always did), and now the analytics too. The analytics hold the counts the
 * page reads the true total from and the three cards; they were not refreshed by a change and the app keeps a query fresh for a minute, so the cards
 * and the total would have stayed behind what the person had just done.
 */
export const LIST_KEYS: ReadonlyArray<readonly unknown[]> = [['policy-exceptions'], ['policy-exceptions-summary'], ['policy-exceptions-analytics']];
