// The lifecycle workspace's calls (backend vendor_risk/tpra/api.py, roster.py, onboarding.py). The older calls stay on `tpraApi`.
// One read tells everything the workspace draws: the stages, the gate with its structured checks, what the assessment is held to,
// and what moved the work.
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type { GateResult, LifecycleResponse, StageInstance } from '../vendors/[id]/_tpra/types';
import type { Check, HistoryRow } from './lifecycleLogic';
import { TPRM_QUERY_OPTS } from './tprmQuery';

export interface GateView extends GateResult { checks: Check[] }

/** What the assessment's tier skips, the bands its score sits on, how often it is reviewed, the reviewers it needs. */
export interface HeldPolicy {
  tier: string | null;
  skips: string[];
  thresholds: { critical: number; high: number; medium: number };
  cadence_days: number | null;
  reviewers: string[];
}

export interface LifecycleView extends Omit<LifecycleResponse, 'gate' | 'stages'> {
  engagement_id: number | null;
  stages: Array<StageInstance & { skipped_by?: number | null }>;
  gate: GateView | null;
  policy: HeldPolicy | null;
  history: HistoryRow[];
  /** a sentence when the tier cannot change now (an exit is under way) */
  retier_blocked: string | null;
}

export interface NextRole { key: string; label: string; members: Array<{ user_id: number; name: string }>; missing: boolean }
export interface NextStage { stage_key: string | null; stage_label: string | null; roles: NextRole[]; anyone_who_can_approve: boolean }

export interface TierPreview {
  score: number;
  tier: string;
  factors: Record<string, number>;
  contributions: Record<string, number>;
  reasons?: Record<string, string[]>;
  /** an answer holds the tier at least here, whatever the score says, and the question that does */
  minimum_tier?: string | null;
  minimum_from?: string | null;
}

export interface Retier { from: string | null; to: string; reopened: string[]; sent_back_to: string | null; skipped: string[] }
export interface TierResult extends TierPreview { computed_tier?: string; retier: Retier }

export const lifecycleKey = (vendorId: number, engagementId: number | null) => ['tpra-lifecycle', vendorId, engagementId] as const;

export const lifecycleApi = {
  get: (vendorId: number, engagementId: number | null) =>
    apiClient.get<LifecycleView>(`/vendor-risk/tpra/vendors/${vendorId}/lifecycle`, { params: engagementId ? { engagement_id: engagementId } : {} }),
  /** The stage after this one and the people behind the roles it waits on (the workspace roster). */
  nextStage: (vendorId: number, engagementId: number | null) =>
    apiClient.get<NextStage>(`/vendor-risk/vendors/${vendorId}/next-stage`, { params: engagementId ? { engagement_id: engagementId } : {} }),
  /** Tell them, in the app and by email. */
  notify: (vendorId: number, engagementId: number | null) =>
    apiClient.post<{ notified: number }>(`/vendor-risk/vendors/${vendorId}/notify-stage`, { engagement_id: engagementId }),
  /** An engagement keeps its own answers to the onboarding questions (the supplier's are saved with intakeApi.save). */
  saveEngagementAnswers: (engagementId: number, answers: Record<string, unknown>, justifications: Record<string, string>) =>
    apiClient.put(`/vendor-risk/engagements/${engagementId}`, { intake: { answers, justifications } }),
  /** The tier these answers would give; nothing is saved. */
  previewTier: (answers: Record<string, unknown>) => apiClient.post<TierPreview>('/vendor-risk/intake/preview', { answers }),
  /** Compute the tier from the saved answers; `override` sets it by hand over the computed one, in the same step. */
  setTier: (assessmentId: number, override?: { tier: string; justification: string }) =>
    apiClient.post<TierResult>(`/vendor-risk/tpra/assessments/${assessmentId}/run-tiering`, override ? { override } : {}),
  /** A condition of a decision, closed without being met. */
  waive: (approvalId: number, conditionId: string, reason: string) =>
    apiClient.patch(`/vendor-risk/tpra/approvals/${approvalId}/conditions/${conditionId}`, { waived: true, reason }),
  meet: (approvalId: number, conditionId: string) =>
    apiClient.patch(`/vendor-risk/tpra/approvals/${approvalId}/conditions/${conditionId}`, { status: 'closed' }),
};

export function useLifecycle(vendorId: number, engagementId: number | null) {
  return useQuery<LifecycleView>({
    queryKey: lifecycleKey(vendorId, engagementId),
    queryFn: async () => (await lifecycleApi.get(vendorId, engagementId)).data,
  });
}

/** Who is next. Keyed under the lifecycle's own key, so whatever refreshes the lifecycle refreshes this. */
export function useNextStage(vendorId: number, engagementId: number | null, stage: string | null, enabled: boolean) {
  return useQuery<NextStage>({
    queryKey: ['tpra-lifecycle', vendorId, 'next', engagementId, stage],
    queryFn: async () => (await lifecycleApi.nextStage(vendorId, engagementId)).data,
    enabled: enabled && !!stage,
    ...TPRM_QUERY_OPTS,
  });
}

/** What a person-readable sentence a failed call gives (re-exported for the workspace's toasts). */
export { apiErrorText } from '@/lib/apiError';
