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
}

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
