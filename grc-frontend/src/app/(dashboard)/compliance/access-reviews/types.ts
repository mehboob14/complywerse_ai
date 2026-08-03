// src/app/(dashboard)/compliance/access-reviews/types.ts
// Mirrors backend dict builders in grc/routers/access_review_router.py
// (_campaign_dict, _item_dict, _build_report) and rule_catalog.py.

export type Decision = 'pending' | 'approved' | 'revoke' | 'exception';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type CampaignStatus = 'draft' | 'population_built' | 'sampled' | 'in_review' | 'completed';

/** Pipeline stage, derived from campaign.status. 1..6 */
export type StageIndex = 1 | 2 | 3 | 4 | 5 | 6;

export interface Campaign {
  id: number;
  name: string;
  description?: string | null;
  review_type: string;            // scope: 'all' | 'privileged' | 'terminated'
  status: CampaignStatus;
  population_size: number;
  sampling_method: string;        // 'random' | 'risk' | 'full'
  requested_sample_size: number;
  exceptions_found: number;
  items_reviewed: number;
  created_at?: string | null;
}

export interface Finding {
  id: number;
  type: string;                   // semantic finding_type, e.g. 'mfa_missing', 'terminated_active'
  severity: Severity;
  title: string;
  detail?: string | null;
  status: string;                 // 'open' | 'accepted' | 'false_positive'
}

export interface ReviewItem {
  id: number;
  user_id: number | null;
  email?: string | null;
  display_name?: string | null;
  department?: string | null;
  designation?: string | null;
  roles: string[];
  mfa_enabled: boolean | null;
  account_enabled: boolean | null;
  last_sign_in?: string | null;
  is_terminated: boolean;
  termination_date?: string | null;
  is_privileged: boolean;
  decision: Decision;
  findings: Finding[];
  evidence_id?: number | null;
  escalation_tier?: number;
  ai_recommendation?: string | null;
  ai_reason?: string | null;
  risk_score?: number | null;
  is_anomaly?: boolean;
  anomaly_note?: string | null;
}

export interface CampaignDetail extends Campaign {
  items: ReviewItem[];
}

export interface Report {
  population_size: number;
  sample_size: number;
  exceptions_total: number;
  users_with_exceptions: number;
  findings_by_type: Record<string, number>;
  findings_by_severity: Record<string, number>;
  decisions: Record<string, number>;
  verdict: string;
  ai_summary?: string | null;
  exceptions_open?: number;
}

// GET /access-reviews/dashboard — keys match the backend response exactly.
export interface DashboardSummary {
  campaigns_total: number;
  findings_open: number;
  users_with_open_exceptions: number;
  items_reviewed: number;
  items_total: number;
  sod_rules: number;
}

export type RuleStatus = 'runnable' | 'needs_data' | 'needs_connector';

export interface CatalogRule {
  id: string;
  name: string;
  severity: Severity;
  status: RuleStatus;
  reads: string;
  trips: string;
  regulation: string;             // e.g. 'SOX·SAMA'
  runnable: boolean;
  enabled: boolean;
}

export interface RuleCatalogView {
  summary: { total: number; runnable: number; enabled_active: number };
  domains: { domain: string; rules: CatalogRule[] }[];
}

/** Connector tiers for the Connect-a-source screen. */
export interface ConnectorRow {
  key: string;
  name: string;
  tier: 1 | 2 | 3;
  status: 'connected' | 'available';
  meta?: string;
}
