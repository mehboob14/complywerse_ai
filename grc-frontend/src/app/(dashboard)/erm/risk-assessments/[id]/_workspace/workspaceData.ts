'use client';

// The requests of an assessment's workspace, each under one key, and the pure helpers that keep its table honest.
import { useQuery } from '@tanstack/react-query';
import { ermApi } from '@/lib/api';
import { canRetry } from '@/components/ui/ds/reportOutcome';
import { bandOf, levelScore, ratingOf, residualOf, inherentOf, type AssessedRisk, type Band } from '../../_register/assessmentModel';

export interface AssessmentDetail {
  id: number;
  name: string;
  description?: string | null;
  assessment_type?: string | null;
  methodology?: string | null;
  scope?: string | null;
  assessment_period_start?: string | null;
  assessment_period_end?: string | null;
  status: string;
  lead_assessor_id?: number | null;
  lead_assessor_name?: string | null;
  business_unit_name?: string | null;
  framework_name?: string | null;
  approved_by?: number | null;
  approver_name?: string | null;
  approved_at?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  assessed_risks: AssessedRisk[];
  assessed_risks_count: number;
}

export const assessmentKey = (id: number) => ['risk-assessment', id] as const;

export function useAssessment(id: number) {
  return useQuery({
    queryKey: [...assessmentKey(id)],
    queryFn: async () => (await ermApi.riskAssessments.getById(id)).data as unknown as AssessmentDetail,
    enabled: Number.isFinite(id) && id > 0,
    retry: (failures, e) => failures < 2 && canRetry(e),
  });
}

/** What the table sorts by. `order` is the order the server sent them. */
export const RISK_SORTS = ['order', 'title', 'level', 'inherent', 'residual'] as const;
export type RiskSort = { key: (typeof RISK_SORTS)[number]; dir: 'asc' | 'desc' };

export const levelRank = (b: Band): number => ({ critical: 4, high: 3, medium: 2, low: 1, none: 0 })[b];

export function sortRisks(rows: readonly AssessedRisk[], sort: RiskSort): AssessedRisk[] {
  if (sort.key === 'order') return rows.slice();
  const dir = sort.dir === 'asc' ? 1 : -1;
  const value = (r: AssessedRisk): number | string => {
    switch (sort.key) {
      case 'title': return (r.risk_title ?? '').toLowerCase();
      case 'inherent': return inherentOf(r) ?? -1;
      case 'residual': return residualOf(r) ?? -1;
      default: return levelRank(ratingOf(r)) * 100 + (levelScore({ residual_score: residualOf(r), inherent_score: inherentOf(r) }) || 0);
    }
  };
  return rows.slice().sort((a, b) => {
    const x = value(a);
    const y = value(b);
    return dir * (x < y ? -1 : x > y ? 1 : 0) || a.id - b.id;
  });
}

/** The risks that pass the title search and the level chips. */
export function visibleRisks(rows: readonly AssessedRisk[], search: string, levels: readonly string[]): AssessedRisk[] {
  const q = search.trim().toLowerCase();
  return rows.filter((r) => (!q || `${r.risk_title ?? ''} ${r.risk_category ?? ''}`.toLowerCase().includes(q)) && (levels.length === 0 || levels.includes(ratingOf(r))));
}

export { bandOf };
