// The shapes the assessment workspace reads from `/compliance/assessments` (`backend/grc/routers/compliance_assessments_router.py`). Types only, so the pure models can import them.
import type { RawItem } from './itemModel.ts';

/** `GET /compliance/assessments/<id>?grouped=0`. */
export interface AssessmentDetail {
  id: number;
  tenant_id: number;
  name: string;
  assessment_type: string;
  assessment_format: string;
  source: string | null;
  file_name: string | null;
  /** draft | in_progress | in_review | completed | archived: free text on the server */
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
  notes: string | null;
  scope_model: 'asset' | 'process' | 'system' | null;
  phase: 'scoping' | 'in_progress' | null;
  owner_id: number | null;
  primary_asset_id: number | null;
  started_at: string | null;
  created_at: string;
  updated_at: string | null;
  items: RawItem[];
}

export interface SlaCounts { gaps?: number; closed?: number; open?: number; overdue?: number }
export interface Metric { key: string; label: string; weight: number; score: number | null; numerator: number; denominator: number; formula: string }

/** One entry of `GET /overview?assessment_id=<id>` (`categories[0].assessments[0]`): what the board scored. */
export interface OverviewEntry {
  id: number;
  name: string;
  format: string;
  family: string;
  item_noun: string;
  status: string | null;
  n_items: number;
  /** the content score, 0 to 100; null when nothing is answered yet */
  content: number | null;
  /** the SLA score, 0 to 100; null when there is no gap to remediate */
  sla: number | null;
  level_achieved?: number | null;
  metrics?: Metric[];
  sla_metrics?: Metric[];
  sla_counts?: SlaCounts;
}

export interface OverviewResult {
  as_of: string;
  categories: Array<{ category: string; assessments: OverviewEntry[] }>;
}
