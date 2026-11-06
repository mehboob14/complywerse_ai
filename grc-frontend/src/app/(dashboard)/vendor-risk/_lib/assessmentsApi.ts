// The vendor record's Assessments tab: its cards, one questionnaire read in full, and sending one (signed-in side).
// Backend: tpra/assessment_view.py (the two reads), routers/questionnaires.py (send, resend).

import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api';
import type { ReviewableResponse } from '../assessments/[id]/_review';
import { WAITING, type CardFacts, type Changes, type ScopeFacts } from './assessmentsLogic';

export interface AssessmentCard extends CardFacts {
  assessment_id: number | null;
  /** the review cycle it was sent in (1 for the first review); null when it belongs to no review */
  cycle: number | null;
  kind: 'initial' | 'reassessment' | 'follow_up' | 'unlinked';
  template_version: number | null;
  missing_evidence: number;
  sent_at: string | null;
  due_date: string | null;
  submitted_at: string | null;
  expires_at: string | null;
  scored: boolean;
  grade: string | null;
  inherent_score: number | null;
  residual_score: number | null;
  rating: string | null;
  previous: { cycle: number; residual_score: number | null; grade: string | null } | null;
  /** the residual against the cycle before; negative is better */
  residual_change: number | null;
}

export interface CardsScope extends ScopeFacts {
  engagement_id: number | null;
  tier: string | null;
  active_assessment_id: number | null;
}

export interface CardsResponse { scope: CardsScope; items: AssessmentCard[] }

export interface DetailFile {
  id: number; file_name: string; file_type: string | null; file_size: number | null; file_path: string | null; evidence_id: number | null;
}

export interface DetailRow {
  id: string;
  text: string | null;
  type: string;
  optional: boolean;
  critical: boolean;
  state: 'answered' | 'unanswered' | 'na';
  label: string | null;
  text_answer: string | null;
  credit: 'full' | 'partial' | 'gap' | 'na' | null;
  evidence: { rule: string; owed: boolean; has: boolean; missing: boolean; files: DetailFile[] };
  /** the answer last cycle, when it reads differently now */
  was: string | null;
  changed: boolean;
}

export interface DetailSection { key: string; label: string; answered: number; residual: number | null; rows: DetailRow[] }

export interface DetailChanges extends Changes {
  cycle: number;
  /** false: there was a cycle before, but nothing answered in it to set these answers against */
  compared: boolean;
  items: Array<{ id: string; text: string | null; from: string | null; to: string | null; weaker: boolean | null }>;
}

/** A questionnaire as the review reads it; the review components (`_review.tsx`) take it as they take the old page's. */
export interface QuestionnaireDetail extends ReviewableResponse {
  vendor_id: number;
  assessment_id: number | null;
  assessment: {
    id: number; cycle: number; active: boolean; lifecycle: boolean; scored: boolean; scoring_skipped: boolean;
    inherent_score: number | null; residual_score: number | null; rating: string | null; grade: string | null;
  } | null;
  questions: number;
  answered: number;
  missing_evidence: number;
  sections: DetailSection[];
  changes: DetailChanges | null;
  steps: Array<{ label: string; detail: string | null; value: string }>;
}

export interface SendInput {
  vendor_id: number;
  assessment_id?: number | null;
  template_id: number;
  contact_id?: number | null;
  due_in_days?: number;
  expires_in_days?: number;
  certificate_evidence_id?: number;
  certificate_mode?: 'off' | 'prefill' | 'skip';
}

/** What the link dialog says: where it went, whether the email did, and the link (shown once). */
export interface SentLink { link: string | null; emailed: boolean; email: string | null; questions: number }

export const assessmentsApi = {
  cards: (vendorId: number, engagementId: number | null) =>
    apiClient.get<CardsResponse>(`/vendor-risk/vendors/${vendorId}/assessment-cards`, { params: engagementId ? { engagement_id: engagementId } : {} }),
  detail: (responseId: number) => apiClient.get<QuestionnaireDetail>(`/vendor-risk/questionnaire-responses/${responseId}/detail`),
  send: (data: SendInput) =>
    apiClient.post<{ link: string | null; emailed: boolean; contact: { name: string | null; email: string | null } | null }>(
      '/vendor-risk/questionnaires/send', data),
  resend: (responseId: number, data: { due_in_days?: number; expires_in_days?: number }) =>
    apiClient.post<{ link: string | null; emailed: boolean; respondent_email: string | null }>(
      `/vendor-risk/questionnaire-responses/${responseId}/resend`, data),
};

/** Every query of the tab starts with this, so one invalidation refreshes the cards. */
export const CARDS_KEY = 'tprm-assessment-cards';
export const cardsKey = (vendorId: number, engagementId: number | null) => [CARDS_KEY, vendorId, engagementId ?? null] as const;
/** Under ['assessment', id], where the review components' own refresh already looks. */
export const detailKey = (assessmentId: number | null, responseId: number) => ['assessment', assessmentId ?? 0, 'detail', responseId] as const;

/** The cards of one engagement (null: General). While a questionnaire is with a vendor it checks again every 30 seconds. */
export function useAssessmentCards(vendorId: number, engagementId: number | null) {
  return useQuery({
    queryKey: cardsKey(vendorId, engagementId),
    queryFn: async () => (await assessmentsApi.cards(vendorId, engagementId)).data,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchInterval: (q) => (q.state.data?.items.some((c) => WAITING.includes(c.status) && !c.expired) ? 30_000 : false),
  });
}

export function useQuestionnaireDetail(assessmentId: number | null, responseId: number) {
  return useQuery({
    queryKey: detailKey(assessmentId, responseId),
    queryFn: async () => (await assessmentsApi.detail(responseId)).data,
    retry: 1,
    refetchOnWindowFocus: false,
  });
}
